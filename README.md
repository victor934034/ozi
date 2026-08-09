# Ozi

Cerebro do projeto Ozi (multiusuario - cada pessoa tem sua conta, memoria e
dispositivos isolados). Ver `projeto-jarvis.md` para a arquitetura original
e `README-DEPLOY.md` pra subir isso numa VPS via EasyPanel.

## Setup

```
npm install
cp .env.example .env   # preencha ANTHROPIC_API_KEY, FISH_AUDIO_API_KEY, JWT_SECRET
```

Pegue a chave da Fish Audio em https://fish.audio (tem plano gratuito, modelo
`s2.1-pro-free`, ate 5 chamadas simultaneas). Gere o `JWT_SECRET` com
`openssl rand -hex 32` (ou qualquer string aleatoria longa) - e o que assina
os tokens de login, nao pode ficar vazio.

## Rodar

Em um terminal, suba o servidor (paginas, API de login e WebSocket, tudo
num so processo/porta):

```
npm start
```

Em outro, suba o dispositivo simulado (o "corpo" fake):

```
npm run device
```

**Desde que o sistema virou multiusuario, o `device` pede login (email +
senha) antes de conectar** - se a conta ainda nao existir, ele oferece
criar na hora. Depois de logado, digite mensagens normalmente. Comandos
especiais:

- `run: <codigo js>` - roda o loop de 3 agentes (executor -> historiador -> programador) num trecho de JS; se der erro, tenta se autocorrigir usando memoria vetorial.
- `sonho` - roda a rotina de decaimento de memoria manualmente (normalmente rodaria de madrugada).
- `lembrete: <texto>` / `lembretes` - cria/lista lembretes (SQLite).
- `fato: chave=valor` - salva um fato permanente sobre o usuario (SQLite).
- qualquer outro texto - conversa normal com o Claude, com memoria vetorial + fatos + humor injetados no system prompt.

## Testar audio (ouvir e falar) e o "rosto"

Alem do terminal, tem uma pagina web com microfone, alto-falante e um rosto
animado que reage ao humor. Ela usa as APIs de voz nativas do navegador
(Web Speech API), entao nao precisa instalar nada extra - so funciona melhor
no Chrome ou Edge (Firefox nao suporta reconhecimento de voz por enquanto).

Com o servidor (`npm start`) rodando, abra `http://localhost:8787` no
Chrome/Edge, clique em "Conectar" e depois
em "🎤 Falar" (o navegador vai pedir permissao de microfone - autorize).
Fale a frase, solte, e o Jarvis responde por voz (TTS) e o rosto mexe a boca
enquanto fala. O rosto tambem fica vermelho quando `nivel_alerta` sobe e
"desbotado" quando `estabilidade` cai, refletindo o estado interno (Parte 4
do `projeto-jarvis.md`). Tambem da pra digitar no campo de texto se preferir
nao usar o microfone.

## TTS no backend (o servidor gera o audio, nao o navegador)

Diferente da pagina web (que usa a voz do proprio navegador so pra teste
rapido), o servidor agora gera o audio de verdade e manda pro dispositivo
conectado - e assim que vai funcionar com o ESP32 real, que nao tem Web
Speech API.

**Arquitetura:**

- `src/tts/index.js` - unico ponto de entrada (`gerarAudio(texto)`). Cuida
  de contar/logar as chamadas (salvo no SQLite, tabela `tts_chamadas`) e
  delega pro provedor configurado em `TTS_PROVIDER` (hoje so `fish-audio`).
- `src/tts/providers/fishAudio.js` - implementacao especifica da Fish Audio.
  Chama a API REST deles direto com `fetch` (sem depender do pacote npm
  `fish-audio`, que e um SDK nao-oficial de terceiro - ver comentario no
  topo do arquivo). Tem um semaforo simples limitando a 5 chamadas
  simultaneas (configuravel via `FISH_AUDIO_MAX_CONCORRENTE`), que e o
  limite do plano gratuito.

**Como flui numa conversa:** `server.js` gera a resposta em texto com o
Claude, manda ela pro dispositivo via WebSocket, e so entao chama
`gerarAudio()` e manda o audio pronto como uma mensagem binaria separada
assim que fica pronto. Se o TTS falhar (chave invalida, limite estourado,
Fish Audio fora do ar), a conversa continua normalmente - so em texto, com
um aviso (`{ type: 'tts_erro' }`) - nunca trava a resposta inteira por causa
do audio.

**Comandos utilitarios** (`run:`, `sonho`, `lembrete:`, `fato:`) NAO geram
audio de proposito, pra nao gastar chamadas de TTS com saida de JSON/debug.

**Limitacao real que vale saber:** hoje o audio e gerado por inteiro antes
de ser enviado (nao e streaming chunk-a-chunk). Pra respostas curtas isso
nao se nota, mas pra respostas longas o dispositivo só recebe o audio depois
que a Fish Audio terminou de gerar ele todo. Um streaming de verdade (audio
comecando a tocar antes da geracao terminar) é possivel de implementar
depois lendo a resposta da Fish Audio como stream e repassando os pedacos,
mas exigiria repensar o formato (WAV tem o tamanho total no cabecalho, o
que complica streaming - PCM cru streamaria mais facil).

**Testar:** com o servidor rodando, `npm run device` e mande qualquer
mensagem normal (nao um comando utilitario) - o terminal vai imprimir
`[fake-device] recebendo audio da resposta, tocando...` e o audio toca pelo
alto-falante do PC (via PowerShell no Windows). O contador de chamadas
aparece no log do servidor: `[tts] chamada #N (fish-audio) OK - ...`.

## O que ja esta implementado (Fase 1)

- [x] Simulador de dispositivo via WebSocket (`src/device/fakeDevice.js`)
- [x] Loop de conversa com a API do Claude
- [x] Memoria SQLite (fatos + lembretes)
- [x] Memoria vetorial local (embeddings via `@xenova/transformers`, sem precisar rodar ChromaDB) + rotina de decaimento ("Sonho")
- [x] Loop de 3 agentes (executor / historiador / programador) com autocorrecao
- [x] Variaveis de humor (`estabilidade`, `eficiencia`, `nivel_alerta`) injetadas condicionalmente no system prompt
- [x] STT/TTS no PC via pagina web (Web Speech API do navegador) + rosto animado reagindo ao humor
- [x] Painel administrativo privado (cadastro de dispositivos, status online/offline, custo real no Claude)
- [x] Integracao Smart Life (Tuya) - listar/ligar/desligar dispositivos reais de casa pelo chat

## Integracao com Smart Life (Tuya)

Controla os dispositivos que ja estao no seu app Smart Life, via API oficial
da Tuya (`src/integrations/smartLife.js`, usando o SDK oficial
`@tuya/tuya-connector-nodejs`).

**Duas formas de usar:**

1. **Linguagem natural** (recomendado) - so falar normal, tipo "desliga a
   luz do meu quarto" ou "o que tem ligado em casa?". O Claude usa *tool
   use* (function calling) pra decidir sozinho quando chamar
   `listar_dispositivos_casa` ou `controlar_dispositivo_casa` - ve as
   ferramentas definidas em `FERRAMENTAS_CASA` no `server.js`. Isso
   consome uma chamada extra ao Claude (~4-6s a mais) porque precisa de
   duas idas e voltas: uma pra ele decidir usar a ferramenta, outra pra dar
   a resposta final depois do resultado.
2. **Comandos fixos** (mais rapido, sem gastar tokens do Claude):
   - `casa` - lista todos os dispositivos com status (🟢 online / ⚪ offline)
   - `casa: ligar <nome>` / `casa: desligar <nome>` - liga/desliga por nome
     (busca parcial, ex: "casa: ligar quarto" acha o dispositivo "quarto")

**Setup (feito uma vez, uso pessoal):**
1. Crie um projeto em https://iot.tuya.com -> Cloud -> Development
2. **Atencao ao Data Center**: o pais da sua conta nao garante qual data
   center ela realmente usa (temos casos de contas do Brasil que ficaram no
   "Western America" em vez do "Eastern America" que a tabela oficial
   sugeriria). O plano gratuito so permite 1 data center por vez - se der
   erro "data center inconsistente" ao vincular a conta, apague o projeto e
   recrie com outro data center ate acertar (teste Western America primeiro).
3. Na aba "Devices" do projeto -> "Link App Account" -> "Tuya App Account
   Authorization" -> escaneie o QR code pelo app Smart Life (perfil ->
   configuracoes -> vincular conta de terceiros)
4. Copie Client ID, Client Secret, Project Code (aba Overview) e o UID da
   conta vinculada (aba Devices, depois de vincular) pro `.env`

**Nota tecnica:** o SDK oficial da Tuya tem dois bugs que contornamos direto
com `cliente.request()` em vez dos metodos prontos: `device.list()` exige
device_ids (nao serve pra "listar tudo" - o certo e `/v1.0/users/{uid}/devices`
por UID da conta vinculada) e `deviceFunction.command()` manda a requisicao
como GET quando a API exige POST.

## Painel administrativo (`/admin.html`)

Pagina privada pra acompanhar todos os mini-robos que ja se conectaram ao
seu Jarvis: quais estao ligados agora, ha quanto tempo, e quanto cada um ja
gastou de tokens no Claude (em dolar, calculado com o preco oficial da API).

**Como funciona:**

- Um dispositivo so aparece no painel depois que ele se conecta e manda uma
  mensagem `{ type: 'identificar', device_id, nome }` pelo WebSocket. A
  pagina de teste (`index.html`) e a fake-device de texto puro fazem isso
  automaticamente com um ID gerado uma vez e reaproveitado (fica salvo em
  `data/fake-device-id.txt`). Um ESP32 real faria a mesma coisa assim que
  conectasse (ex: usando o endereco MAC como `device_id`).
- "Ligado"/"desligado" reflete se existe uma conexao WebSocket ativa
  AGORA - nao e um campo que fica desatualizado, atualiza no connect/close.
- O custo em dolar vem dos tokens reais que a API do Claude retorna em cada
  resposta (`response.usage`), multiplicados pelo preco oficial (ver
  `config.claudePrecos` em `src/config.js` - Sonnet 5: $2/MTok entrada,
  $10/MTok saida, promocional ate 31/08/2026).

**Acesso:** protegido por login de usuario (email + senha, ou Google) - nao
existe mais senha fixa de admin. Cada usuario ve so os proprios
dispositivos. Abra `http://localhost:8787/admin.html`, entre com sua conta -
o token fica salvo no navegador (`localStorage`) pra nao pedir login toda
hora.

## Nota sobre a substituicao do ChromaDB

O documento original propoe ChromaDB para a memoria vetorial. Pra Fase 1
ficar 100% local sem precisar rodar um servidor Python separado, usamos
`@xenova/transformers` (embeddings rodando direto no Node, cacheados em
disco apos o primeiro uso) com busca por similaridade de cosseno em SQLite.
A interface (`addMemory` / `searchSimilar` / `decayMemories` em
`src/memory/vector.js`) e a mesma que ChromaDB teria, entao trocar depois e
so reescrever esse arquivo.

**Modelo de embedding:** usamos `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
(multilingue, com suporte real a portugues). A primeira versao usava
`Xenova/all-MiniLM-L6-v2` (treinado majoritariamente em ingles), que discriminava
muito mal frases em portugues - testado na pratica, a diferenca de similaridade
entre um assunto relacionado e um totalmente aleatorio era de so ~0.06 (quase
inutil pra busca). O modelo multilingue separa bem melhor (~0.34 relacionado vs
~-0.05 nao-relacionado, no mesmo teste). Se trocar de modelo de novo no futuro,
lembre de limpar a tabela `memorias_vetoriais` - embeddings de modelos diferentes
nao sao comparaveis entre si, mesmo tendo a mesma dimensao.
