package com.ozi.assistant.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val OziAzul = Color(0xFF2F6BFF)
// Gradiente do wordmark "Ozi" (login, cabecalhos) - mesmas duas cores usadas
// na pagina web (public/index.html) e nos conceitos de logo aprovados.
val OziAzulClaro = Color(0xFF6FA0FF)
val OziGlow = Color(0xFF6FE3FF)
val OziAlerta = Color(0xFFFF7A5C)
val OziInstavel = Color(0xFF6C93A6)
val OziFundo = Color(0xFF0A0C10)
val OziPainel = Color(0xFF10151C)
val OziBorda = Color(0xFF1C2530)
val OziTexto = Color(0xFFE8ECF1)
val OziTextoFraco = Color(0xFF7D8896)

private val EsquemaCores = darkColorScheme(
    primary = OziAzul,
    background = OziFundo,
    surface = OziPainel,
    onBackground = OziTexto,
    onSurface = OziTexto,
)

@Composable
fun OziTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = EsquemaCores, content = content)
}
