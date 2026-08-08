package com.ozi.assistant.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.ozi.assistant.OziApplication
import com.ozi.assistant.R
import com.ozi.assistant.ui.MainActivity

/**
 * Servico em primeiro plano que mantem o Ozi "escutando" o wake word mesmo
 * com o app em segundo plano ou a tela bloqueada. Precisa rodar como
 * foreground service com notificacao visivel (exigencia do proprio
 * Android - nao da pra escutar microfone escondido do usuario).
 *
 * Se o wake word nao estiver configurado ainda (sem chave/arquivo da
 * Picovoice), o servico sobe mesmo assim mas so mantem a conexao WebSocket
 * viva - a ativacao por voz em segundo plano fica indisponivel ate voce
 * configurar (ver WakeWordDetector.kt), mas o app continua 100% usavel
 * pelo botao manual na tela.
 */
class OziListenerService : Service() {

    override fun onCreate() {
        super.onCreate()
        criarCanalNotificacao()
        startForeground(ID_NOTIFICACAO, criarNotificacao())

        val repositorio = (application as OziApplication).repository
        repositorio.conectar()
        repositorio.iniciarWakeWord()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY: se o sistema matar o processo por falta de memoria,
        // tenta recriar o servico depois (sem reenviar o intent original).
        return START_STICKY
    }

    override fun onDestroy() {
        val repositorio = (application as OziApplication).repository
        repositorio.pararWakeWord()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun criarCanalNotificacao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val canal = NotificationChannel(
            CANAL_ID,
            getString(R.string.canal_notificacao_servico),
            NotificationManager.IMPORTANCE_LOW,
        )
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(canal)
    }

    private fun criarNotificacao(): Notification {
        val intentAbrirApp = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intentAbrirApp,
            PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CANAL_ID)
            .setContentTitle(getString(R.string.notificacao_titulo))
            .setContentText(getString(R.string.notificacao_texto))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CANAL_ID = "ozi_listener_channel"
        private const val ID_NOTIFICACAO = 1
    }
}
