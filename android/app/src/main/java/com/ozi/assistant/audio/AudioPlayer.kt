package com.ozi.assistant.audio

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/**
 * Toca o audio WAV que o servidor manda como mensagem binaria (resposta da
 * Fish Audio) - mesmo formato que o fake-device.js ja consome no lado
 * Node.js, so que aqui via MediaPlayer nativo do Android em vez de
 * PowerShell. Grava num arquivo temporario porque MediaPlayer trabalha bem
 * melhor com um path/arquivo do que tentando tocar direto de memoria.
 */
class AudioPlayer(private val context: Context) {

    private var mediaPlayer: MediaPlayer? = null

    fun tocar(audio: ByteArray, aoTerminar: () -> Unit = {}) {
        pararTudo()

        val arquivoTemp = File(context.cacheDir, "ozi_fala_${System.currentTimeMillis()}.wav")
        try {
            FileOutputStream(arquivoTemp).use { it.write(audio) }
        } catch (e: Exception) {
            Log.e(TAG, "erro salvando audio temporario", e)
            aoTerminar()
            return
        }

        mediaPlayer = MediaPlayer().apply {
            try {
                setDataSource(arquivoTemp.absolutePath)
                setOnPreparedListener { start() }
                setOnCompletionListener {
                    arquivoTemp.delete()
                    aoTerminar()
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "erro tocando audio: what=$what extra=$extra")
                    arquivoTemp.delete()
                    aoTerminar()
                    true
                }
                prepareAsync()
            } catch (e: Exception) {
                Log.e(TAG, "erro preparando player", e)
                arquivoTemp.delete()
                aoTerminar()
            }
        }
    }

    fun pararTudo() {
        mediaPlayer?.let {
            try {
                if (it.isPlaying) it.stop()
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "erro parando player anterior", e)
            }
        }
        mediaPlayer = null
    }

    companion object {
        private const val TAG = "OziAudioPlayer"
    }
}
