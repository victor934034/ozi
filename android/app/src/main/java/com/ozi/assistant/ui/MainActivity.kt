package com.ozi.assistant.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.ozi.assistant.OziApplication
import com.ozi.assistant.R
import com.ozi.assistant.service.OziListenerService
import com.ozi.assistant.ui.theme.OziTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val viewModel: OziViewModel by viewModels {
        OziViewModel.Factory((application as OziApplication).repository)
    }

    private val pedirPermissoes = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { resultados ->
        // Mesmo se negar o microfone, o app continua utilizavel pra
        // digitar - so a parte de voz fica indisponivel.
        if (resultados[Manifest.permission.RECORD_AUDIO] == true) {
            iniciarServicoEmSegundoPlano()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            OziTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TelaPrincipal()
                }
            }
        }
    }

    @Composable
    private fun TelaPrincipal() {
        val estado by viewModel.uiState.collectAsState()
        var telaConfiguracoes by remember { mutableStateOf(false) }
        var erroGoogle by remember { mutableStateOf<String?>(null) }
        val googleWebClientId = stringResource(R.string.google_web_client_id)

        when {
            !estado.logado -> {
                LoginScreen(
                    googleDisponivel = googleWebClientId.isNotBlank(),
                    erroExterno = erroGoogle,
                    aoEntrarComEmailSenha = { email, senha ->
                        viewModel.entrarComEmailSenha(email, senha)
                        aposLogin()
                    },
                    aoCriarConta = { email, senha, nome ->
                        viewModel.criarConta(email, senha, nome)
                        aposLogin()
                    },
                    aoClicarGoogle = {
                        erroGoogle = null
                        iniciarLoginGoogle(
                            webClientId = googleWebClientId,
                            aoErro = { erroGoogle = it },
                            aoSucesso = { aposLogin() },
                        )
                    },
                )
            }
            telaConfiguracoes -> {
                SettingsScreen(
                    viewModel = viewModel,
                    aoVoltar = { telaConfiguracoes = false },
                    aoSalvar = {
                        telaConfiguracoes = false
                        viewModel.desconectar()
                        viewModel.conectar()
                        pedirIgnorarOtimizacaoBateria()
                    },
                )
            }
            else -> {
                HomeScreen(
                    viewModel = viewModel,
                    aoAbrirConfiguracoes = { telaConfiguracoes = true },
                    aoPedirEscuta = { viewModel.comecarAEscutar() },
                )
            }
        }
    }

    private fun aposLogin() {
        pedirPermissoesNecessarias()
        if (viewModel.preferencias().estaConfigurado) viewModel.conectar()
    }

    override fun onStart() {
        super.onStart()
        if (viewModel.preferencias().estaLogado && viewModel.preferencias().estaConfigurado) {
            pedirPermissoesNecessarias()
            viewModel.conectar()
        }
    }

    // --- Login com Google (Credential Manager) ---
    // Precisa do google_web_client_id (res/values/strings.xml) configurado
    // com o "Web client ID" do projeto Firebase - sem isso o botao fica
    // desabilitado na tela de login (ver LoginScreen.kt).
    private fun iniciarLoginGoogle(webClientId: String, aoErro: (String) -> Unit, aoSucesso: () -> Unit) {
        if (webClientId.isBlank()) return

        val opcaoGoogle = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(opcaoGoogle)
            .build()

        lifecycleScope.launch {
            try {
                val credentialManager = CredentialManager.create(this@MainActivity)
                val resultado = credentialManager.getCredential(this@MainActivity, request)
                val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(resultado.credential.data)
                viewModel.entrarComGoogle(googleIdTokenCredential.idToken)
                aoSucesso()
            } catch (e: GetCredentialException) {
                // Cobre desde "usuario cancelou" ate "nenhuma conta Google
                // configurada no aparelho/emulador" ou "Play Services
                // ausente" - mostra a mensagem real em vez de falhar calado.
                aoErro(e.message ?: "Nao foi possivel usar login com Google neste aparelho (${e.type}).")
            } catch (e: Exception) {
                // Login no backend falhou (ex: GOOGLE_CLIENT_ID nao bate,
                // servidor fora do ar).
                aoErro(e.message ?: "Erro ao entrar com Google.")
            }
        }
    }

    private fun pedirPermissoesNecessarias() {
        val permissoes = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissoes += Manifest.permission.POST_NOTIFICATIONS
        }

        val faltando = permissoes.filter {
            ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }

        if (faltando.isEmpty()) {
            iniciarServicoEmSegundoPlano()
        } else {
            pedirPermissoes.launch(faltando.toTypedArray())
        }
    }

    private fun iniciarServicoEmSegundoPlano() {
        if (!viewModel.preferencias().estaConfigurado || !viewModel.preferencias().estaLogado) return
        val intent = Intent(this, OziListenerService::class.java)
        ContextCompat.startForegroundService(this, intent)
    }

    /**
     * Sem isso, o Android pode "congelar" o servico em segundo plano depois
     * de um tempo pra economizar bateria, o que mataria a escuta do wake
     * word com a tela apagada. Pede pro usuario liberar manualmente -
     * o sistema sempre mostra essa tela de confirmacao, nao da pra pular.
     */
    private fun pedirIgnorarOtimizacaoBateria() {
        val powerManager = getSystemService(PowerManager::class.java)
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) return

        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:$packageName")
        }
        startActivity(intent)
    }
}
