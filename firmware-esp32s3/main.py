# Firmware "do zero" do Ozi pro ESP32-S3 fisico (substitui o firmware do
# xiaozhi que veio de fabrica). Placa: SpotPear ESP32-S3 1.28" AI Ball/Box
# (N16R8) - display redondo GC9A01 240x240 por SPI, codec de audio ES8311
# (mic + alto-falante), touch CST816-like por I2C. Pinout conferido no
# firmware oficial do xiaozhi pra essa placa exata (boards/spotpear/
# sp-esp32-s3-1.28-box/config.h no repositorio 78/xiaozhi-esp32).
#
# Fluxo desta etapa: liga a tela, garante WiFi (provisionamento por
# Bluetooth se preciso), conecta no servidor Ozi por WebSocket, TOCA a voz
# da resposta no alto-falante (codec ES8311) e fica com o rosto animado -
# segurar o botao BOOT manda uma pergunta de teste pro Claude (ainda sem
# microfone ligado, ver PROXIMOS PASSOS).
#
# PROXIMOS PASSOS (fora do escopo desta etapa):
#   - Captura de audio pelo microfone (I2S RX) + transcricao - depende de
#     um passo novo no SERVIDOR (STT tipo Whisper), que ainda nao existe;
#     troca o botao BOOT por "segurar pra falar" de verdade quando isso
#     estiver decidido
#   - Tela de "adicionar dispositivo"/login no app novo (React) que fala
#     BLE com este firmware pra configurar WiFi E conta, tudo de uma vez
#     (hoje device_auth.json e colocado manualmente via mpremote)
#   - Touchscreen (SDA=11 SCL=7 RST=6 INT=12), se fizer sentido usar

from machine import Pin, SPI
import asyncio
import gc9a01
import ble_provisioning
import ozi_client
import ozi_auth
from es8311 import ES8311
from audio_saida import SaidaAudio

LARGURA = 240
ALTURA = 240

# --- Pinos da tela (GC9A01, SPI) ---
_SPI_SCLK = 4
_SPI_MOSI = 2
_SPI_CS = 5
_SPI_DC = 47
_SPI_RESET = 38
_BACKLIGHT = 42
_BOTAO_BOOT = 0

def log(*args):
    """Imprime no serial E grava num arquivo (log.txt) - a porta serial
    desse chip fica instavel quando WiFi/BLE estao ativos ao mesmo tempo,
    entao monitorar ao vivo nem sempre funciona. O arquivo da pra ler
    depois, sem correr contra o tempo."""
    texto = " ".join(str(a) for a in args)
    print(texto)
    try:
        with open("log.txt", "a") as f:
            f.write(texto + "\n")
    except OSError:
        pass


luz_fundo = Pin(_BACKLIGHT, Pin.OUT)
luz_fundo.value(0)  # firmware original marca essa placa como "invertido" - 0 = aceso

botao_boot = Pin(_BOTAO_BOOT, Pin.IN, Pin.PULL_UP)  # pressionado = nivel baixo

spi = SPI(1, baudrate=40_000_000, polarity=0, phase=0, sck=Pin(_SPI_SCLK), mosi=Pin(_SPI_MOSI))
tela = gc9a01.GC9A01(spi, cs=Pin(_SPI_CS), dc=Pin(_SPI_DC), rst=Pin(_SPI_RESET), width=LARGURA, height=ALTURA)

# --- Audio (codec ES8311, so o caminho de tocar som por enquanto) ---
codec = ES8311(scl=14, sda=15, mck=16, pa_pin=46, rate=16000)
codec.ligar()
codec.volume(80)
saida_audio = SaidaAudio(codec)

PRETO = tela.cor(0, 0, 0)
BRANCO = tela.cor(255, 255, 255)
AZUL_OZI = tela.cor(47, 107, 255)  # mesma cor da marca (#2F6BFF) usada no app/pagina web


def mostrar_texto(texto):
    """Desenha texto multi-linha (separado por \\n), centralizado
    verticalmente. Tambem imprime no serial (util pra debugar sem precisar
    olhar a telinha)."""
    log("[tela]", texto.replace("\n", " / "))
    linhas = texto.split("\n")
    tela.fill(PRETO)
    y_inicial = ALTURA // 2 - (len(linhas) * 10) // 2
    for i, linha in enumerate(linhas):
        x = LARGURA // 2 - (len(linha) * 8) // 2  # cada caractere tem 8px de largura na fonte padrao
        tela.text(linha, max(0, x), y_inicial + i * 10, BRANCO)
    tela.show()


def mostrar_codigo_pareamento(codigo):
    tela.fill(PRETO)
    tela.text("Codigo de", 78, 90, BRANCO)
    tela.text("pareamento:", 68, 100, BRANCO)
    tela.text(codigo, 92, 130, AZUL_OZI)
    tela.show()


async def garantir_wifi():
    creds = ble_provisioning.carregar_credenciais()
    if creds:
        mostrar_texto("Conectando\nna rede\nsalva...")
        ip = await ble_provisioning.conectar_wifi(creds["ssid"], creds["senha"])
        if ip:
            return ip
        # Rede salva nao funcionou mais (senha trocada, roteador diferente,
        # etc) - esquece e cai pro fluxo de provisionamento de novo.
        mostrar_texto("Rede salva\nnao funcionou\nmais. Repareando...")
        ble_provisioning.esquecer_credenciais()

    return await ble_provisioning.provisionar(mostrar_texto, mostrar_codigo_pareamento)


# --- Geometria dos "olhos em pilula" - mesmo desenho do rosto usado na
# pagina web e no simulador, redimensionado pro canto redondo de 240x240
# (fica centralizado, com margem confortavel da borda do circulo). ---
OLHO_RAIO_X = 22
OLHO_RAIO_Y = 40
OLHO_CENTRO_Y = ALTURA // 2
OLHO_E_CENTRO_X = LARGURA // 2 - 42
OLHO_D_CENTRO_X = LARGURA // 2 + 42


def desenhar_olhos(deslocamento_x=0, deslocamento_y=0, fator_altura=1.0):
    tela.fill(PRETO)
    raio_y = max(1, int(OLHO_RAIO_Y * fator_altura))
    y = OLHO_CENTRO_Y + deslocamento_y
    tela.ellipse(OLHO_E_CENTRO_X + deslocamento_x, y, OLHO_RAIO_X, raio_y, AZUL_OZI, True)
    tela.ellipse(OLHO_D_CENTRO_X + deslocamento_x, y, OLHO_RAIO_X, raio_y, AZUL_OZI, True)
    tela.show()


tela_ocupada = False  # True enquanto falar_com_ozi() esta mostrando texto -
# impede o piscar de fundo (rosto_vivo) de sobrescrever a mensagem na hora
# errada, ja que os dois rodam concorrentemente e desenham na mesma tela.


async def rosto_vivo():
    """Fica piscando sozinho quando nao ha nada acontecendo - "idle" do
    rosto, igual a pagina web/app fazem quando conectados mas sem falar."""
    import random

    desenhar_olhos()
    while True:
        await asyncio.sleep_ms(random.randint(2500, 5500))
        if tela_ocupada:
            continue
        for fator in (0.6, 0.15, 0.6, 1.0):
            if tela_ocupada:
                break
            desenhar_olhos(fator_altura=fator)
            await asyncio.sleep_ms(35)


async def falar_com_ozi():
    """Conecta no servidor Ozi e fica conectado pra sempre, reconectando se
    cair. Enquanto nao tem microfone (ver PROXIMOS PASSOS no topo do
    arquivo), segurar o botao BOOT manda uma pergunta de teste fixa - da
    pra confirmar que o dispositivo fala com o Claude de verdade sem
    precisar do audio ainda."""
    global tela_ocupada

    if not ozi_auth.carregar_config():
        tela_ocupada = True
        mostrar_texto("Sem conta\nconfigurada\nainda")
        return

    while True:
        cliente = ozi_client.ClienteOzi()

        def ao_texto(texto, estado):
            global tela_ocupada
            tela_ocupada = True
            mostrar_texto(texto)

        def ao_erro(mensagem):
            global tela_ocupada
            tela_ocupada = True
            mostrar_texto("Erro:\n%s" % mensagem)

        def ao_audio(dados_wav):
            log("[audio] recebido, tocando", len(dados_wav), "bytes...")
            try:
                saida_audio.tocar_wav(dados_wav)
                log("[audio] tocou sem erro")
            except Exception as erro:
                log("[audio] erro tocando resposta:", erro)

        try:
            tarefa_conexao = asyncio.create_task(
                cliente.conectar(ao_texto, aoAudio=ao_audio, aoErro=ao_erro)
            )
            await asyncio.sleep_ms(3000)

            if not cliente.autenticado:
                tela_ocupada = True
                mostrar_texto("Nao consegui\nconectar no\nservidor Ozi")
                await tarefa_conexao
                continue

            tela_ocupada = True
            mostrar_texto("Ozi conectado!\nSegure o botao\npra testar")
            await asyncio.sleep_ms(2000)
            tela_ocupada = False
            desenhar_olhos()

            while cliente.autenticado:
                if botao_boot.value() == 0:  # botao pressionado (pull-up, ativo em nivel baixo)
                    tela_ocupada = True
                    mostrar_texto("Pensando...")
                    await cliente.enviar_texto(
                        "Oi Ozi, isso e um teste do seu corpo fisico (ESP32). "
                        "Responda em uma frase bem curta."
                    )
                    while botao_boot.value() == 0:  # espera soltar, evita mandar varias vezes
                        await asyncio.sleep_ms(50)
                    await asyncio.sleep_ms(4000)  # tempo de mostrar a resposta antes de voltar pro rosto
                    tela_ocupada = False
                    desenhar_olhos()
                await asyncio.sleep_ms(50)

            await tarefa_conexao
        except Exception as erro:
            tela_ocupada = True
            mostrar_texto("Conexao caiu:\n%s\nTentando de\nnovo..." % str(erro)[:40])

        await asyncio.sleep_ms(5000)  # espera antes de tentar reconectar


async def main():
    ip = await garantir_wifi()
    mostrar_texto("Ozi pronto\nIP: %s" % ip)
    await asyncio.sleep_ms(2000)

    asyncio.create_task(rosto_vivo())
    await falar_com_ozi()


asyncio.run(main())
