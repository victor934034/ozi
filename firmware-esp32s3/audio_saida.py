# Toca audio WAV (o formato que o TTS da Fish Audio manda) no alto-falante
# via I2S + codec ES8311. Le o cabecalho RIFF/WAV pra descobrir taxa de
# amostragem/bits/canais de verdade em vez de supor um valor fixo.
#
# TAXA FIXA DE SAIDA: em vez de mudar o clock do codec pra bater com
# qualquer taxa que o audio recebido tiver, sempre reamostra pra
# _TAXA_SAIDA (16kHz) antes de tocar. Testado na placa fisica: gerar o
# MCLK do codec por PWM (nao tem saida de MCLK nativa no I2S do
# MicroPython) fica preciso o bastante em ~4MHz (256 * 16kHz), mas em
# ~11MHz (256 * 44.1kHz, a taxa que a Fish Audio manda) fica impreciso
# demais e sai só uns "beeps" em vez de fala limpa. Manter uma taxa fixa e
# ja comprovada evita esse problema de vez.

import struct
import array
from machine import I2S, Pin

_BCLK = 9
_WS = 45
# O comentario do firmware original (config.h do xiaozhi) tinha DIN/DOUT
# invertidos - confirmado testando na placa fisica que o pino de dados de
# SAIDA (alto-falante) e o 10, nao o 8 como o nome da macro sugeria.
_DOUT = 10

_TAXA_SAIDA = 16000


def _ler_cabecalho_wav(dados):
    """Devolve (sample_rate, bits, canais, offset_dos_dados_pcm). Levanta
    ValueError se nao for um WAV valido - assim quem chama pode decidir o
    que fazer (ex: descartar o frame) sem o programa inteiro travar."""
    if dados[0:4] != b"RIFF" or dados[8:12] != b"WAVE":
        raise ValueError("nao e um arquivo WAV")

    pos = 12
    sample_rate = bits = canais = None
    while pos < len(dados) - 8:
        chunk_id = dados[pos : pos + 4]
        (chunk_tamanho,) = struct.unpack("<I", dados[pos + 4 : pos + 8])
        inicio_dados = pos + 8

        if chunk_id == b"fmt ":
            (canais, sample_rate) = struct.unpack("<HI", dados[inicio_dados + 2 : inicio_dados + 8])
            (bits,) = struct.unpack("<H", dados[inicio_dados + 14 : inicio_dados + 16])
        elif chunk_id == b"data":
            return sample_rate, bits, canais, inicio_dados

        pos = inicio_dados + chunk_tamanho + (chunk_tamanho % 2)  # chunks WAV sao alinhados a 2 bytes

    raise ValueError("WAV sem chunk 'data'")


def _reamostrar_16bit_mono(pcm, taxa_origem, taxa_destino):
    """Interpolacao linear simples - qualidade suficiente pra voz falada
    (nao e um resampler de qualidade de estudio, mas roda razoavel num
    microcontrolador sem biblioteca de DSP).

    Usa o modulo `array` em vez de struct.unpack numa tupla gigante - pra
    audio de alguns segundos isso significa centenas de milhares de
    numeros, e uma tupla Python guarda cada um como objeto separado (varios
    bytes de overhead cada). `array.array('h', pcm)` guarda os numeros
    nativamente (2 bytes cada, sem overhead de objeto Python) - mais leve o
    bastante pra nao estourar a memoria/travar o ESP32 (o que aconteceu
    testando com a versao anterior, baseada em struct.unpack)."""
    if taxa_origem == taxa_destino:
        return pcm

    amostras = array.array("h")
    amostras.frombytes(pcm)
    n_entrada = len(amostras)

    n_saida = int(n_entrada * taxa_destino / taxa_origem)
    saida = array.array("h", bytes(n_saida * 2))
    razao = taxa_origem / taxa_destino

    for i in range(n_saida):
        pos = i * razao
        idx = int(pos)
        frac = pos - idx
        a = amostras[idx] if idx < n_entrada else amostras[-1]
        b = amostras[idx + 1] if idx + 1 < n_entrada else amostras[-1]
        saida[i] = int(a + (b - a) * frac)

    return saida.tobytes()


class SaidaAudio:
    def __init__(self, codec):
        self.codec = codec
        self._i2s = I2S(
            0,
            sck=Pin(_BCLK),
            ws=Pin(_WS),
            sd=Pin(_DOUT),
            mode=I2S.TX,
            bits=16,
            format=I2S.MONO,
            rate=_TAXA_SAIDA,
            ibuf=20000,
        )

    def tocar_wav(self, dados_wav):
        sample_rate, bits, canais, offset = _ler_cabecalho_wav(dados_wav)
        pcm = dados_wav[offset:]

        if bits != 16 or canais != 1:
            raise ValueError("so suporta WAV 16 bits mono por enquanto (recebido: %d bits, %d canais)" % (bits, canais))

        pcm = _reamostrar_16bit_mono(pcm, sample_rate, _TAXA_SAIDA)
        self._i2s.write(pcm)
