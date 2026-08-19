# Captura audio do microfone (ES8311 ADC, via I2S) - so grava, nao manda
# pra lugar nenhum ainda (o servidor Ozi ainda nao sabe transcrever audio,
# ver comentario no topo do main.py). Serve pra testar o caminho de
# hardware sozinho (gravar e tocar de volta) antes de fechar a parte do
# servidor.
#
# IMPORTANTE: so um lado do I2S (falar OU ouvir) fica ativo de cada vez -
# o driver machine.I2S do MicroPython nao suporta full-duplex num so
# periferico, e os dois lados (TX do alto-falante, RX do microfone)
# compartilham os mesmos pinos de clock (BCLK/WS) nessa placa. Pra
# "conversar" (falar e ouvir ao mesmo tempo) precisaria de outra abordagem -
# nao e um problema pro uso "segura o botao, fala, solta" que estamos
# fazendo por enquanto.

import struct
from machine import I2S, Pin

_BCLK = 9
_WS = 45
# Complementar ao pino de saida do alto-falante (10) - o comentario do
# config.h original do xiaozhi tinha DIN/DOUT trocados (ver audio_saida.py),
# entao o pino de ENTRADA (microfone) e o 8.
_DIN = 8

TAXA_AMOSTRAGEM = 16000
BITS = 16


def _cabecalho_wav(tamanho_pcm, sample_rate=TAXA_AMOSTRAGEM, bits=BITS, canais=1):
    bloco_align = canais * bits // 8
    byte_rate = sample_rate * bloco_align
    cabecalho = b"RIFF" + struct.pack("<I", 36 + tamanho_pcm) + b"WAVE"
    cabecalho += b"fmt " + struct.pack("<IHHIIHH", 16, 1, canais, sample_rate, byte_rate, bloco_align, bits)
    cabecalho += b"data" + struct.pack("<I", tamanho_pcm)
    return cabecalho


def gravar(duracao_s, sample_rate=TAXA_AMOSTRAGEM):
    """Grava por N segundos e devolve os bytes de um arquivo WAV completo
    (cabecalho + PCM). Bloqueia a thread inteira enquanto grava - ok pro
    nosso caso de uso (botao segurado), mas nao roda outra coisa em
    paralelo nesse tempo."""
    i2s = I2S(
        1,
        sck=Pin(_BCLK),
        ws=Pin(_WS),
        sd=Pin(_DIN),
        mode=I2S.RX,
        bits=BITS,
        format=I2S.MONO,
        rate=sample_rate,
        ibuf=20000,
    )

    tamanho_pcm = int(sample_rate * duracao_s) * (BITS // 8)
    pcm = bytearray(tamanho_pcm)
    try:
        i2s.readinto(pcm)
    finally:
        i2s.deinit()

    return _cabecalho_wav(len(pcm), sample_rate) + pcm
