package com.ozi.assistant.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.ozi.assistant.OziApplication
import com.ozi.assistant.R
import com.ozi.assistant.ui.MainActivity

/**
 * Recebe as notificacoes push do Firebase Cloud Messaging (ex: "seu
 * lembrete venceu"). O envio de verdade acontece no backend
 * (src/notificacoes.js) - esta classe so cuida do lado Android: pegar o
 * token novo e mandar pro servidor, e mostrar a notificacao quando chegar.
 */
class OziFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Guarda localmente pra mandar assim que a proxima conexao WebSocket
        // abrir (o app pode nao estar conectado neste exato momento).
        val repositorio = (application as OziApplication).repository
        repositorio.preferencias().tokenFcmPendente = token
        repositorio.enviarTokenFcmSePossivel(token)
    }

    override fun onMessageReceived(mensagem: RemoteMessage) {
        super.onMessageReceived(mensagem)
        val titulo = mensagem.notification?.title ?: getString(R.string.app_name)
        val corpo = mensagem.notification?.body ?: return
        mostrarNotificacao(titulo, corpo)
    }

    private fun mostrarNotificacao(titulo: String, corpo: String) {
        criarCanalSeNecessario()

        val intentAbrirApp = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intentAbrirApp, PendingIntent.FLAG_IMMUTABLE,
        )

        val notificacao = NotificationCompat.Builder(this, CANAL_ID)
            .setContentTitle(titulo)
            .setContentText(corpo)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(System.currentTimeMillis().toInt(), notificacao)
    }

    private fun criarCanalSeNecessario() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val canal = NotificationChannel(
            CANAL_ID, "Notificacoes do Ozi", NotificationManager.IMPORTANCE_DEFAULT,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    companion object {
        private const val CANAL_ID = "ozi_notificacoes"
    }
}
