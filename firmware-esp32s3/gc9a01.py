# Driver MicroPython minimo pro display LCD redondo GC9A01 (240x240, SPI,
# 16 bits por pixel RGB565) - a tela da placa "SpotPear ESP32-S3 1.28 AI
# Ball/Box". Escrito na mao (mais simples que os drivers prontos da
# comunidade, que dependem de um framework de GUI inteiro so pra desenhar um
# rosto) - a sequencia de inicializacao dos registradores foi conferida
# contra o driver de referencia da Russ Hughes (usado pelo proprio firmware
# original do xiaozhi nessa placa).
#
# Segue a MESMA interface do ssd1306.py (fill/pixel/text/ellipse/show), pra
# o codigo do rosto poder ser reaproveitado quase sem mudanca - so troca
# cor=1 (branco/preto) por cor=tela.cor(r,g,b).

from time import sleep_ms
import framebuf


class GC9A01:
    def __init__(self, spi, cs, dc, rst, width=240, height=240):
        self.spi = spi
        self.cs = cs
        self.dc = dc
        self.rst = rst
        self.width = width
        self.height = height

        self.buffer = bytearray(width * height * 2)
        # framebuf armazena cada pixel de 16 bits em ordem little-endian na
        # memoria (byte baixo primeiro) - mas o controlador GC9A01 espera
        # receber cada pixel com o byte ALTO primeiro pelo SPI. Em vez de
        # reordenar o buffer inteiro (57600 pixels) toda vez que mostra a
        # tela, o metodo .cor() ja devolve o valor com os bytes trocados de
        # proposito, entao o show() manda o buffer cru sem processar nada.
        self.framebuf = framebuf.FrameBuffer(self.buffer, width, height, framebuf.RGB565)

        self.cs.init(self.cs.OUT, value=1)
        self.dc.init(self.dc.OUT, value=0)
        self.rst.init(self.rst.OUT, value=1)

        self._init_display()

    @staticmethod
    def cor(r, g, b):
        """Converte r,g,b (0-255) pro inteiro de 16 bits que o framebuf deve
        guardar pra sair certo pelo SPI (ver comentario acima). Esse painel
        especifico (SpotPear ESP32-S3 1.28 AI Ball) interpreta os dados como
        BGR em vez de RGB - por isso r e b sao trocados aqui, confirmado
        testando um quadrado "vermelho" que saia azul na tela."""
        valor = ((b & 0xF8) << 8) | ((g & 0xFC) << 3) | (r >> 3)
        return ((valor & 0xFF) << 8) | (valor >> 8)

    def _cmd(self, comando):
        self.dc.value(0)
        self.cs.value(0)
        self.spi.write(comando)
        self.cs.value(1)

    def _dado(self, dados):
        self.dc.value(1)
        self.cs.value(0)
        self.spi.write(dados)
        self.cs.value(1)

    def _comando_dados(self, comando, dados):
        self._cmd(comando)
        self._dado(dados)

    def _init_display(self):
        self.rst.value(0)
        sleep_ms(50)
        self.rst.value(1)
        sleep_ms(50)

        cd = self._comando_dados
        self._cmd(b"\xfe")  # habilita registradores internos 1 (sem dado, so comando)
        self._cmd(b"\xef")  # habilita registradores internos 2
        cd(b"\xeb", b"\x14")
        cd(b"\x84", b"\x40")
        cd(b"\x85", b"\xff")
        cd(b"\x87", b"\xff")
        cd(b"\x86", b"\xff")
        cd(b"\x88", b"\x0a")
        cd(b"\x89", b"\x21")
        cd(b"\x8a", b"\x00")
        cd(b"\x8b", b"\x80")
        cd(b"\x8c", b"\x01")
        cd(b"\x8d", b"\x01")
        cd(b"\x8e", b"\xff")
        cd(b"\x8f", b"\xff")
        cd(b"\xb6", b"\x00\x00")
        cd(b"\x3a", b"\x55")  # COLMOD: 16 bits/pixel (RGB565)
        cd(b"\x90", b"\x08\x08\x08\x08")
        cd(b"\xbd", b"\x06")
        cd(b"\xbc", b"\x00")
        cd(b"\xff", b"\x60\x01\x04")
        cd(b"\xc3", b"\x13")
        cd(b"\xc4", b"\x13")
        cd(b"\xc9", b"\x22")
        cd(b"\xbe", b"\x11")
        cd(b"\xe1", b"\x10\x0e")
        cd(b"\xdf", b"\x21\x0c\x02")
        cd(b"\xf0", b"\x45\x09\x08\x08\x26\x2a")
        cd(b"\xf1", b"\x43\x70\x72\x36\x37\x6f")
        cd(b"\xf2", b"\x45\x09\x08\x08\x26\x2a")
        cd(b"\xf3", b"\x43\x70\x72\x36\x37\x6f")
        cd(b"\xed", b"\x1b\x0b")
        cd(b"\xae", b"\x77")
        cd(b"\xcd", b"\x63")
        cd(b"\x70", b"\x07\x07\x04\x0e\x0f\x09\x07\x08\x03")
        cd(b"\xe8", b"\x34")
        cd(b"\x62", b"\x18\x0d\x71\xed\x70\x70\x18\x0f\x71\xef\x70\x70")
        cd(b"\x63", b"\x18\x11\x71\xf1\x70\x70\x18\x13\x71\xf3\x70\x70")
        cd(b"\x64", b"\x28\x29\xf1\x01\xf1\x00\x07")
        cd(b"\x66", b"\x3c\x00\xcd\x67\x45\x45\x10\x00\x00\x00")
        cd(b"\x67", b"\x00\x3c\x00\x00\x00\x01\x54\x10\x32\x98")
        cd(b"\x74", b"\x10\x85\x80\x00\x00\x4e\x00")
        cd(b"\x98", b"\x3e\x07")
        self._cmd(b"\x21")  # inversao de cor ligada (padrao do painel)
        self._cmd(b"\x11")  # sleep out
        sleep_ms(120)
        # MADCTL 0x40 - confirmado testando na placa fisica (quadrado no
        # canto certo da tela redonda). O valor "esperado" calculado a
        # partir do DISPLAY_MIRROR_X do firmware original nao bateu com o
        # comportamento real desse painel especifico.
        cd(b"\x36", b"\x40")
        self._cmd(b"\x29")  # display on

    # --- API igual ao ssd1306.py, pra reaproveitar o codigo do rosto ---
    def fill(self, cor):
        self.framebuf.fill(cor)

    def pixel(self, x, y, cor):
        self.framebuf.pixel(x, y, cor)

    def text(self, texto, x, y, cor):
        self.framebuf.text(texto, x, y, cor)

    def ellipse(self, x, y, xr, yr, cor, preenchido=False):
        self.framebuf.ellipse(x, y, xr, yr, cor, preenchido)

    def fill_rect(self, x, y, w, h, cor):
        self.framebuf.fill_rect(x, y, w, h, cor)

    def show(self):
        self._cmd(b"\x2a")
        self._dado(bytes([0, 0, (self.width - 1) >> 8, (self.width - 1) & 0xFF]))
        self._cmd(b"\x2b")
        self._dado(bytes([0, 0, (self.height - 1) >> 8, (self.height - 1) & 0xFF]))
        self._cmd(b"\x2c")
        self.dc.value(1)
        self.cs.value(0)
        self.spi.write(self.buffer)
        self.cs.value(1)
