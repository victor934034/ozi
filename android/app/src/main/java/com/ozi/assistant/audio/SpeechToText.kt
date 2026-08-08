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
                    val texto = results
                        .getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
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
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
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
