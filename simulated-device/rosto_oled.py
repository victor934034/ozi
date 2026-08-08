# Demo standalone do "rosto" do Jarvis rodando direto no ESP32 (simulado no
# Wokwi), sem depender do servidor Node.js ainda - so validando que a
# animacao (piscar + olhar ao redor) funciona de verdade num display fisico
# pequeno (SSD1306 128x64 monocromatico, I2C).
#
# Como usar no Wokwi:
#   1. Cole este conteudo no main.py do seu projeto (substituindo tudo).
#   2. Crie uma aba nova chamada ssd1306.py com o driver (arquivo separado).
#   3. Confira se os pinos SDA_PIN/SCL_PIN abaixo batem com a fiacao do seu
#      diagram.json (padrao do Wokwi pro ESP32 DevKit costuma ser
#      SDA=21, SCL=22 - se a tela nao acender, ajuste esses dois numeros).
#   4. Clique em Play/Restart.

from machine import Pin, I2C
import ssd1306
import time
import random

SDA_PIN = 21
SCL_PIN = 22
LARGURA = 128
ALTURA = 64

i2c = I2C(0, sda=Pin(SDA_PIN), scl=Pin(SCL_PIN), freq=400000)
tela = ssd1306.SSD1306_I2C(LARGURA, ALTURA, i2c)

# --- Geometria dos "olhos em pilula" ---
# Um oval bem alto (raio X pequeno, raio Y grande) ja da a sensacao de
# pilula/capsula sem precisar desenhar cantos arredondados manualmente -
# fica bem mais suave que um retangulo reto.
OLHO_RAIO_X = 11
OLHO_RAIO_Y = 17
OLHO_CENTRO_Y = ALTURA // 2
OLHO_E_CENTRO_X = 38
OLHO_D_CENTRO_X = LARGURA - 38


def desenhar_olhos(deslocamento_x=0, deslocamento_y=0, fator_altura=1.0):
    """Desenha os dois olhos. fator_altura < 1 = olho mais fechado (piscando)."""
    tela.fill(0)

    raio_y = max(1, int(OLHO_RAIO_Y * fator_altura))
    y = OLHO_CENTRO_Y + deslocamento_y

    tela.ellipse(OLHO_E_CENTRO_X + deslocamento_x, y, OLHO_RAIO_X, raio_y, 1, True)
    tela.ellipse(OLHO_D_CENTRO_X + deslocamento_x, y, OLHO_RAIO_X, raio_y, 1, True)

    tela.show()


def piscar():
    """Fecha e abre os olhos rapido, tipo uma piscada natural."""
    for fator in (0.6, 0.15, 0.6, 1.0):
        desenhar_olhos(fator_altura=fator)
        time.sleep_ms(35)


def olhar_ao_redor():
    """Desloca os olhos pro lado por um instante, como se prestasse atencao
    em algo, depois volta pro centro."""
    dx = random.randint(-6, 6)
    dy = random.randint(-3, 3)
    desenhar_olhos(deslocamento_x=dx, deslocamento_y=dy)
    time.sleep_ms(900)
    desenhar_olhos()


def loop_principal():
    desenhar_olhos()
    proximo_piscar = time.ticks_add(time.ticks_ms(), 3000)
    proximo_olhar = time.ticks_add(time.ticks_ms(), 5000)

    while True:
        agora = time.ticks_ms()

        if time.ticks_diff(agora, proximo_piscar) >= 0:
            piscar()
            proximo_piscar = time.ticks_add(time.ticks_ms(), random.randint(2500, 5500))

        if time.ticks_diff(agora, proximo_olhar) >= 0:
            olhar_ao_redor()
            proximo_olhar = time.ticks_add(time.ticks_ms(), random.randint(4500, 8000))

        time.sleep_ms(50)


loop_principal()
