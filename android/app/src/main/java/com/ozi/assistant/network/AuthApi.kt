package com.ozi.assistant.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class UsuarioLogado(val id: Int, val email: String, val nome: String, val token: String)

class AuthApiException(message: String) : Exception(message)

/**
 * Fala com os endpoints REST de autenticacao do servidor (src/webServer.js)
 * - login/registro por email+senha e login com Google. O WebSocket em si
 * (OziWebSocketClient) so entra em cena DEPOIS que ja temos um token daqui.
 */
class AuthApi(private val urlServidorWs: String) {

    private val cliente = OkHttpClient()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    // O servidor e um processo unico: mesma porta/dominio serve o WebSocket
    // e a API REST (ver src/app.js) - so troca o esquema da URL.
    private fun urlBaseHttp(): String {
        return urlServidorWs
            .replace("wss://", "https://")
            .replace("ws://", "http://")
    }

    suspend fun login(email: String, senha: String): UsuarioLogado = withContext(Dispatchers.IO) {
        chamar("/api/auth/login", JSONObject().put("email", email).put("senha", senha))
    }

    suspend fun registrar(email: String, senha: String, nome: String): UsuarioLogado = withContext(Dispatchers.IO) {
        chamar(
            "/api/auth/registrar",
            JSONObject().put("email", email).put("senha", senha).put("nome", nome),
        )
    }

    suspend fun loginComGoogle(idToken: String): UsuarioLogado = withContext(Dispatchers.IO) {
        chamar("/api/auth/google", JSONObject().put("idToken", idToken))
    }

    private fun chamar(caminho: String, corpo: JSONObject): UsuarioLogado {
        val request = Request.Builder()
            .url(urlBaseHttp() + caminho)
            .post(corpo.toString().toRequestBody(JSON))
            .build()

        cliente.newCall(request).execute().use { resposta ->
            val texto = resposta.body?.string() ?: "{}"
            val json = JSONObject(texto)

            if (!json.optBoolean("ok", false)) {
                throw AuthApiException(json.optString("erro", "Erro desconhecido no servidor."))
            }

            val usuario = json.getJSONObject("usuario")
            return UsuarioLogado(
                id = usuario.getInt("id"),
                email = usuario.getString("email"),
                nome = usuario.getString("nome"),
                token = json.getString("token"),
            )
        }
    }
}
