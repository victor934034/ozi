package com.ozi.assistant.service

import ai.picovoice.porcupine.PorcupineException
import ai.picovoice.porcupine.PorcupineManager
import ai.picovoice.porcupine.PorcupineManagerCallback
import android.content.Context
import android.util.Log

/**
 * Deteccao do wake word "Ozi", rodando 100% local no aparelho (nao manda
 * audio pra nenhum servidor so pra ficar "escutando" - so quando a palavra
 * e detectada e que o app comeca a gravar de verdade).
 *
 * PENDENCIA (2 coisas que so voce consegue fazer, sao passos manuais no
 * site da Picovoice, nao da pra automatizar por codigo):
 *
 *   1. Crie uma conta gratuita em https://console.picovoice.ai
 *   2. Pegue sua "AccessKey" (fica no painel) e cole nas Configuracoes do
 *      app (SecurePrefs.chavePicovoice)
 *   3. Na aba "Porcupine" do console, treine uma wake word customizada
 *      "Ozi" pra plataforma ANDROID - isso gera um arquivo .ppn
 *   4. Baixe esse arquivo, renomeie pra "ozi_android.ppn" e coloque em
 *      app/src/main/assets/ozi_android.ppn
 *
 * Sem isso, `estaConfigurado()` devolve false e o servico cai automatico
 * pro modo "so botao manual" (ver OziListenerService) - o app continua
 * funcionando normalmente, so sem a ativacao por voz em segundo plano.
 */
class WakeWordDetector(
    private val context: Context,
    private val chaveAcesso: String,
    private val aoDetectarWakeWord: () -> Unit,
) {
    private var manager: PorcupineManager? = null

    fun estaConfigurado(): Boolean {
        if (chaveAcesso.isBlank()) return false
        return try {
            context.assets.open(NOME_ARQUIVO_KEYWORD).close()
            true
        } catch (e: Exception) {
            false
        }
    }

    fun iniciar(): Boolean {
        if (!estaConfigurado()) {
            Log.w(TAG, "wake word nao configurado (falta AccessKey ou $NOME_ARQUIVO_KEYWORD nos assets)")
            return false
        }

        return try {
            manager = PorcupineManager.Builder()
                .setAccessKey(chaveAcesso)
                .setKeywordPath("file:///android_asset/$NOME_ARQUIVO_KEYWORD")
                .setSensitivity(0.6f)
                .build(context, object : PorcupineManagerCallback {
                    override fun invoke(keywordIndex: Int) {
                        aoDetectarWakeWord()
                    }
                })
            manager?.start()
            Log.i(TAG, "wake word ativo, escutando por \"Ozi\"")
            true
        } catch (e: PorcupineException) {
            Log.e(TAG, "erro iniciando Porcupine", e)
            false
        }
    }

    fun pausar() {
        try {
            manager?.stop()
        } catch (e: PorcupineException) {
            Log.w(TAG, "erro pausando Porcupine", e)
        }
    }

    fun retomar() {
        try {
            manager?.start()
        } catch (e: PorcupineException) {
            Log.w(TAG, "erro retomando Porcupine", e)
        }
    }

    fun liberar() {
        try {
            manager?.delete()
        } catch (e: Exception) {
            Log.w(TAG, "erro liberando Porcupine", e)
        }
        manager = null
    }

    companion object {
        private const val TAG = "OziWakeWord"
        private const val NOME_ARQUIVO_KEYWORD = "ozi_android.ppn"
    }
}
