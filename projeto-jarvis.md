# Projeto Jarvis — Arquitetura Cognitiva com ESP32 + Claude API

## Visão geral

Sistema onde um servidor Node.js (o "cérebro") gerencia memória, decide ações e opcionalmente reescreve o firmware de um ESP32 (o "corpo"), usando a API do Claude como motor de raciocínio. O sistema simula comportamento adaptativo através de memória com decaimento, regras condicionais de "humor" e um loop de autocorreção — sem prometer consciência ou aprendizado autônomo real (isso continua fora do alcance da tecnologia atual, ver seção de limites no fim).

---

## Parte 0 — Testando TUDO sem comprar hardware

Isso é importante e a resposta é: **sim, dá pra construir e validar quase 100% do sistema sem o ESP32 físico.** O ESP32 é só a "boca e ouvido" — o cérebro inteiro roda no seu computador/VPS.

### O que dá pra simular sem hardware

| Componente real (ESP32) | Substituto pra testes |
|---|---|
| Microfone + captura de áudio | Microfone do notebook, ou até input de texto puro no terminal |
| Alto-falante + TTS | Alto-falante do notebook / player de áudio no navegador |
| Display | Uma página HTML simples ou log no terminal |
| WebSocket do chip | Um cliente WebSocket simulado em Node.js (`ws` no lugar do firmware) |
| Gravação de `main.py` remotamente | Uma pasta local `/simulated-device/main.py` que o sistema "reescreve" de verdade |
| Wi-Fi/conexão do chip | Já está tudo na mesma máquina, não precisa nem de rede |

### Como montar o simulador

1. Crie um script Node.js (`fake-device.js`) que abre uma conexão WebSocket com seu servidor Jarvis, exatamente como o firmware real faria.
2. Ele manda "eventos" fake: texto digitado no terminal simulando fala transcrita, ou até áudio real do seu mic via biblioteca (`node-record-lpcm16`, por exemplo) se quiser testar STT de verdade.
3. Ele recebe respostas do servidor e imprime no terminal (simulando o TTS) ou toca áudio de verdade se você já tiver TTS configurado.
4. Para o mecanismo de automodificação: ao invés de gravar em `main.py` dentro do ESP32 via HTTP, o servidor grava num arquivo `simulated-device/main.py` local e você "executa" rodando esse arquivo com Python normal no seu PC pra validar que o código gerado funciona antes mesmo de cogitar mandar pra um chip de verdade.

**Vantagem prática:** você valida 100% da lógica de negócio (memória, decisão, geração de código, segurança) de graça, sem risco de "brickar" nada, e só compra o ESP32 quando o cérebro já estiver maduro e confiável. Isso também evita gastar token de API testando hardware — você testa a lógica isolada primeiro.

### Quando comprar o hardware, então

Só depois que:
- O loop de memória + decisão já estiver estável
- O mecanismo de geração/validação de código já tiver passado por dezenas de casos de teste simulados
- Você já tiver a camada de segurança (HAL blindada, watchdog) escrita e testada em simulação

---

## Parte 1 — Infraestrutura do corpo (ESP32)

- Flash com **MicroPython** (não Arduino/C++) — permite reescrever `main.py` como texto puro, sem recompilar binário
- `boot.py` **intocável pela IA**: inicializa Wi-Fi, inicia watchdog de 30s
- Watchdog: se `main.py` não confirmar "estou vivo" (ping ao servidor) em 30s após boot, `boot.py` apaga o arquivo quebrado e restaura uma versão de fábrica salva em `factory_backup.py`
- HAL (Hardware Abstraction Layer): funções fixas tipo `tocar_audio()`, `capturar_audio()`, `mostrar_no_display()`, `ligar_led()` — a IA só pode chamar essas funções, nunca manipular pinos/voltagem diretamente

---

## Parte 2 — Memória (o "segundo cérebro")

### Estrutura

- Banco vetorial (ChromaDB local — roda de graça na sua VPS, sem custo de API) para busca por similaridade semântica
- SQLite pra dados estruturados (lembretes, preferências, fatos permanentes)
- Cada nota de memória segue um formato:

```json
{
  "contexto": "descrição da situação",
  "resultado": "o que aconteceu",
  "solucao": "o que resolveu (se aplicável)",
  "peso": 1.0,
  "ultima_vez_usada": "2026-08-02",
  "tags": ["categoria1", "categoria2"]
}
```

### Decaimento (evita "demência digital")

- Cada memória tem um `peso` que começa em 1.0
- Toda madrugada, uma rotina ("Sonho") roda:
  - Resume as notas das últimas 24h em memórias consolidadas
  - Reduz o peso de memórias não acessadas há muito tempo
  - Apaga memórias de peso muito baixo e sem relevância recorrente
- Na hora de montar o prompt, só as memórias de maior peso relevantes à pergunta atual entram no contexto — isso economiza token de forma direta

---

## Parte 3 — Loop de decisão (3 agentes virtuais, tudo prompts diferentes pro mesmo Claude)

1. **Executor**: tenta rodar uma tarefa/comando, captura erro se houver
2. **Historiador**: busca no banco vetorial se esse erro/situação já apareceu antes
3. **Programador**: recebe o problema atual + memória relevante, gera a solução/código

Isso é só um pipeline de function calling em etapas — nada de "consciência", é engenharia de prompt bem estruturada.

---

## Parte 4 — "Humor" (regras condicionais, não emoção real)

Três variáveis numéricas no servidor: `estabilidade`, `eficiencia`, `nivel_alerta`.

Exemplo de regra:
```js
if (estabilidade < 0.3) {
  systemPromptExtra = "Estabilidade crítica. Respostas curtas, evite ações experimentais.";
}
```

Isso é um `if/else` — funciona bem pra dar a sensação de "humor mudando", mas é comportamento explicitamente programado, não emergente.

---

## Parte 5 — Automodificação (com trilhos de segurança)

1. Claude gera código novo em resposta a um erro/necessidade
2. Servidor valida sintaticamente antes de mandar (roda um linter/parser local)
3. Código é assinado com um hash e enviado via HTTPS autenticado (nunca HTTP puro)
4. ESP32 grava em `main.py`, reinicia
5. Watchdog garante rollback automático se algo quebrar

### Segurança (o que o documento anterior não cobria)

- Autenticação por token assinado em toda comunicação servidor↔chip
- HTTPS obrigatório, nunca WebSocket/HTTP sem criptografia
- Checagem de hash do código antes de gravar (evita corrupção/injeção)
- Rate limiting: no máximo X reescritas por hora, pra evitar loop de auto-modificação descontrolado

---

## Limites reais (pra não perder tempo depois)

- Isso é **automação sofisticada com aparência de autonomia**, não consciência nem aprendizado autônomo verdadeiro
- A "personalidade evolutiva" é memória + regras condicionais, não o modelo mudando seus próprios pesos
- Toda autonomia aqui é **operacional** (roda sem clique humano em tempo real), nunca **de propósito** (os objetivos e limites são sempre definidos por você antes)
- Fine-tuning real do modelo está fora de alcance de custo/hardware pra um projeto pessoal — e mesmo que estivesse disponível, não resolveria a questão de consciência

---

## Parte 6 — Estudo de caso: AIBI Pocket e EMO (Living.AI) — engenharia reversa de referência

Pesquisei a fundo os dois robôs da Living.AI que você mencionou, porque eles são o melhor benchmark comercial de "parecer vivo" sem consciência real. Tudo abaixo é o hardware/lógica real deles, com o mapeamento de como replicar (ou decidir não replicar) cada peça no seu Jarvis.

### AIBI Pocket — ficha técnica real

| Componente | Especificação |
|---|---|
| Dimensões | 170 x 105 x 55 mm (tamanho de estojo de fone) |
| Câmera | Câmera IA rotativa (gira como um gimbal), reconhecimento facial + foto |
| Sensor de presença | Radar de onda milimétrica embutido no corpo pequeno, permitindo perceber presença humana a longa distância |
| Áudio | Array de três microfones no cabeçote de poucos centímetros, com algoritmo que determina direção do som e reconhece comandos com mais precisão |
| Conectividade extra | Comunicação óptica de curto alcance nas costas, permitindo que dois AIBIs troquem contato do dono entre si |
| IA de conversa | ChatGPT via Wi-Fi; comandos básicos funcionam offline |
| Movimento | Só a cabeça/corpo gira (motor na base), não anda — fixo na base de carregamento |
| Toque | Múltiplas zonas sensíveis a toque (cabeça e corpo), disparando reações diferentes — um toque acorda/reconhece, dois toques trocam a expressão facial |

### EMO Go Home — ficha técnica real (mais avançado, tem pernas)

| Componente | Especificação |
|---|---|
| Processamento | SoC com coprocessador de rede neural entregando até 1.2 TOPS, ligado a um array de 4 microfones de campo distante e câmera frontal grande angular |
| Sensores | Sensor de distância laser time-of-flight (até 25cm), quatro sensores óticos de queda sob os pés, giroscópio e acelerômetro de 6 eixos, sensor de toque e sensor de luz |
| Câmera/reconhecimento | Câmera HD para reconhecimento facial de até 10 pessoas, array de 4 microfones para direção do som, sensor de toque na cabeça |
| Locomoção | Anda com duas pernas pequenas, usando sensores incluindo laser sob os pés pra detectar obstáculos e evitar cair da mesa |
| Navegação até a base | Modo "Go Home": memoriza uma área pequena (até ~90x90cm) e evita objetos como copos ou livros, encontrando o caminho de volta ao carregador sozinho |
| Motor de emoção | Sistema de "Emotion Engine" que permite expressões assimétricas, como uma piscadela ou bico de irritação se você interromper uma atividade dele |
| Integração casa inteligente | Vem com lâmpada inteligente via rede mesh — liga/desliga luzes por comando de voz |
| IA de conversa | ChatGPT integrado + reconhecimento de voz/rosto pra até 10 pessoas da família |

### Como cada peça funciona de verdade (sem mistério)

1. **"Ele me segue com o olhar"** — câmera + reconhecimento facial rodando local (o SoC tem NPU dedicada de 1.2 TOPS, processamento de imagem não passa pela nuvem, por isso é instantâneo). Resultado do reconhecimento vira coordenada (x,y) → motor de servo gira até centralizar o rosto
2. **"Ele sabe que estou perto antes de eu falar"** — radar de onda milimétrica (AIBI) ou sensor laser (EMO) disparando um evento de presença → aciona a animação de "acordar"
3. **"Ele não cai da mesa"** — sensores óticos/laser voltados pra baixo, detectando a borda por ausência de reflexo. É engenharia de segurança física, roda local, sem IA nenhuma envolvida
4. **"Ele acha sozinho o caminho de volta pra base"** — não é IA generativa decidindo, é um algoritmo clássico de robótica (SLAM simplificado): mapeia uma área pequena, usa a posição da base como ponto fixo, navega por desvio de obstáculo. É robótica clássica, décadas mais velha que LLMs
5. **"Emoções assimétricas" (EMO)** — biblioteca de +1000 combinações de animação pré-desenhadas, escolhidas por regras de estado (ex: interrompido = X% de chance de escolher animação de "irritado" da lista)
6. **Lembrete de remédio com animação de pílula** — é só um alarme com asset gráfico específico, nada de IA envolvida: `if hora == remedio: tocar_animacao("pilula.gif")`

### O que vale a pena replicar no seu Jarvis (custo x benefício)

| Recurso deles | Vale replicar? | Como, no seu setup |
|---|---|---|
| Detecção de presença (radar/laser) | Sim, se o orçamento permitir | Sensor PIR barato já resolve 80% do efeito — dispensa radar caro |
| Seguir rosto com a câmera | Opcional, custo alto | Precisaria servo + câmera + processamento local (visão tipo OpenCV rodando num Raspberry Pi auxiliar, não no ESP32 — não vale gastar chamada de API pra isso) |
| Reação a toque | Sim, muito barato | Sensor capacitivo de toque custa poucos reais, já dá o efeito "ele sente carinho" |
| Detecção de borda (não cair) | Só relevante se tiver rodas/pernas | Não se aplica ao Xiaozhi fixo |
| Emoções por regras de estado | Sim, já está no documento | Coberto na Parte 4 — biblioteca de expressões no display + variáveis de humor |
| "Go Home" autônomo | Não se aplica | Dispositivo fixo, não anda |
| Reconhecimento de múltiplas pessoas | Interessante a médio prazo | Precisa câmera + embeddings faciais — mais complexo, deixar pra depois |

### Conclusão prática

Os dois robôs confirmam o que discutimos antes: nada ali é consciência ou aprendizado autônomo — é sensoriamento físico barato + regras de estado + biblioteca de animações pré-feitas, tudo rodando local no chip pra não depender de chamada de API a cada movimento. O "viver" percebido vem da velocidade de reação (processamento local, sem latência de rede) combinada com variedade de expressões pré-programadas. É essa fórmula que vale copiar pro seu projeto, e ela é mais simples e barata do que parece de fora.

---

## Roadmap de construção — 4 fases (software → hardware completo)

### Fase 1 — Software puro (PC/celular, custo zero de hardware)

**Objetivo:** validar toda a lógica de "cérebro" antes de gastar um real em peça física.

- [ ] Simulador de dispositivo (`fake-device.js`) conversando via WebSocket com o servidor Jarvis
- [ ] Loop básico de conversa com a API do Claude (texto puro no terminal primeiro)
- [ ] Memória SQLite simples (fatos + lembretes)
- [ ] Memória vetorial (ChromaDB local) + rotina de decaimento ("Sonho" noturno)
- [ ] Loop de 3 agentes (executor / historiador / programador) rodando contra o simulador
- [ ] Variáveis de humor (`estabilidade`, `eficiencia`, `nivel_alerta`) + injeção condicional no system prompt
- [ ] Testar STT/TTS já no PC/celular (mic e alto-falante do próprio aparelho) antes de portar pra placa

**Critério pra passar de fase:** você consegue conversar com o Jarvis pelo PC, ele lembra de fatos entre sessões, muda o tom quando "estressado", e o loop de erro→memória→correção funciona nos testes simulados.

---

### Fase 2 — Placa básica: mic + áudio + display (Xiaozhi ESP32-S3)

**Objetivo:** sair da simulação e validar hardware real de conversa.

**Hardware:**
- Placa ESP32-S3 round display (Xiaozhi) — a que você já escolheu
- Microfone e alto-falante já embutidos no módulo
- Opcional, barato: **sensor PIR de presença** (~R$10–20) — já dá o efeito "ele percebe que cheguei", sem precisar de câmera ainda

**O que implementar:**
- Flash com MicroPython, `boot.py` protegido + watchdog de 30s (Parte 1)
- Conexão real ao `xiaozhi-esp32-server` → seu servidor Jarvis (troca o simulador da Fase 1 pelo dispositivo físico)
- Expressões no display reagindo às variáveis de humor (Parte 4) — primeira vez que o "humor" fica visível de verdade
- Se incluir o PIR: evento de presença dispara animação de "acordar" sem gastar chamada de API (processamento 100% local no chip)

**Critério pra passar de fase:** latência de resposta aceitável, TTS/STT funcionando de forma estável, watchdog testado (force um erro proposital e confirme que ele recupera sozinho).

---

### Fase 3 — Câmera + servo de pescoço (rastreamento facial)

**Objetivo:** o efeito "ele me olha e me reconhece", como no AIBI/EMO (Parte 6).

**Hardware:**
- Módulo de câmera compatível (OV2640 é comum em kits ESP32-CAM)
- 1–2 micro servos pra pan/tilt do "pescoço"
- Processamento de reconhecimento facial: se o ESP32-S3 sozinho não aguentar, vale um Raspberry Pi auxiliar rodando OpenCV/face-recognition local, mandando só a coordenada (x,y) pro ESP32 mover o servo — mantém o processamento fora da API do Claude, sem custo de token

**O que implementar:**
- Loop local: câmera → detecção de rosto → coordenada → comando de servo (nada disso passa pelo LLM, é local e instantâneo, igual ao EMO)
- Memória de reconhecimento: salvar embeddings faciais associados a nomes no SQLite (base pra "múltiplas pessoas" mais adiante)

**Critério pra passar de fase:** o pescoço acompanha seu rosto com latência baixa e sem depender de chamada de API a cada frame.

---

### Fase 4 — Locomoção (andar) + sensores extras

**Objetivo:** dar corpo móvel, como o EMO Go Home — a fase de maior complexidade mecânica do projeto.

**Hardware:**
- Motores de passo ou servos de perna/roda, dependendo do design escolhido
- Sensores óticos/infravermelho voltados pra baixo (anti-queda de mesa — essencial, replica o "drop sensor" do EMO)
- Giroscópio/acelerômetro (IMU 6 eixos) pra equilíbrio
- Base de carregamento com contatos magnéticos, se quiser o modo "Go Home"

**O que implementar:**
- Camada de segurança física primeiro: nenhum motor de locomoção liga sem os sensores anti-queda ativos e calibrados
- Algoritmo de navegação simples (não é IA generativa — é lógica clássica de robótica): mapear área pequena, desviar de obstáculo, retornar à base por triangulação de sinal
- HAL blindada (Parte 1) estendida pra incluir os novos atuadores: `andar_frente()`, `girar()`, `verificar_borda()` — a IA (Claude) só pode chamar essas funções de alto nível, nunca controlar motor bruto diretamente

**Critério pra passar de fase:** o dispositivo anda numa área delimitada sem cair da mesa em testes repetidos, e retorna à base sozinho quando a bateria bate um limiar baixo.

---

### Mapeamento (sensor + algoritmo de navegação)

O ESP32 sozinho só lê o sensor e manda dados brutos — ele não processa o mapa em si (isso pesa demais pro chip). O mapeamento de verdade acontece em duas camadas:

**Camada 1 — Sensor (no corpo do robô):**

| Opção | Custo aprox. | Precisão | Observação |
|---|---|---|---|
| ToF/ultrassônico giratório (VL53L1X + motor de passo) | R$100–150 | Baixa-média | "LiDAR caseiro", ótimo pra evitar objetos próximos e bordas de mesa |
| LiDAR 2D dedicado (TF-Luna ou Xiaomi LDS02RR) | R$150–300 | Boa | Equilíbrio ideal — conecta direto no ESP32 por serial |
| LiDAR 360° (RPLIDAR A1, LDROBOT D500) | R$300–500+ | Alta | Nível profissional, o mesmo tipo usado em robôs aspiradores |

**Camada 2 — Processamento do mapa (fora do ESP32):**

O algoritmo de SLAM (cruzar distância + posição pra montar o mapa da casa) precisa rodar em algo mais forte que o ESP32:
- Opção simples: mandar os dados brutos do sensor pro seu servidor Node.js na VPS via WebSocket, e processar lá um mapa simplificado (grid 2D com obstáculos marcados) — suficiente pra "não bater" e "voltar pra base"
- Opção robusta: um Raspberry Pi auxiliar rodando ROS2, que já tem bibliotecas prontas de SLAM (slam_toolbox) — mais complexo de configurar, mas gera mapas de qualidade profissional

**Recomendação pro seu caso:** comece com o LiDAR 2D simples (TF-Luna) + processamento no seu próprio servidor Node.js. Isso é suficiente pra tudo que você precisa na Fase 4 (desviar de obstáculo, não cair da mesa, voltar pra base) sem precisar meter um Raspberry Pi extra no projeto. Só vale subir pro ROS2/RPLIDAR se um dia quiser mapear uma casa inteira com precisão de cômodos.

---



| Fase | Custo aproximado | Risco técnico | Depende de token de API? |
|---|---|---|---|
| 1 — Software | R$0 (só tempo) | Baixo | Sim, só pra chamadas de teste |
| 2 — Placa básica | Custo do Xiaozhi ESP32-S3 + PIR opcional | Baixo-médio | Sim, por conversa |
| 3 — Câmera + servo | Módulo câmera + 2 servos + Pi opcional | Médio | Não (processamento local) |
| 4 — Locomoção | Motores + sensores anti-queda + IMU | Alto (mecânica) | Não (navegação é local) |

Repare que da Fase 3 em diante, os recursos mais "impressionantes" (seguir rosto, andar, não cair) **não consomem API** — são processamento local, exatamente como AIBI e EMO fazem. Isso significa que seu custo de token não cresce junto com a sofisticação física do robô, só cresce com a quantidade de conversa.
