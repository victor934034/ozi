# Cliente WebSocket minimo, escrito na mao pra esse projeto - as bibliotecas
# prontas que existem por ai (ex: danni/uwebsockets) usam sockets
# bloqueantes, o que trava o loop assincrono inteiro (BLE, tela) enquanto
# espera dado chegar. Esta versao usa asyncio.open_connection, que e
# nao-bloqueante de verdade e convive bem com o resto do firmware.
#
# Implementa so o necessario pro protocolo do servidor Ozi: enviar/receber
# texto (JSON) e receber binario (audio do TTS) - ver RFC6455 para o
# significado de cada campo do frame.

import asyncio
import ujson as json
import ubinascii as binascii
import urandom as random
import ustruct as struct

OP_TEXT = 0x1
OP_BYTES = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA


class ConexaoFechada(Exception):
    pass


class WebSocketCliente:
    def __init__(self, reader, writer):
        self._reader = reader
        self._writer = writer
        self.aberta = True

    async def _ler_frame(self):
        cabecalho = await self._reader.readexactly(2)
        byte1, byte2 = struct.unpack("!BB", cabecalho)
        opcode = byte1 & 0x0F
        mascarado = bool(byte2 & 0x80)
        tamanho = byte2 & 0x7F

        if tamanho == 126:
            (tamanho,) = struct.unpack("!H", await self._reader.readexactly(2))
        elif tamanho == 127:
            (tamanho,) = struct.unpack("!Q", await self._reader.readexactly(8))

        if mascarado:
            mascara = await self._reader.readexactly(4)

        dados = await self._reader.readexactly(tamanho) if tamanho else b""

        if mascarado:
            dados = bytes(b ^ mascara[i % 4] for i, b in enumerate(dados))

        return opcode, dados

    async def _escrever_frame(self, opcode, dados=b""):
        # Mensagens do cliente pro servidor SEMPRE tem que vir mascaradas
        # (regra do protocolo, servidor pode rejeitar se nao vier).
        byte1 = 0x80 | opcode  # FIN=1
        tamanho = len(dados)

        if tamanho < 126:
            self._writer.write(struct.pack("!BB", byte1, 0x80 | tamanho))
        elif tamanho < 65536:
            self._writer.write(struct.pack("!BBH", byte1, 0x80 | 126, tamanho))
        else:
            self._writer.write(struct.pack("!BBQ", byte1, 0x80 | 127, tamanho))

        mascara = struct.pack("!I", random.getrandbits(32))
        self._writer.write(mascara)
        self._writer.write(bytes(b ^ mascara[i % 4] for i, b in enumerate(dados)))
        await self._writer.drain()

    async def enviar_json(self, obj):
        await self._escrever_frame(OP_TEXT, json.dumps(obj).encode())

    async def enviar_texto(self, texto):
        await self._escrever_frame(OP_TEXT, texto.encode())

    async def receber(self):
        """Devolve (tipo, dados) onde tipo e 'texto' ou 'binario', tratando
        ping/pong/close automaticamente. Levanta ConexaoFechada quando o
        servidor fecha a conexao."""
        while True:
            try:
                opcode, dados = await self._ler_frame()
            except (OSError, asyncio.IncompleteReadError):
                self.aberta = False
                raise ConexaoFechada()

            if opcode == OP_TEXT:
                return "texto", dados.decode()
            elif opcode == OP_BYTES:
                return "binario", dados
            elif opcode == OP_CLOSE:
                self.aberta = False
                raise ConexaoFechada()
            elif opcode == OP_PING:
                await self._escrever_frame(OP_PONG, dados)
                continue
            elif opcode == OP_PONG:
                continue
            # OP_CONT (continuacao) nao e esperado - o servidor sempre manda
            # frames completos (FIN=1) pro nosso caso de uso.

    async def fechar(self):
        if not self.aberta:
            return
        try:
            await self._escrever_frame(OP_CLOSE, b"")
        except OSError:
            pass
        self.aberta = False
        self._writer.close()


def _parse_url(url):
    """Entende so o suficiente de ws://host:porta/caminho ou
    wss://host:porta/caminho - nao precisa de biblioteca de regex."""
    seguro = url.startswith("wss://")
    resto = url[6:] if seguro else url[5:]
    if "/" in resto:
        autoridade, caminho = resto.split("/", 1)
        caminho = "/" + caminho
    else:
        autoridade, caminho = resto, "/"

    if ":" in autoridade:
        host, porta = autoridade.split(":", 1)
        porta = int(porta)
    else:
        host = autoridade
        porta = 443 if seguro else 80

    return seguro, host, porta, caminho


async def conectar(url, timeout_s=15):
    seguro, host, porta, caminho = _parse_url(url)

    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(host, porta, ssl=seguro, server_hostname=host if seguro else None),
        timeout_s,
    )

    chave = binascii.b2a_base64(bytes(random.getrandbits(8) for _ in range(16))).strip()

    writer.write(b"GET %s HTTP/1.1\r\n" % caminho.encode())
    writer.write(b"Host: %s\r\n" % host.encode())
    writer.write(b"Connection: Upgrade\r\n")
    writer.write(b"Upgrade: websocket\r\n")
    writer.write(b"Sec-WebSocket-Key: %s\r\n" % chave)
    writer.write(b"Sec-WebSocket-Version: 13\r\n")
    writer.write(b"\r\n")
    await writer.drain()

    linha = await asyncio.wait_for(reader.readline(), timeout_s)
    if b"101" not in linha:
        writer.close()
        raise OSError("handshake ws falhou: %s" % linha)

    # descarta o resto dos cabecalhos da resposta ate a linha em branco
    while True:
        linha = await asyncio.wait_for(reader.readline(), timeout_s)
        if linha in (b"\r\n", b"\n", b""):
            break

    return WebSocketCliente(reader, writer)
