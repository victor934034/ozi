package com.ozi.assistant.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import com.ozi.assistant.ui.theme.OziTextoFraco
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(
    viewModel: OziViewModel,
    aoVoltar: () -> Unit,
    aoSalvar: () -> Unit,
) {
    val prefs = viewModel.preferencias()
    var urlServidor by remember { mutableStateOf(prefs.urlServidor) }
    var nomeDispositivo by remember { mutableStateOf(prefs.nomeDispositivo) }
    var chavePicovoice by remember { mutableStateOf(prefs.chavePicovoice) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Configuracoes") },
                navigationIcon = {
                    IconButton(onClick = aoVoltar) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Voltar")
                    }
                },
            )
        },
    ) { paddingInterno ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingInterno)
                .padding(16.dp),
        ) {
            Text("Logado como", color = OziTextoFraco, style = MaterialTheme.typography.labelSmall)
            Text(prefs.emailUsuario)

            Spacer(Modifier.size(16.dp))

            Text("Servidor (avancado)")
            OutlinedTextField(
                value = urlServidor,
                onValueChange = { urlServidor = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(com.ozi.assistant.SERVIDOR_PADRAO) },
                singleLine = true,
            )
            Text(
                "Deixe em branco pra usar o servidor padrao do Ozi. So preencha se voce " +
                    "estiver rodando seu proprio servidor.",
                color = OziTextoFraco,
                style = MaterialTheme.typography.bodySmall,
            )

            Spacer(Modifier.size(16.dp))

            Text("Nome deste dispositivo")
            OutlinedTextField(
                value = nomeDispositivo,
                onValueChange = { nomeDispositivo = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(Modifier.size(16.dp))

            Text("Chave da Picovoice (wake word \"Ozi\")")
            OutlinedTextField(
                value = chavePicovoice,
                onValueChange = { chavePicovoice = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("AccessKey de console.picovoice.ai") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
            )
            Text(
                "Tambem precisa do arquivo ozi_android.ppn treinado no console " +
                    "da Picovoice, colocado em assets/ (ver comentario em WakeWordDetector.kt).",
                style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
            )

            Spacer(Modifier.size(24.dp))

            Button(
                onClick = {
                    prefs.urlServidor = urlServidor.trim()
                    prefs.nomeDispositivo = nomeDispositivo.trim()
                    prefs.chavePicovoice = chavePicovoice.trim()
                    aoSalvar()
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Salvar e conectar") }

            Spacer(Modifier.size(12.dp))

            OutlinedButton(
                onClick = { viewModel.sair() },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Sair da conta") }
        }
    }
}
