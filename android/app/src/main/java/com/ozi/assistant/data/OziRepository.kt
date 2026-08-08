package com.ozi.assistant.data

import android.content.Context
import com.ozi.assistant.audio.AudioPlayer
import com.ozi.assistant.audio.SpeechToText
import com.ozi.assistant.network.AuthApi
import com.ozi.assistant.network.EstadoOzi
import com.ozi.assistant.network.OziWebSocketClient
import com.ozi.assistant.network.OziWebSocketListener
import com.ozi.assistant.service.WakeWordDetector
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

enum class EstadoConexao { DESCONECTADO, CONECTANDO, CONECTADO }
enum class EstadoAtividade { OCIOSO, OUVINDO, PROCESSANDO, FALANDO }

data class MensagemConversa(val deQuemFalou: String, val texto: String)

data class OziUiState(
    val logado: Boolean = false,
    val conexao: EstadoConexao = EstadoConexao.DESCONECTADO,
    val atividade: EstadoAtividade = EstadoAtividade.OCIOSO,
    val estadoHumor: EstadoOzi? = null,
    val conversa: List<MensagemConversa> = emptyList(),
    val wakeWordDisponivel: Boolean = false,
    val ultimoErro: String? = null,
)

/**
 * O "cerebro" do app: unico dono do login, da conexao WebSocket, do
 * reconhecimento de voz e do player de audio. Tanto a UI (MainActivity/
 * ViewModel) quanto o OziListenerService (rodando em segundo plano) falam
 * com a MESMA instancia disso, via OziApplication - assim o estado nunca
 * desincroniza entre "o que a tela mostra" e "o que esta realmente
 * acontecendo".
 */
class OziRepository(private val context: Context) {

    private val prefs = SecurePrefs(context)
    private val audioPlayer = AudioPlayer(context)
    private val speechToText = SpeechToText(context)

    private var wsClient: OziWebSocketClient? = null
    private var wakeWordDetector: WakeWordDetector? = null

    private val _uiState = MutableStateFlow(OziUiState(logado = prefs.estaLogado))
    val uiState: StateFlow<OziUiState> = _uiState

    // --- Login ---

    private fun authApi(): AuthApi {
        // A URL do servidor so e conhecida depois de configurada - se ainda
        // nao foi, usa um placeholder que so falha quando de fato tentar
        // chamar a rede (a tela de login trata esse erro).
        val urlBase = prefs.urlServidor.ifBlank { "ws://localhost:8787" }
        return AuthApi(urlBase)
    }

    suspend fun entrarComEmailSenha(email: String, senha: String) {
        val usuario = authApi().login(email, senha)
        salvarSessao(usuario.token, usuario.email)
    }

    suspend fun criarContaComEmailSenha(email: String, senha: String, nome: String) {
        val usuario = authApi().registrar(email, senha, nome)
        salvarSessao(usuario.token, usuario.email)
    }

    suspend fun entrarComGoogle(idToken: String) {
        val usuario = authApi().loginComGoogle(idToken)
        salvarSessao(usuario.token, usuario.email)
    }

    private fun salvarSessao(token: String, email: String) {
        prefs.tokenAcesso = token
        prefs.emailUsuario = email
        _uiState.update { it.copy(logado = true) }
    }

    fun sair() {
        desconectar()
        prefs.sair()
        _uiState.update { OziUiState(logado = false) }
    }

    // --- Conexao WebSocket (so funciona depois de logado) ---

    fun conectar() {
        val token = prefs.tokenAcesso
        if (token.isNullOrBlank()) {
            _uiState.update { it.copy(ultimoErro = "Faca login primeiro.") }
            return
        }
        if (!prefs.estaConfigurado) {
            _uiState.update { it.copy(ultimoErro = "Configure a URL do servidor primeiro.") }
            return
        }

        _uiState.update { it.copy(conexao = EstadoConexao.CONECTANDO) }

        wsClient = OziWebSocketClient(
            urlServidor = prefs.urlServidor,
            tokenAcesso = token,
            deviceId = prefs.deviceId,
            deviceNome = prefs.nomeDispositivo,
            listener = object : OziWebSocketListener {
                override fun aoAutenticado(estado: EstadoOzi?) {
                    _uiState.update { it.copy(conexao = EstadoConexao.CONECTADO, estadoHumor = estado ?: it.estadoHumor) }
                    // Se o Firebase ja tinha gerado um token de notificacao
                    // antes desta conexao abrir (ex: app estava fechado),
                    // manda ele agora que da pra falar com o servidor.
                    prefs.tokenFcmPendente?.let { enviarTokenFcmSePossivel(it) }
                }

                override fun aoErroAutenticacao(mensagem: String) {
                    // Token invalido/expirado - manda de volta pra tela de
                    // login em vez de ficar tentando de novo sem sucesso.
                    prefs.sair()
                    _uiState.update {
                        it.copy(logado = false, conexao = EstadoConexao.DESCONECTADO, ultimoErro = mensagem)
                    }
                }

                override fun aoDesconectar() {
                    _uiState.update { it.copy(conexao = EstadoConexao.DESCONECTADO) }
                }

                override fun aoErro(mensagem: String) {
                    _uiState.update { it.copy(ultimoErro = mensagem) }
                }

                override fun aoRecebermensagemTexto(texto: String, estado: EstadoOzi?) {
                    _uiState.update {
                        it.copy(
                            conversa = it.conversa + MensagemConversa("ozi", texto),
                            estadoHumor = estado ?: it.estadoHumor,
                            atividade = EstadoAtividade.PROCESSANDO,
                        )
                    }
                }

                override fun aoRecebermensagemTts(mensagemErro: String) {
                    // Audio falhou no servidor - a conversa continua so em
                    // texto, sem travar nada (mesmo comportamento do
                    // fake-device.js e da pagina web).
                    _uiState.update { it.copy(atividade = EstadoAtividade.OCIOSO) }
                }

                override fun aoReceberAudio(audio: ByteArray) {
                    _uiState.update { it.copy(atividade = EstadoAtividade.FALANDO) }
                    audioPlayer.tocar(audio) {
                        _uiState.update { it.copy(atividade = EstadoAtividade.OCIOSO) }
                    }
                }
            },
        )
        wsClient?.conectar()
    }

    fun desconectar() {
        wsClient?.desconectar()
        wsClient = null
        _uiState.update { it.copy(conexao = EstadoConexao.DESCONECTADO) }
    }

    /** Chamado tanto pelo botao "segure pra falar" quanto pelo wake word. */
    fun comecarAEscutar() {
        _uiState.update { it.copy(atividade = EstadoAtividade.OUVINDO) }
        speechToText.escutar(
            aoReconhecer = { textoFalado ->
                _uiState.update {
                    it.copy(
                        conversa = it.conversa + MensagemConversa("voce", textoFalado),
                        atividade = EstadoAtividade.PROCESSANDO,
                    )
                }
                wsClient?.enviarTexto(textoFalado)
            },
            aoErro = { mensagem ->
                _uiState.update { it.copy(ultimoErro = mensagem, atividade = EstadoAtividade.OCIOSO) }
            },
        )
    }

    fun enviarTextoDigitado(texto: String) {
        if (texto.isBlank()) return
        _uiState.update {
            it.copy(
                conversa = it.conversa + MensagemConversa("voce", texto),
                atividade = EstadoAtividade.PROCESSANDO,
            )
        }
        wsClient?.enviarTexto(texto)
    }

    // --- Wake word ("Ozi", ativacao por voz em segundo plano) ---

    fun iniciarWakeWord() {
        val detector = WakeWordDetector(
            context = context,
            chaveAcesso = prefs.chavePicovoice,
            aoDetectarWakeWord = { comecarAEscutar() },
        )
        wakeWordDetector = detector
        val ok = detector.iniciar()
        _uiState.update { it.copy(wakeWordDisponivel = ok) }
    }

    fun pararWakeWord() {
        wakeWordDetector?.liberar()
        wakeWordDetector = null
    }

    fun limparErro() {
        _uiState.update { it.copy(ultimoErro = null) }
    }

    fun preferencias(): SecurePrefs = prefs

    /**
     * Manda o token do Firebase Cloud Messaging pro servidor, se a conexao
     * ja estiver autenticada agora. Chamado tanto pelo
     * OziFirebaseMessagingService (quando o token muda) quanto por aqui
     * mesmo (quando a conexao acaba de autenticar).
     */
    fun enviarTokenFcmSePossivel(tokenFcm: String) {
        if (_uiState.value.conexao == EstadoConexao.CONECTADO) {
            wsClient?.enviarTokenFcm(tokenFcm)
            prefs.tokenFcmPendente = null
        }
    }
}
