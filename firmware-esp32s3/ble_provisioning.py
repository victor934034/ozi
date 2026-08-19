# Provisionamento de WiFi via Bluetooth Low Energy, no estilo Alexa/Echo:
# o celular (rodando o app Ozi) pareia com o ESP32 por BLE, manda o SSID e a
# senha da rede, o ESP32 conecta e confirma. Pensado desde o inicio pra um
# dia vender o dispositivo pra outra pessoa - ela nunca precisa saber que
# existe uma senha de rede "gravada no firmware", so usa o app.
#
# SEGURANCA: pareamento LE Secure Connections com "Passkey Entry" - o ESP32
# mostra um codigo de 6 digitos no OLED, o celular pede pra digitar esse
# codigo. Isso autentica a conexao (protege contra um terceiro dispositivo
# proximo se passar pelo celular do dono) e criptografa o link BLE inteiro -
# a senha do WiFi nunca trafega em texto claro pelo ar.
#
# Guarda a credencial recebida em /wifi_creds.json (nao vai pro git - e
# gerado em tempo de execucao, so existe na flash do proprio ESP32).

import bluetooth
import json
import os
import random
import network
import asyncio

import aioble
import aioble.security  # registra o IRQ handler de pareamento/criptografia

CREDS_PATH = "wifi_creds.json"

# UUIDs proprios do Ozi (128-bit, gerados uma vez pra esse projeto - nao sao
# de nenhum registro oficial, mas sao unicos o bastante pra nao colidir com
# nada por acaso).
_SERVICO_UUID = bluetooth.UUID("6f21e000-0001-4a5e-9c2b-6f21e0000001")
_CARAC_SSID_UUID = bluetooth.UUID("6f21e000-0002-4a5e-9c2b-6f21e0000001")
_CARAC_SENHA_UUID = bluetooth.UUID("6f21e000-0003-4a5e-9c2b-6f21e0000001")
_CARAC_STATUS_UUID = bluetooth.UUID("6f21e000-0004-4a5e-9c2b-6f21e0000001")

# Flags de GATT que o modulo "bluetooth" nativo suporta mas o wrapper aioble
# nao expoe como parametro nomeado nessa versao - valores fixos da spec do
# MicroPython (modbluetooth.h), nao mudam entre versoes.
_FLAG_READ_ENCRYPTED = 0x0200
_FLAG_WRITE_ENCRYPTED = 0x1000
_FLAG_WRITE_AUTHENTICATED = 0x2000

_IO_CAPABILITY_DISPLAY_ONLY = 0
_PASSKEY_ACTION_DISP = 3

servico = aioble.Service(_SERVICO_UUID)

caracteristica_ssid = aioble.Characteristic(servico, _CARAC_SSID_UUID, write=True, capture=True)
caracteristica_ssid.flags |= _FLAG_WRITE_ENCRYPTED | _FLAG_WRITE_AUTHENTICATED

caracteristica_senha = aioble.Characteristic(servico, _CARAC_SENHA_UUID, write=True, capture=True)
caracteristica_senha.flags |= _FLAG_WRITE_ENCRYPTED | _FLAG_WRITE_AUTHENTICATED

caracteristica_status = aioble.Characteristic(
    servico, _CARAC_STATUS_UUID, read=True, notify=True, initial=b"aguardando"
)
caracteristica_status.flags |= _FLAG_READ_ENCRYPTED

aioble.register_services(servico)


def _nome_dispositivo():
    mac = network.WLAN(network.STA_IF).config("mac")
    return "Ozi-" + "".join("%02X" % b for b in mac[-2:])


def salvar_credenciais(ssid, senha):
    with open(CREDS_PATH, "w") as f:
        json.dump({"ssid": ssid, "senha": senha}, f)


def carregar_credenciais():
    try:
        with open(CREDS_PATH) as f:
            return json.load(f)
    except OSError:
        return None


def esquecer_credenciais():
    try:
        os.remove(CREDS_PATH)
    except OSError:
        pass


async def conectar_wifi(ssid, senha, timeout_ms=15000):
    """Tenta conectar numa rede WiFi. Devolve o IP em caso de sucesso, ou
    None se falhar (senha errada, rede fora de alcance, timeout)."""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(ssid, senha)

    passos = timeout_ms // 200
    for _ in range(passos):
        if wlan.isconnected():
            return wlan.ifconfig()[0]
        await asyncio.sleep_ms(200)

    wlan.disconnect()
    return None


def _registrar_handler_passkey(mostrar_codigo):
    """Liga o callback que mostra o codigo de pareamento no OLED. Precisa
    ficar registrado ANTES do aioble.advertise() comecar, senao o pedido de
    pareamento trava esperando uma acao que nunca vem."""
    from aioble.core import register_irq_handler
    from aioble.security import ble as ble_seguranca

    def handler(event, data):
        if event == 31:  # _IRQ_PASSKEY_ACTION
            conn_handle, action, passkey = data
            if action == _PASSKEY_ACTION_DISP:
                codigo = random.randint(0, 999999)
                mostrar_codigo("%06d" % codigo)
                ble_seguranca.gap_passkey(conn_handle, action, codigo)

    register_irq_handler(handler, None)


async def provisionar(mostrar_status, mostrar_codigo, timeout_ms=None):
    """Fica anunciando por BLE ate um celular parear e mandar SSID+senha
    validos (ou ate o timeout, se passado). mostrar_status/mostrar_codigo
    sao callbacks pra atualizar o OLED - fica desacoplado do driver de tela
    de proposito, pra este arquivo nao precisar saber nada de pixels."""
    _registrar_handler_passkey(mostrar_codigo)

    nome = _nome_dispositivo()
    mostrar_status("Pareie com\no app Ozi\n(%s)" % nome)

    while True:
        conexao = await aioble.advertise(
            250_000,
            name=nome,
            services=[_SERVICO_UUID],
            timeout_ms=timeout_ms,
        )

        mostrar_status("Pareando...")
        try:
            await conexao.pair(
                bond=True,
                le_secure=True,
                mitm=True,
                io=_IO_CAPABILITY_DISPLAY_ONLY,
                timeout_ms=30_000,
            )
        except Exception as erro:
            mostrar_status("Pareamento\nfalhou, tenta\nde novo")
            await conexao.disconnect()
            continue

        mostrar_status("Aguardando\nWiFi do app...")
        caracteristica_status.write(b"pareado", send_update=True)

        # O app escreve SSID e depois a senha, nessa ordem - o modo "capture"
        # do aioble usa uma fila UNICA compartilhada entre as duas
        # caracteristicas, entao esperar as duas escritas em paralelo
        # (polling alternado com timeout curto) arrisca estourar timeout e
        # derrubar o pareamento por engano. Esperar em sequencia e mais
        # simples e bate com o jeito que o app realmente manda os dados.
        try:
            _, valor_ssid = await caracteristica_ssid.written(timeout_ms=60_000)
            ssid = valor_ssid.decode()
            _, valor_senha = await caracteristica_senha.written(timeout_ms=60_000)
            senha = valor_senha.decode()
        except asyncio.TimeoutError:
            mostrar_status("Tempo esgotado\nesperando o\napp mandar o\nWiFi")
            await conexao.disconnect()
            continue

        mostrar_status("Conectando\nna rede...")
        caracteristica_status.write(b"conectando", send_update=True)

        ip = await conectar_wifi(ssid, senha)
        if ip:
            salvar_credenciais(ssid, senha)
            caracteristica_status.write(("conectado:" + ip).encode(), send_update=True)
            mostrar_status("Conectado!\n%s" % ip)
            await asyncio.sleep_ms(1500)
            await conexao.disconnect()
            return ip
        else:
            caracteristica_status.write(b"erro:senha_ou_rede_invalida", send_update=True)
            mostrar_status("Nao conectou.\nSenha errada\nou rede fora\nde alcance.")
            await asyncio.sleep_ms(3000)
            await conexao.disconnect()
            # volta pro topo do loop e anuncia de novo
