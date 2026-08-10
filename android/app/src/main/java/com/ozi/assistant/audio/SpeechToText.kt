package com.ozi.assistant.audio

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * Reconhecimento de voz nativo do Android (o mesmo motor que o teclado do
 * Google/Assistente usa) - gratuito, sem precisar de chave de API nem
 * chamada extra pro Claude so pra transcrever.
 */
class SpeechToText(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null

    fun estaDisponivel(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun escutar(aoReconhecer: (String) -> Unit, aoErro: (String) -> Unit) {
        if (!estaDisponivel()) {
            aoErro("Reconhecimento de voz nao disponivel neste aparelho.")
            return
        }

        pararEscuta()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    val candidatos = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    // Se alguma das hipoteses reconhecidas comecar com "ozi"/"ozy"
                    // (o jeito que a pessoa costuma comecar a falar com o
                    // assistente), prioriza ela sobre a 1a hipotese - o motor de
                    // voz erra bastante essa palavra especifica por ser um nome
                    // fora do vocabulario comum em portugues.
                    val texto = candidatos
                        ?.firstOrNull { it.trim().startsWith("ozi", ignoreCase = true) || it.trim().startsWith("ozy", ignoreCase = true) }
                        ?: candidatos?.firstOrNull()
                    if (texto.isNullOrBlank()) {
                        aoErro("Nao entendi, pode repetir?")
                    } else {
                        aoReconhecer(texto)
                    }
                }

                override fun onError(error: Int) {
                    Log.w(TAG, "erro no reconhecimento de voz: codigo $error")
                    aoErro(descreverErro(error))
                }

                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                // Motor online do Google reconhece MUITO melhor que o offline
                // (vocabulario maior, atualizado) - so cai pro offline sozinho
                // se o aparelho estiver sem internet.
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
                // Pede varias hipoteses em vez de uma so - "Ozi" (nome fora do
                // dicionario comum) tende a aparecer como uma das alternativas
                // mesmo quando a 1a hipotese erra pra uma palavra parecida
                // (ex: "rosa"), entao vale a pena considerar as outras.
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            }
            startListening(intent)
        }
    }

    fun pararEscuta() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun descreverErro(codigo: Int): String = when (codigo) {
        SpeechRecognizer.ERROR_NO_MATCH -> "Nao entendi, pode repetir?"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Nao ouvi nada."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Sem conexao pra reconhecer a fala."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permissao de microfone necessaria."
        else -> "Erro no reconhecimento de voz (codigo $codigo)."
    }

    companion object {
        private const val TAG = "OziSpeechToText"
    }
}
