package com.ozi.assistant.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Guarda a configuracao do app (URL do servidor, identidade do dispositivo)
 * em SharedPreferences CRIPTOGRAFADAS no disco (androidx.security), em vez
 * de texto puro. Hoje isso so guarda a URL do servidor e um UUID gerado
 * localmente, mas o mesmo lugar e onde entraria um token de autenticacao
 * de usuario no futuro, se o backend crescer pra suportar contas -
 * a app ja nao guarda nada em texto plano por padrao.
 */
class SecurePrefs(context: Context) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "ozi_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var urlServidor: String
        get() = prefs.getString(CHAVE_URL_SERVIDOR, "") ?: ""
        set(value) { prefs.edit().putString(CHAVE_URL_SERVIDOR, value).apply() }

    var nomeDispositivo: String
        get() = prefs.getString(CHAVE_NOME_DISPOSITIVO, "Ozi (Android)") ?: "Ozi (Android)"
        set(value) { prefs.edit().putString(CHAVE_NOME_DISPOSITIVO, value).apply() }

    var chavePicovoice: String
        get() = prefs.getString(CHAVE_PICOVOICE, "") ?: ""
        set(value) { prefs.edit().putString(CHAVE_PICOVOICE, value).apply() }

    var wakeWordAtivo: Boolean
        get() = prefs.getBoolean(CHAVE_WAKE_WORD_ATIVO, false)
        set(value) { prefs.edit().putBoolean(CHAVE_WAKE_WORD_ATIVO, value).apply() }

    /** Token JWT emitido no login - mandado no WebSocket antes de qualquer
     * outra coisa (ver OziWebSocketClient). Null = usuario nao logado. */
    var tokenAcesso: String?
        get() = prefs.getString(CHAVE_TOKEN, null)
        set(value) { prefs.edit().putString(CHAVE_TOKEN, value).apply() }

    var emailUsuario: String
        get() = prefs.getString(CHAVE_EMAIL_USUARIO, "") ?: ""
        set(value) { prefs.edit().putString(CHAVE_EMAIL_USUARIO, value).apply() }

    val estaLogado: Boolean
        get() = !tokenAcesso.isNullOrBlank()

    fun sair() {
        prefs.edit().remove(CHAVE_TOKEN).remove(CHAVE_EMAIL_USUARIO).apply()
    }

    /** Token do Firebase Cloud Messaging - guardado ate conseguir mandar
     * pro servidor (o app pode receber um token novo antes de estar
     * conectado ao WebSocket). Ver OziFirebaseMessagingService. */
    var tokenFcmPendente: String?
        get() = prefs.getString(CHAVE_TOKEN_FCM, null)
        set(value) { prefs.edit().putString(CHAVE_TOKEN_FCM, value).apply() }

    /**
     * ID estavel do dispositivo, gerado uma vez e reaproveitado sempre -
     * mesmo padrao do fake-device.js no lado Node.js (data/fake-device-id.txt),
     * so que aqui persistido de forma criptografada no proprio Android.
     */
    val deviceId: String
        get() {
            val existente = prefs.getString(CHAVE_DEVICE_ID, null)
            if (existente != null) return existente

            val novo = UUID.randomUUID().toString()
            prefs.edit().putString(CHAVE_DEVICE_ID, novo).commit()
            return novo
        }

    val estaConfigurado: Boolean
        get() = urlServidor.isNotBlank()

    companion object {
        private const val CHAVE_URL_SERVIDOR = "url_servidor"
        private const val CHAVE_NOME_DISPOSITIVO = "nome_dispositivo"
        private const val CHAVE_DEVICE_ID = "device_id"
        private const val CHAVE_PICOVOICE = "chave_picovoice"
        private const val CHAVE_WAKE_WORD_ATIVO = "wake_word_ativo"
        private const val CHAVE_TOKEN = "token_acesso"
        private const val CHAVE_EMAIL_USUARIO = "email_usuario"
        private const val CHAVE_TOKEN_FCM = "token_fcm_pendente"
    }
}
