package com.ozi.assistant.network

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Estado interno de humor que o servidor manda (estabilidade/eficiencia/
 * nivel_alerta) - o mesmo conceito da Parte 4 do projeto original, so que
 * consumido aqui pelo app em vez da pagina web.
 */
data class EstadoOzi(
    val estabilidade: Double,
    val eficiencia: Double,
    val nivelAlerta: Double,
)

/** Callbacks pro resto do app reagir ao que chega do servidor. */
interface OziWebSocketListener {
    fun aoAutenticado(estado: EstadoOzi?) {}
    fun aoErroAutenticacao(mensagem: String) {}
    fun aoDesconectar() {}
    fun aoErro(mensagem: String) {}
    fun aoRecebermensagemTexto(texto: String, estado: EstadoOzi?) {}
    fun aoRecebermensagemTts(mensagemErro: String) {}
    fun aoReceberAudio(audio: ByteArray) {}
}

/**
 * Fala o mesmo protocolo WebSocket que o `server.js` do Ozi ja implementa
 * (ver src/server.js e src/device/fakeDevice.js no projeto Node.js) -
 * mensagens de texto viram JSON, e o audio da resposta chega como uma
 * mensagem BINARIA separada (WAV puro).
 *
 * Toda conexao PRECISA se autenticar primeiro com o token de login (JWT)
 * antes de mandar/receber qualquer outra coisa - o servidor recusa
 * qualquer mensagem antes disso. So depois de autenticado e que a gente
 * manda "identificar" pra registrar este aparelho especifico.
 */
class OziWebSocketClient(
    private val urlServidor: String,
    private val tokenAcesso: String,
    private val deviceId: String,
    private val deviceNome: String,
    private val listener: OziWebSocketListener,
) {
    private var webSocket: WebSocket? = null

    private val cliente = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // WebSocket fica aberto indefinidamente
        .build()

    fun conectar() {
        val request = Request.Builder().url(urlServidor).build()
        webSocket = cliente.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "conexao aberta com $urlServidor, autenticando...")
                autenticar()
            }

            override fun onMessage(ws: WebSocket, text: String) {
                processarMensagemTexto(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                listener.aoReceberAudio(bytes.toByteArray())
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "conexao encerrada: $reason")
                listener.aoDesconectar()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "erro de conexao", t)
                listener.aoErro(t.message ?: "erro desconhecido de conexao")
                listener.aoDesconectar()
            }
        })
    }

    fun desconectar() {
        webSocket?.close(1000, "app fechado")
        webSocket = null
    }

    fun enviarTexto(texto: String) {
        val payload = JSONObject().apply {
            put("type", "user_text")
            put("text", texto)
        }
        webSocket?.send(payload.toString())
    }

    private fun autenticar() {
        val payload = JSONObject().apply {
            put("type", "autenticar")
            put("token", tokenAcesso)
        }
        webSocket?.send(payload.toString())
    }

    private fun identificarDispositivo() {
        val payload = JSONObject().apply {
            put("type", "identificar")
            put("device_id", deviceId)
            put("nome", deviceNome)
        }
        webSocket?.send(payload.toString())
    }

    private fun processarMensagemTexto(texto: String) {
        val json = try {
            JSONObject(texto)
        } catch (e: Exception) {
            Log.e(TAG, "mensagem invalida do servidor: $texto", e)
            return
        }

        when (json.optString("type")) {
            "autenticado" -> {
                identificarDispositivo()
                listener.aoAutenticado(json.optJSONObject("estado")?.let(::parseEstado))
            }
            "erro_auth" -> listener.aoErroAutenticacao(json.optString("texto"))
            "assistant_text" -> {
                val estado = json.optJSONObject("estado")?.let(::parseEstado)
                listener.aoRecebermensagemTexto(json.optString("text"), estado)
            }
            "tts_erro" -> listener.aoRecebermensagemTts(json.optString("texto"))
            "erro" -> listener.aoErro(json.optString("texto"))
        }
    }

    private fun parseEstado(json: JSONObject): EstadoOzi = EstadoOzi(
        estabilidade = json.optDouble("estabilidade", 1.0),
        eficiencia = json.optDouble("eficiencia", 1.0),
        nivelAlerta = json.optDouble("nivel_alerta", 0.0),
    )

    companion object {
        private const val TAG = "OziWebSocket"
    }
}
