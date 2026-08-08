package com.ozi.assistant.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ozi.assistant.data.EstadoAtividade
import com.ozi.assistant.data.EstadoConexao
import com.ozi.assistant.data.MensagemConversa
import com.ozi.assistant.ui.theme.OziTextoFraco

@Composable
fun HomeScreen(
    viewModel: OziViewModel,
    aoAbrirConfiguracoes: () -> Unit,
    aoPedirEscuta: () -> Unit,
) {
    val estado by viewModel.uiState.collectAsState()
    var textoDigitado by remember { mutableStateOf("") }
    val listaEstado = rememberLazyListState()

    LaunchedEffect(estado.conversa.size) {
        if (estado.conversa.isNotEmpty()) {
            listaEstado.animateScrollToItem(estado.conversa.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("OZI") },
                actions = {
                    IconButton(onClick = aoAbrirConfiguracoes) {
                        Icon(Icons.Filled.Settings, contentDescription = "Configuracoes")
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
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = textoStatus(estado.conexao),
                color = OziTextoFraco,
                style = MaterialTheme.typography.labelMedium,
            )

            Spacer(Modifier.height(12.dp))

            OziFace(
                nivelAlerta = estado.estadoHumor?.nivelAlerta ?: 0.0,
                estabilidade = estado.estadoHumor?.estabilidade ?: 1.0,
                falando = estado.atividade == EstadoAtividade.FALANDO,
            )

            Spacer(Modifier.height(16.dp))

            Text(
                text = textoAtividade(estado.atividade),
                color = OziTextoFraco,
                style = MaterialTheme.typography.bodySmall,
            )

            Spacer(Modifier.height(16.dp))

            LazyColumn(
                state = listaEstado,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(estado.conversa) { mensagem -> LinhaConversa(mensagem) }
            }

            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = textoDigitado,
                    onValueChange = { textoDigitado = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("ou digite aqui...") },
                    singleLine = true,
                )
                Spacer(Modifier.size(8.dp))
                Button(onClick = {
                    viewModel.enviarTextoDigitado(textoDigitado)
                    textoDigitado = ""
                }) { Text("Enviar") }
            }

            Spacer(Modifier.height(8.dp))

            Button(
                onClick = aoPedirEscuta,
                enabled = estado.conexao == EstadoConexao.CONECTADO && estado.atividade == EstadoAtividade.OCIOSO,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Mic, contentDescription = null)
                Spacer(Modifier.size(8.dp))
                Text("Falar")
            }
        }
    }
}

@Composable
private fun LinhaConversa(mensagem: MensagemConversa) {
    val prefixo = if (mensagem.deQuemFalou == "voce") "Voce: " else "Ozi: "
    val cor = if (mensagem.deQuemFalou == "voce") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
    Text(text = prefixo + mensagem.texto, color = cor, style = MaterialTheme.typography.bodyMedium)
}

private fun textoStatus(conexao: EstadoConexao): String = when (conexao) {
    EstadoConexao.DESCONECTADO -> "desconectado"
    EstadoConexao.CONECTANDO -> "conectando..."
    EstadoConexao.CONECTADO -> "conectado"
}

private fun textoAtividade(atividade: EstadoAtividade): String = when (atividade) {
    EstadoAtividade.OCIOSO -> "Diga \"Ozi\" ou toque em Falar"
    EstadoAtividade.OUVINDO -> "Ouvindo..."
    EstadoAtividade.PROCESSANDO -> "Pensando..."
    EstadoAtividade.FALANDO -> "Falando..."
}
