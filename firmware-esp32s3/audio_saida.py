# Toca audio WAV (o formato que o TTS da Fish Audio manda, FISH_AUDIO_FORMAT
# no .env do servidor) no alto-falante via I2S + codec ES8311. Le o
# cabecalho RIFF/WAV pra descobrir taxa de amostragem/bits/canais de
# verdade em vez de supor um valor fixo - o servidor pode mudar isso.

import struct
from machine import I2S, Pin

# --- Pinos do barramento I2S (config oficial da placa, ver comentario no
# topo do main.py - os pinos de I2C/MCLK/PA ficam no es8311.py, que quem
# monta o codec em main.py) ---
_BCLK = 9
_WS = 45
# O comentario do firmware original (config.h do xiaozhi) tinha DIN/DOUT
# invertidos - confirmado testando na placa fisica que o pino de dados de
# SAIDA (alto-falante) e o 10, nao o 8 como o nome da macro sugeria.
_DOUT = 10


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


class SaidaAudio:
    def __init__(self, codec):
        self.codec = codec
        self._i2s = None
        self._rate_atual = None

    def _garantir_i2s(self, sample_rate, bits, canais):
        # Reabre o I2S so quando o formato muda (a maioria das respostas do
        # TTS deve vir com o mesmo sample rate, entao isso normalmente so
        # acontece uma vez).
        if self._i2s is not None and self._rate_atual == (sample_rate, bits, canais):
            return

        if self._i2s is not None:
            self._i2s.deinit()

        self._i2s = I2S(
            0,
            sck=Pin(_BCLK),
            ws=Pin(_WS),
            sd=Pin(_DOUT),
            mode=I2S.TX,
            bits=bits,
            format=I2S.MONO if canais == 1 else I2S.STEREO,
            rate=sample_rate,
            ibuf=20000,
        )
        self._rate_atual = (sample_rate, bits, canais)

    def tocar_wav(self, dados_wav):
        sample_rate, bits, canais, offset = _ler_cabecalho_wav(dados_wav)
        self._garantir_i2s(sample_rate, bits, canais)
        self._i2s.write(dados_wav[offset:])
