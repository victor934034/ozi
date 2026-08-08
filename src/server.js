import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { askClaudeComFerramentas } from './claude.js';
import { promptExtraDoHumor, getEstado } from './mood.js';
import { addMemory, searchSimilar, decayMemories } from './memory/vector.js';
import {
  criarLembrete,
  listarLembretesPendentes,
  listarFatos,
  salvarFato,
  registrarConexaoDispositivo,
  registrarDesconexaoDispositivo,
  registrarUsoClaude,
} from './memory/sqlite.js';
import { runAgentLoop } from './agents/index.js';
import { gerarAudio } from './tts/index.js';
import { listarDispositivos as listarDispositivosSmartLife, ligar, desligar } from './integrations/smartLife.js';
import { validarToken } from './auth.js';

const SYSTEM_BASE = `Voce e o Ozi, um assistente pessoal rodando localmente. Seja direto,
util e natural em portugues do Brasil. Voce tem memoria de conversas anteriores (injetada
abaixo quando relevante) e um estado interno que pode mudar seu tom.

Sua resposta tambem vai ser convertida em audio e falada em voz alta, entao mantenha as
respostas curtas e conversacionais (1 a 3 frases na maioria dos casos) - evite paragrafos
longos, listas extensas ou explicacoes detalhadas, a nao ser que o usuario peca
explicitamente mais detalhe ou profundidade. Textos mais longos demoram mais pra gerar o
audio, entao brevidade tambem significa resposta mais rapida.

Voce tem acesso a ferramentas pra controlar dispositivos smart home (Smart Life) da casa
do usuario, como luzes e tomadas. Quando o usuario pedir pra ligar/desligar algo ou
perguntar o que esta ligado, use as ferramentas em vez de so responder que nao pode fazer
isso.`;

function montarSystemPrompt({ memorias, fatos }) {
  const partes = [SYSTEM_BASE, promptExtraDoHumor()];

  if (fatos.length) {
    partes.push(
      `Fatos conhecidos sobre o usuario:\n${fatos.map((f) => `- ${f.chave}: ${f.valor}`).join('\n')}`
    );
  }

  if (memorias.length) {
    partes.push(
      `Memorias relevantes para esta conversa:\n${memorias
        .map((m) => `- ${m.contexto} -> ${m.resultado}`)
        .join('\n')}`
    );
  }

  return partes.join('\n\n');
}

// Calcula em dolar o custo de uma chamada ao Claude a partir dos tokens
// retornados pela API, usando os precos configurados (ver config.js).
function calcularCustoClaude({ tokensEntrada, tokensSaida }) {
  const { porMilhaoEntrada, porMilhaoSaida } = config.claudePrecos;
  return (tokensEntrada / 1_000_000) * porMilhaoEntrada + (tokensSaida / 1_000_000) * porMilhaoSaida;
}

// --- Ferramentas que o Claude pode escolher usar sozinho (tool use) -------
// Isso e o que permite falar naturalmente ("desliga a luz do meu quarto")
// em vez de precisar digitar um comando fixo tipo "casa: desligar quarto".
// O Claude le a descricao de cada ferramenta e decide, pelo que o usuario
// pediu, se e quando vale a pena chamar alguma.
const FERRAMENTAS_CASA = [
  {
    name: 'listar_dispositivos_casa',
    description:
      'Lista os dispositivos smart home (Smart Life/Tuya) da casa do usuario, com nome, categoria e se estao online. Use quando o usuario perguntar o que tem em casa, ou antes de controlar algo se voce nao tiver certeza do nome exato.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'controlar_dispositivo_casa',
    description:
      'Liga ou desliga um dispositivo smart home da casa do usuario pelo nome (aceita nome parcial/aproximado, ex: "quarto" acha um dispositivo chamado "luz do quarto").',
    input_schema: {
      type: 'object',
      properties: {
        nome: {
          type: 'string',
          description: 'Nome ou parte do nome do dispositivo, como o usuario mencionou (ex: "quarto", "sofia", "tomada").',
        },
        acao: { type: 'string', enum: ['ligar', 'desligar'] },
      },
      required: ['nome', 'acao'],
    },
  },
];

// Executa de fato a ferramenta que o Claude pediu pra chamar, e devolve o
// resultado como texto/JSON (formato que o "tool_result" da API espera).
// Erros viram um JSON de erro em vez de excecao - assim o Claude consegue
// ler o que deu errado e explicar pro usuario, em vez da conversa travar.
async function executarFerramenta(blocoFerramenta) {
  try {
    if (blocoFerramenta.name === 'listar_dispositivos_casa') {
      const dispositivos = await listarDispositivosSmartLife();
      return JSON.stringify(dispositivos);
    }

    if (blocoFerramenta.name === 'controlar_dispositivo_casa') {
      const { nome, acao } = blocoFerramenta.input;
      const dispositivos = await listarDispositivosSmartLife();
      const alvo = dispositivos.find((d) => d.nome.toLowerCase().includes(nome.toLowerCase()));

      if (!alvo) {
        return JSON.stringify({ erro: `Nenhum dispositivo encontrado com "${nome}" no nome.` });
      }

      await (acao === 'ligar' ? ligar(alvo.id) : desligar(alvo.id));
      return JSON.stringify({ ok: true, dispositivo: alvo.nome, acao });
    }

    return JSON.stringify({ erro: `Ferramenta desconhecida: ${blocoFerramenta.name}` });
  } catch (erro) {
    return JSON.stringify({ erro: erro.message });
  }
}

// Loop de conversa COM ferramentas: chama o Claude, e se ele responder
// pedindo pra usar uma ferramenta (stop_reason === 'tool_use'), executa,
// manda o resultado de volta, e repete ate ele dar uma resposta final em
// texto. Na maioria das conversas (sem pedido de controlar a casa) isso
// acontece numa unica chamada, igual ao fluxo sem ferramentas.
async function responderComFerramentas({ system, messages }) {
  const usoAcumulado = { tokensEntrada: 0, tokensSaida: 0 };
  let resposta = await askClaudeComFerramentas({ system, messages, tools: FERRAMENTAS_CASA });

  while (resposta.stop_reason === 'tool_use') {
    usoAcumulado.tokensEntrada += resposta.usage.input_tokens;
    usoAcumulado.tokensSaida += resposta.usage.output_tokens;

    messages.push({ role: 'assistant', content: resposta.content });

    const blocosFerramenta = resposta.content.filter((bloco) => bloco.type === 'tool_use');
    const resultados = await Promise.all(blocosFerramenta.map(executarFerramenta));

    messages.push({
      role: 'user',
      content: blocosFerramenta.map((bloco, i) => ({
        type: 'tool_result',
        tool_use_id: bloco.id,
        content: resultados[i],
      })),
    });

    resposta = await askClaudeComFerramentas({ system, messages, tools: FERRAMENTAS_CASA });
  }

  usoAcumulado.tokensEntrada += resposta.usage.input_tokens;
  usoAcumulado.tokensSaida += resposta.usage.output_tokens;

  const blocoTexto = resposta.content.find((bloco) => bloco.type === 'text');
  const texto = blocoTexto ? blocoTexto.text : '';
  messages.push({ role: 'assistant', content: texto });

  return { texto, uso: usoAcumulado };
}

// Devolve { resposta, ehConversa }. `ehConversa` so vem true quando a
// resposta veio de verdade do Claude (nao de um comando utilitario tipo
// "lembretes" ou do dump de JSON do loop de agentes) - e o que usamos pra
// decidir se vale a pena gastar uma chamada de TTS gerando audio pra ela.
// `usuarioId` identifica de QUEM sao os fatos/lembretes/memoria/custo -
// nunca e null aqui, porque a conexao so chega nesse ponto depois de
// autenticada (ver iniciarServidor). `deviceId` pode ser null se o cliente
// autenticado ainda nao se identificou como um dispositivo especifico.
async function processarMensagem(texto, historicoConversa, usuarioId, deviceId) {
  const textoLower = texto.trim().toLowerCase();

  if (textoLower.startsWith('run:') || textoLower.startsWith('executar:')) {
    const codigo = texto.slice(texto.indexOf(':') + 1).trim();
    const resultado = await runAgentLoop(codigo);
    const resposta = `[agentes] status=${resultado.status} etapas=${resultado.etapas.join(' -> ')}\n${JSON.stringify(
      resultado,
      null,
      2
    )}`;
    return { resposta, ehConversa: false };
  }

  if (textoLower === 'sonho' || textoLower === '/sonho') {
    const { decaidas, apagadas } = decayMemories(usuarioId);
    return {
      resposta: `[sonho] ${decaidas} memorias decaidas, ${apagadas} memorias apagadas.`,
      ehConversa: false,
    };
  }

  if (textoLower.startsWith('lembrete:')) {
    const descricao = texto.slice(texto.indexOf(':') + 1).trim();
    const id = criarLembrete(usuarioId, descricao);
    return { resposta: `Lembrete #${id} salvo: "${descricao}"`, ehConversa: false };
  }

  if (textoLower === 'lembretes' || textoLower === '/lembretes') {
    const pendentes = listarLembretesPendentes(usuarioId);
    const resposta = pendentes.length
      ? pendentes.map((l) => `#${l.id} - ${l.descricao}`).join('\n')
      : 'Nenhum lembrete pendente.';
    return { resposta, ehConversa: false };
  }

  if (textoLower.startsWith('fato:')) {
    const resto = texto.slice(texto.indexOf(':') + 1).trim();
    const [chave, ...valorPartes] = resto.split('=');
    if (chave && valorPartes.length) {
      salvarFato(usuarioId, chave.trim(), valorPartes.join('=').trim());
      return {
        resposta: `Fato salvo: ${chave.trim()} = ${valorPartes.join('=').trim()}`,
        ehConversa: false,
      };
    }
    return { resposta: 'Use o formato: fato: chave=valor', ehConversa: false };
  }

  if (textoLower === 'casa' || textoLower === 'casa: dispositivos') {
    try {
      const dispositivos = await listarDispositivosSmartLife();
      const resposta = dispositivos
        .map((d) => `${d.online ? '🟢' : '⚪'} ${d.nome} (${d.categoria})`)
        .join('\n');
      return { resposta, ehConversa: false };
    } catch (erro) {
      return { resposta: `Smart Life: ${erro.message}`, ehConversa: false };
    }
  }

  if (textoLower.startsWith('casa: ligar ') || textoLower.startsWith('casa: desligar ')) {
    const ligando = textoLower.startsWith('casa: ligar ');
    const nomeBuscado = texto.slice(texto.indexOf(' ', texto.indexOf(' ') + 1) + 1).trim();

    try {
      const dispositivos = await listarDispositivosSmartLife();
      const alvo = dispositivos.find((d) => d.nome.toLowerCase().includes(nomeBuscado.toLowerCase()));

      if (!alvo) {
        return {
          resposta: `Nao achei nenhum dispositivo com "${nomeBuscado}" no nome. Use "casa" pra ver a lista.`,
          ehConversa: false,
        };
      }

      await (ligando ? ligar(alvo.id) : desligar(alvo.id));
      return { resposta: `${ligando ? 'Ligado' : 'Desligado'}: ${alvo.nome}`, ehConversa: false };
    } catch (erro) {
      return { resposta: `Smart Life: ${erro.message}`, ehConversa: false };
    }
  }

  // Conversa normal: busca memorias + fatos, monta prompt, chama Claude.
  // Cada etapa e cronometrada (console.log no final) pra facilitar achar
  // onde a demora esta concentrada quando a resposta parecer lenta.
  const t0 = Date.now();
  const memorias = await searchSimilar(usuarioId, texto, { topK: 3 });
  const t1 = Date.now();

  const fatos = listarFatos(usuarioId).slice(0, 10);
  const system = montarSystemPrompt({ memorias, fatos });

  historicoConversa.push({ role: 'user', content: texto });
  const { texto: resposta, uso } = await responderComFerramentas({
    system,
    messages: historicoConversa.slice(-20),
  });
  const t2 = Date.now();
  historicoConversa.push({ role: 'assistant', content: resposta });

  if (deviceId) {
    const custoUsd = calcularCustoClaude(uso);
    registrarUsoClaude({
      usuarioId,
      deviceId,
      tokensEntrada: uso.tokensEntrada,
      tokensSaida: uso.tokensSaida,
      custoUsd,
    });
  }

  // Nao precisamos esperar a memoria ser salva pra responder o usuario -
  // isso so atrasava o texto (e, por tabela, o audio) sem necessidade.
  // Erros aqui so vao pro log, nao derrubam a conversa.
  addMemory({ usuarioId, contexto: texto, resultado: resposta, tags: ['conversa'] }).catch((erro) =>
    console.error('[memoria] erro salvando memoria da conversa:', erro.message)
  );

  console.log(
    `[timing] busca memoria: ${t1 - t0}ms | claude: ${t2 - t1}ms | total ate resposta em texto: ${t2 - t0}ms`
  );

  return { resposta, ehConversa: true };
}

export function iniciarServidor() {
  const wss = new WebSocketServer({ port: config.wsPort });

  wss.on('connection', (ws) => {
    console.log('[server] cliente conectado (nao autenticado ainda)');
    const historicoConversa = [];
    let usuario = null; // so preenchido depois de {type:'autenticar', token} valido
    let deviceId = null;

    ws.on('message', async (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'erro', texto: 'JSON invalido' }));
        return;
      }

      // Primeiro passo obrigatorio de toda conexao: autenticar com um
      // token JWT (emitido no login/registro - ver src/auth.js e
      // src/webServer.js). Nada mais e processado antes disso.
      if (payload.type === 'autenticar') {
        try {
          usuario = validarToken(payload.token);
          console.log(`[server] usuario autenticado: ${usuario.email}`);
          ws.send(JSON.stringify({ type: 'autenticado', estado: getEstado() }));
        } catch (erro) {
          ws.send(JSON.stringify({ type: 'erro_auth', texto: 'Token invalido ou expirado, faca login de novo.' }));
          ws.close();
        }
        return;
      }

      if (!usuario) {
        ws.send(JSON.stringify({ type: 'erro_auth', texto: 'Autentique-se primeiro (mande {type: "autenticar", token}).' }));
        return;
      }

      if (payload.type === 'identificar') {
        deviceId = payload.device_id;
        registrarConexaoDispositivo(usuario.id, deviceId, payload.nome || deviceId);
        console.log(`[server] dispositivo identificado: ${payload.nome || deviceId} (${deviceId}) do usuario ${usuario.email}`);
        return;
      }

      if (payload.type !== 'user_text') return;

      try {
        const { resposta, ehConversa } = await processarMensagem(payload.text, historicoConversa, usuario.id, deviceId);

        // 1. Manda o texto primeiro - o dispositivo ja pode mostrar/logar
        //    a resposta sem esperar o audio ficar pronto.
        ws.send(JSON.stringify({ type: 'assistant_text', text: resposta, estado: getEstado() }));

        // 2. Gera o audio (so pra respostas de conversa de verdade, nao pra
        //    saida de comandos utilitarios) e manda assim que fica pronto,
        //    como uma mensagem binaria separada.
        if (ehConversa) {
          try {
            const { audio } = await gerarAudio(resposta);
            ws.send(audio);
          } catch (erroTts) {
            // Se o TTS falhar (chave invalida, limite estourado, API fora do
            // ar, etc.) a conversa continua funcionando so em texto - a
            // gente so avisa o cliente, sem derrubar a resposta inteira.
            console.error('[server] TTS falhou, respondendo so em texto:', erroTts.message);
            ws.send(JSON.stringify({ type: 'tts_erro', texto: erroTts.message }));
          }
        }
      } catch (erro) {
        console.error('[server] erro processando mensagem:', erro);
        ws.send(JSON.stringify({ type: 'erro', texto: erro.message }));
      }
    });

    ws.on('close', () => {
      if (usuario && deviceId) registrarDesconexaoDispositivo(usuario.id, deviceId);
      console.log('[server] cliente desconectado' + (deviceId ? ` (${deviceId})` : ''));
    });
  });

  console.log(`[server] Ozi brain ouvindo em ws://localhost:${config.wsPort}`);
  return wss;
}

iniciarServidor();
