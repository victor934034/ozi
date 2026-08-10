package com.ozi.assistant.ui

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.ozi.assistant.ui.theme.OziAzulClaro
import com.ozi.assistant.ui.theme.OziGlow

/**
 * Wordmark oficial do Ozi: "Ozi" em gradiente azul -> ciano, sem ornamento
 * extra (conceito 4 do brand sheet). Reusado no cabecalho do login e da
 * tela principal pra manter a mesma marca em todo canto do app.
 */
@Composable
fun OziWordmark(modifier: Modifier = Modifier, fontSize: TextUnit = 40.sp) {
    BasicText(
        text = "Ozi",
        modifier = modifier,
        style = TextStyle(
            brush = Brush.linearGradient(listOf(OziAzulClaro, OziGlow)),
            fontWeight = FontWeight.ExtraBold,
            fontSize = fontSize,
            letterSpacing = (-0.5).sp,
        ),
    )
}
