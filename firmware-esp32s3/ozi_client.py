# Fala com o "cerebro" do Ozi por WebSocket - mesmo protocolo que
# fake-device.js e o app Android usam: manda {type:'autenticar', token}
# primeiro, depois {type:'identificar', device_id, nome}, dai pra frente
# manda {type:'user_text', text} e recebe {type:'assistant_text', ...} (JSON)
# intercalado com frames binarios (audio do TTS).

import asyncio
import ujson as json
import ubinascii as binascii
import machine

import ws_client
import ozi_auth


def _log(*args):
    """Mesma ideia do log() de main.py (grava em log.txt tambem) - duplicado
    aqui pra esse arquivo nao depender de importar main.py (evita import
    circular, ja que main.py importa este modulo)."""
    texto = " ".join(str(a) for a in args)
    print(texto)
    try:
        with open("log.txt", "a") as f:
            f.write(texto + "\n")
    except OSError:
        pass


def _device_id():
    """ID estavel do dispositivo (mesmo por reconexao) - guardado num
    arquivo, mesma ideia do fake-device.js (data/fake-device-id.txt) e do
    app Android (SecurePrefs.deviceId)."""
    try:
        with open("device_id.txt") as f:
            return f.read().strip()
    except OSError:
        novo = binascii.hexlify(machine.unique_id()).decode()
        with open("device_id.txt", "w") as f:
            f.write(novo)
        return novo


class ClienteOzi:
    def __init__(self, nome_dispositivo="Ozi (ESP32)"):
        self.nome_dispositivo = nome_dispositivo
        self.device_id = _device_id()
        self.ws = None
        self.autenticado = False

    async def conectar(self, aoTexto, aoAudio=None, aoErro=None):
        """Faz login HTTP, abre o WebSocket, autentica e fica recebendo
        mensagens pra sempre (ate a conexao cair). aoTexto(texto, estado) e
        chamado pra cada resposta em texto do assistente; aoAudio(bytes) pra
        cada frame de audio recebido (opcional - so faz sentido depois que
        o alto-falante estiver ligado)."""
        config = ozi_auth.carregar_config()
        if not config:
            raise OSError("sem configuracao de servidor/conta salva (device_auth.json)")

        token = await ozi_auth.login(config["servidor"], config["email"], config["senha"])

        url_ws = config["servidor"].replace("https://", "wss://").replace("http://", "ws://")
        self.ws = await ws_client.conectar(url_ws)

        await self.ws.enviar_json({"type": "autenticar", "token": token})
        tipo, dados = await self.ws.receber()
        resposta = json.loads(dados) if tipo == "texto" else None

        if not resposta or resposta.get("type") != "autenticado":
            mensagem = resposta.get("texto", "autenticacao recusada") if resposta else "resposta invalida"
            raise OSError("erro de autenticacao: %s" % mensagem)

        await self.ws.enviar_json(
            {"type": "identificar", "device_id": self.device_id, "nome": self.nome_dispositivo}
        )
        self.autenticado = True

        while True:
            tipo, dados = await self.ws.receber()
            _log("[ws] frame recebido:", tipo, len(dados) if dados else 0, "bytes")
            if tipo == "binario":
                if aoAudio:
                    aoAudio(dados)
                continue

            payload = json.loads(dados)
            if payload.get("type") == "assistant_text":
                aoTexto(payload.get("text", ""), payload.get("estado"))
            elif payload.get("type") == "erro" and aoErro:
                aoErro(payload.get("texto", "erro do servidor"))
            elif payload.get("type") == "tts_erro" and aoErro:
                aoErro("audio: " + payload.get("texto", ""))
            # outros tipos (erro_auth apos ja autenticado, etc) sao ignorados
            # de proposito - nao deveriam acontecer nesse ponto do fluxo.

    async def enviar_texto(self, texto):
        if not self.autenticado:
            raise OSError("ainda nao autenticado")
        await self.ws.enviar_json({"type": "user_text", "text": texto})

    async def desconectar(self):
        if self.ws:
            await self.ws.fechar()
        self.autenticado = False
