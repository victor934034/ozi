# Firmware do Ozi pro ESP32-S3 fisico

Roda em MicroPython (nao ESP-IDF/C) direto no hardware - substitui o
firmware do xiaozhi que a placa trazia de fabrica.

## Placa

**SpotPear ESP32-S3 1.28" AI Ball/Box** (N16R8 - 16MB flash, 8MB PSRAM
octal). Comprada pronta dentro de outro produto (rodava xiaozhi), sem
schematic oficial disponivel - o pinout abaixo foi confirmado testando
fisicamente na placa, cruzando com o firmware oficial do xiaozhi pra essa
placa exata (`boards/spotpear/sp-esp32-s3-1.28-box/config.h` em
[78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32)) e corrigindo onde
o teste real bateu diferente do que o comentario do arquivo original dizia.

### Pinout confirmado

| Funcao | Pino | Observacao |
|---|---|---|
| Tela GC9A01 (SPI) SCLK | GPIO4 | |
| Tela GC9A01 (SPI) MOSI | GPIO2 | |
| Tela GC9A01 (SPI) CS | GPIO5 | |
| Tela GC9A01 (SPI) DC | GPIO47 | |
| Tela GC9A01 (SPI) RESET | GPIO38 | |
| Tela - luz de fundo | GPIO42 | logica invertida (0 = aceso) |
| Tela - MADCTL | `0x40` | achado testando fisicamente, nao o valor "esperado" pelo config.h original |
| Tela - ordem de cor | BGR | nao RGB - `gc9a01.py` ja troca R/B no metodo `.cor()` |
| Codec ES8311 - I2C SDA | GPIO15 | |
| Codec ES8311 - I2C SCL | GPIO14 | |
| Codec ES8311 - MCLK | GPIO16 | gerado por PWM (MicroPython nao expoe MCLK nativo no I2S) |
| Codec ES8311 - I2S BCLK | GPIO9 | |
| Codec ES8311 - I2S WS/LRCK | GPIO45 | |
| Codec ES8311 - I2S DOUT (alto-falante) | **GPIO10** | config.h original chamava isso de "DIN", estava trocado |
| Codec ES8311 - PA enable | GPIO46 | |
| Botao BOOT | GPIO0 | pull-up, pressionado = nivel baixo |
| LED onboard | GPIO48 | nao usado ainda |
| Touch (nao usado ainda) | SDA=11 SCL=7 RST=6 INT=12 | |

## O que funciona

- Provisionamento de WiFi por Bluetooth (BLE, pareamento seguro por
  passkey exibido na tela) - `ble_provisioning.py`
- WebSocket real com o servidor Ozi (login, autenticacao, conversa) -
  `ws_client.py` + `ozi_auth.py` + `ozi_client.py`
- Tela redonda (rosto animado + texto) - `gc9a01.py`
- Alto-falante (toca um tom sintetico simples de teste) - `es8311.py` +
  `audio_saida.py`
- Botao BOOT manda uma pergunta de teste fixa pro Claude (ainda sem
  microfone real)

## Em andamento / suspeito de bug

- **Qualidade do audio do TTS**: o WAV que o servidor manda vem em 44100Hz,
  mas gerar o MCLK do codec via PWM em ~11MHz (256 * 44100) nao fica
  preciso o bastante (so sai um "beep" em vez de fala limpa). Fix tentado:
  manter o codec numa taxa fixa de 16kHz (comprovada limpa com um tom
  sintetico) e reamostrar todo audio recebido pra 16kHz antes de tocar
  (`_reamostrar_16bit_mono` em `audio_saida.py`). Uma primeira versao dessa
  reamostragem (baseada em `struct.unpack` numa tupla gigante) parece ter
  travado a placa por falta de memoria - reescrita usando o modulo `array`
  (mais leve), mas ainda **nao foi validada de ponta a ponta** por causa
  disso. Proximo passo: testar a versao com `array` com a placa fria/
  descansada.

## O que NAO funciona ainda

- **Microfone**: `audio_entrada.py` existe mas nao captura audio de
  verdade nessa placa - testado varios pinos (8, 39, 40, 41, 3, 46, 47,
  38, 10, 6, 7, 12, 13, 17, 18) e duas configuracoes de registrador do
  ES8311 (mic analogico e digital/PDM), nenhum capturou voz real (so
  silencio ou ruido eletrico do proprio circuito, nao audio). Provavel que
  precise inspecao fisica (multimetro) ou o schematic real dessa placa pra
  achar o pino certo com certeza - pausado por enquanto.
- Mesmo com o microfone funcionando, o **servidor ainda nao sabe
  transcrever audio** (so aceita `user_text` em texto) - precisaria de um
  passo novo de STT (ex: Whisper) no backend antes de uma conversa por voz
  de verdade funcionar.
- Provisionamento de conta (hoje `device_auth.json` e colocado na mao via
  `mpremote`) - vai ser resolvido quando o app novo (React) tiver a tela
  de "adicionar dispositivo" via BLE.

## Gravar do zero

```
pip install esptool mpremote
esptool --port COMx erase-flash
esptool --port COMx write-flash 0 ESP32_GENERIC_S3-SPIRAM_OCT-<versao>.bin
# baixa em https://micropython.org/download/ESP32_GENERIC_S3/ (usar a
# variante SPIRAM_OCT - essa placa tem PSRAM octal)

mpremote connect COMx fs cp main.py :main.py
mpremote connect COMx fs cp gc9a01.py :gc9a01.py
mpremote connect COMx fs cp es8311.py :es8311.py
mpremote connect COMx fs cp audio_saida.py :audio_saida.py
mpremote connect COMx fs cp audio_entrada.py :audio_entrada.py
mpremote connect COMx fs cp ble_provisioning.py :ble_provisioning.py
mpremote connect COMx fs cp ws_client.py :ws_client.py
mpremote connect COMx fs cp ozi_auth.py :ozi_auth.py
mpremote connect COMx fs cp ozi_client.py :ozi_client.py
mpremote connect COMx fs cp ssd1306.py :ssd1306.py
mpremote connect COMx fs mkdir :aioble
mpremote connect COMx fs cp aioble/__init__.py :aioble/__init__.py
mpremote connect COMx fs cp aioble/core.py :aioble/core.py
mpremote connect COMx fs cp aioble/device.py :aioble/device.py
mpremote connect COMx fs cp aioble/peripheral.py :aioble/peripheral.py
mpremote connect COMx fs cp aioble/server.py :aioble/server.py
mpremote connect COMx fs cp aioble/security.py :aioble/security.py
```

Depois, cria manualmente `device_auth.json` no dispositivo (nao vai pro
git, tem senha) com:
```json
{"servidor": "https://SEU-DOMINIO-EASYPANEL", "email": "...", "senha": "..."}
```

## Nota sobre a porta serial

Esse chip (USB-Serial/JTAG nativo do ESP32-S3) fica instavel quando WiFi
+ BLE + a tela ficam ativos ao mesmo tempo - a porta as vezes trava e
precisa desconectar/reconectar o cabo USB fisicamente pra voltar a
responder ao `mpremote`. Isso e so um problema de debug via USB, nao afeta
o funcionamento normal do dispositivo (que roda sozinho, sem PC).
