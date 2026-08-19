# Driver MicroPython pro codec de audio ES8311 (alto-falante E microfone).
# A tabela _REGISTROS_LIGAR e baseada no driver de
# raptor09010/Micropython-ES8311-Library (MIT), mas esse driver so cobre o
# caminho de tocar som (DAC) - testando na placa fisica, o microfone gravava
# so silencio/zeros com ele sozinho. _REGISTROS_LIGAR_MIC completa a
# inicializacao com a sequencia que falta pra habilitar o caminho do
# ADC/microfone, baseada no driver oficial da Espressif (esp-adf,
# es8311_start() com ES_MODULE_ADC_DAC).

import time
from machine import PWM, Pin, I2C

ES8311_ADDR = 0x18

_REGISTROS_LIGAR = [
    (0x00, 0x80), (0x01, 0x3F), (0x02, 0x00), (0x03, 0x10), (0x04, 0x10),
    (0x05, 0x00), (0x06, 0x03), (0x07, 0x00), (0x08, 0xFF), (0x09, 0x0C),
    (0x0A, 0x4C), (0x0B, 0x00), (0x0C, 0x00), (0x0D, 0x01), (0x0E, 0x02),
    (0x0F, 0x00), (0x10, 0x1F), (0x11, 0x7F), (0x12, 0x00), (0x13, 0x10),
    (0x14, 0x1A), (0x15, 0x40), (0x16, 0x24), (0x17, 0xBF), (0x18, 0x00),
    (0x19, 0x00), (0x1A, 0x00), (0x1B, 0x0A), (0x1C, 0x6A),
    (0x32, 0x9F), (0x37, 0x08), (0x44, 0x50),
]

# Habilita de verdade o caminho ADC (microfone) - sem isso o I2S ate capta
# algo, mas so silencio/zeros, porque o ADC do codec continua desligado.
_REGISTROS_LIGAR_MIC = [
    (0x09, 0x00),  # interface DAC sem mute
    (0x0A, 0x00),  # interface ADC sem mute
    (0x17, 0xBF),  # ganho/PGA do ADC
    (0x0E, 0x02),
    (0x12, 0x00),
    (0x14, 0x1A),  # seleciona microfone analogico (nao digital/PDM)
    (0x0D, 0x01),  # liga a parte analogica
    (0x15, 0x40),  # habilita/desmuta o ADC
    (0x37, 0x08),
    (0x45, 0x00),
    (0x44, 0x58),  # roteamento do sinal de referencia interno (ADCL+DACR)
]

_REGISTROS_DESLIGAR = [
    (0x00, 0x1F), (0x01, 0x00), (0x02, 0x00), (0x03, 0x10), (0x04, 0x10),
    (0x05, 0x00), (0x06, 0x03), (0x07, 0x00), (0x08, 0xFF), (0x09, 0x00),
    (0x0A, 0x00), (0x0B, 0x00), (0x0C, 0x20), (0x0D, 0xFC), (0x0E, 0x6A),
    (0x0F, 0x00), (0x10, 0x13), (0x11, 0x7C), (0x12, 0x02), (0x13, 0x40),
    (0x14, 0x10), (0x15, 0x00), (0x16, 0x04), (0x17, 0x00), (0x18, 0x00),
    (0x19, 0x00), (0x1A, 0x00), (0x1B, 0x0C), (0x1C, 0x4C),
    (0x32, 0x00), (0x37, 0x08), (0x44, 0x00),
]


class ES8311:
    def __init__(self, scl, sda, mck, pa_pin, rate=16000):
        self.scl = scl
        self.sda = sda
        self.mck = mck
        self.rate = rate
        self.i2c = None
        self.mclk = None
        self.amp_enable = Pin(pa_pin, Pin.OUT)

    def ligar(self):
        self.amp_enable.value(1)
        self.i2c = I2C(1, scl=Pin(self.scl), sda=Pin(self.sda), freq=400_000)
        # MCLK gerado por PWM (nao precisa que o periferico I2S do
        # MicroPython suporte saida de MCLK nativa, que essa build nao tem).
        self.mclk = PWM(Pin(self.mck), freq=self.rate * 256, duty_u16=32768)

        for registrador, valor in _REGISTROS_LIGAR:
            self._escrever(registrador, valor)
            time.sleep_ms(10)

        for registrador, valor in _REGISTROS_LIGAR_MIC:
            self._escrever(registrador, valor)
            time.sleep_ms(10)

    def desligar(self):
        for registrador, valor in _REGISTROS_DESLIGAR:
            self._escrever(registrador, valor)
            time.sleep_ms(10)

        if self.mclk:
            self.mclk.deinit()
            self.mclk = None
        self.i2c = None
        self.amp_enable.value(0)

    def _escrever(self, registrador, valor):
        self.i2c.writeto_mem(ES8311_ADDR, registrador, bytes([valor]))

    def volume(self, porcentagem):
        porcentagem = max(0, min(100, porcentagem))
        self._escrever(0x32, int(255 * porcentagem / 100))
