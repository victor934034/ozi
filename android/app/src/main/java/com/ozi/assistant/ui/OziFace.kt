package com.ozi.assistant.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.dp
import com.ozi.assistant.ui.theme.OziAlerta
import com.ozi.assistant.ui.theme.OziAzul
import com.ozi.assistant.ui.theme.OziInstavel
import kotlinx.coroutines.delay
import kotlin.random.Random

/**
 * O mesmo rosto minimalista (dois "olhos em pilula") usado na pagina web
 * (public/index.html) e no display OLED do simulador ESP32 - mantem a
 * identidade visual do Ozi consistente em todas as plataformas.
 */
@Composable
fun OziFace(
    nivelAlerta: Double,
    estabilidade: Double,
    falando: Boolean,
    modifier: Modifier = Modifier,
) {
    val corOlhos = when {
        nivelAlerta > 0.6 -> OziAlerta
        estabilidade < 0.3 -> OziInstavel
        else -> OziAzul
    }

    val piscar = remember { Animatable(1f) }
    val falarPulso = remember { Animatable(1f) }

    // Pisca sozinho de vez em quando quando ocioso - da vida ao rosto.
    LaunchedEffect(falando) {
        if (falando) return@LaunchedEffect
        while (true) {
            delay(Random.nextLong(2800, 5500))
            piscar.animateTo(0.1f, tween(90))
            piscar.animateTo(1f, tween(90))
        }
    }

    // Pulso nos olhos enquanto fala, tipo um medidor de audio simples
    // (mesma ideia da pagina web - esse design nao tem boca).
    LaunchedEffect(falando) {
        if (!falando) {
            falarPulso.animateTo(1f, tween(150))
            return@LaunchedEffect
        }
        while (falando) {
            falarPulso.animateTo(1f + Random.nextFloat() * 0.18f, tween(90))
            delay(90)
            falarPulso.animateTo(1f, tween(90))
            delay(40)
        }
    }

    Canvas(
        modifier = modifier
            .size(260.dp, 160.dp)
            .background(androidx.compose.ui.graphics.Color(0xFF050607), RoundedCornerShape(40.dp)),
    ) {
        val larguraOlho = size.width * 0.16f
        val alturaOlho = size.height * 0.5f * piscar.value
        val yCentro = size.height / 2f

        desenharOlho(
            centro = Offset(size.width * 0.28f, yCentro),
            largura = larguraOlho * falarPulso.value,
            altura = alturaOlho,
            cor = corOlhos,
        )
        desenharOlho(
            centro = Offset(size.width * 0.72f, yCentro),
            largura = larguraOlho * falarPulso.value,
            altura = alturaOlho,
            cor = corOlhos,
        )
    }
}

private fun DrawScope.desenharOlho(centro: Offset, largura: Float, altura: Float, cor: androidx.compose.ui.graphics.Color) {
    drawRoundRect(
        color = cor,
        topLeft = Offset(centro.x - largura / 2f, centro.y - altura / 2f),
        size = androidx.compose.ui.geometry.Size(largura, maxOf(altura, 2f)),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(largura / 2f, largura / 2f),
    )
}
