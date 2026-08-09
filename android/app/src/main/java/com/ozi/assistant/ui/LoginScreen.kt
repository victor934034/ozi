package com.ozi.assistant.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ozi.assistant.ui.theme.OziAzul
import com.ozi.assistant.ui.theme.OziTextoFraco
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    googleDisponivel: Boolean,
    urlServidorInicial: String,
    erroExterno: String?,
    aoMudarUrlServidor: (String) -> Unit,
    aoEntrarComEmailSenha: suspend (email: String, senha: String) -> Unit,
    aoCriarConta: suspend (email: String, senha: String, nome: String) -> Unit,
    aoClicarGoogle: () -> Unit,
) {
    var modoCadastro by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var senha by remember { mutableStateOf("") }
    var nome by remember { mutableStateOf("") }
    var urlServidor by remember { mutableStateOf(urlServidorInicial) }
    var carregando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    val escopo = rememberCoroutineScope()

    // Erros que acontecem FORA desta tela (ex: login com Google, que roda
    // via Credential Manager na Activity) chegam aqui de fora - sem isso o
    // usuario nao teria como saber que o Google Sign-In falhou e por que.
    LaunchedEffect(erroExterno) {
        if (erroExterno != null) erro = erroExterno
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.size(64.dp))
        Text("OZI", style = MaterialTheme.typography.headlineMedium, color = OziAzul)
        Spacer(Modifier.size(4.dp))
        Text(
            if (modoCadastro) "Criar sua conta" else "Entrar na sua conta",
            color = OziTextoFraco,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.size(32.dp))

        OutlinedTextField(
            value = urlServidor,
            onValueChange = { urlServidor = it; aoMudarUrlServidor(it.trim()) },
            label = { Text("Servidor") },
            placeholder = { Text("ws://10.0.2.2:8787 (emulador) ou ws://SEU_IP:8787") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Text(
            "\"localhost\" no celular aponta pro proprio aparelho, nao pro seu PC. " +
                "No emulador use 10.0.2.2; num celular de verdade, use o IP do seu PC na mesma rede Wi-Fi.",
            color = OziTextoFraco,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.size(16.dp))

        if (modoCadastro) {
            OutlinedTextField(
                value = nome,
                onValueChange = { nome = it },
                label = { Text("Nome") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.size(12.dp))
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.size(12.dp))
        OutlinedTextField(
            value = senha,
            onValueChange = { senha = it },
            label = { Text("Senha") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )

        erro?.let {
            Spacer(Modifier.size(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.size(20.dp))

        Button(
            onClick = {
                erro = null
                carregando = true
                escopo.launch {
                    try {
                        if (modoCadastro) aoCriarConta(email.trim(), senha, nome.trim())
                        else aoEntrarComEmailSenha(email.trim(), senha)
                    } catch (e: Exception) {
                        erro = e.message ?: "Erro ao entrar."
                    } finally {
                        carregando = false
                    }
                }
            },
            enabled = !carregando && email.isNotBlank() && senha.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (carregando) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp))
            } else {
                Text(if (modoCadastro) "Criar conta" else "Entrar")
            }
        }

        Spacer(Modifier.size(8.dp))

        OutlinedButton(
            onClick = aoClicarGoogle,
            enabled = googleDisponivel,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (googleDisponivel) "Entrar com Google" else "Entrar com Google (nao configurado)")
        }

        Spacer(Modifier.size(16.dp))

        TextButton(onClick = { modoCadastro = !modoCadastro; erro = null }) {
            Text(if (modoCadastro) "Ja tenho conta - entrar" else "Nao tenho conta - criar uma")
        }
    }
}

