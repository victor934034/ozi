// Provedor de TTS (texto -> audio) usando a API REST da Fish Audio.
//
// Documentacao oficial do endpoint que usamos aqui:
// https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
//
// Por que fetch nativo em vez do pacote npm "fish-audio"?
// O pacote "fish-audio" do npm NAO e oficial da Fish Audio - e um SDK gerado
// automaticamente por um desenvolvedor terceiro (maintainer pequeno, versao
// 0.1.0 na epoca em que isso foi escrito). Ele usa MessagePack e um sistema
// de streaming customizado por baixo dos panos, o que deixaria esse codigo
// bem mais dificil de entender e mais fragil (pacote pouco usado pode mudar
// ou sumir sem aviso). A API da Fish Audio tambem aceita JSON puro
// (confirmado nos exemplos oficiais da doc), entao usar o `fetch` que ja
// vem embutido no Node e mais simples, mais transparente pra debugar, e nao
// adiciona nenhuma dependencia nova no projeto.
//
// Este arquivo so precisa exportar UMA funcao com a assinatura
// `async (texto) => { audio: Buffer, formato: string }`. Quem chama essa
// funcao e sempre o src/tts/index.js, nunca o resto do sistema diretamente -
// isso que permite trocar de provedor no futuro sem mexer em mais nada.

import { config } from '../../config.js';

const URL_FISH_AUDIO_TTS = 'https://api.fish.audio/v1/tts';

// --- Controle de concorrencia --------------------------------------------
// O plano gratuito da Fish Audio (modelo s2.1-pro-free) permite no maximo
// `config.fishAudio.maxConcorrente` (5 por padrao) requisicoes rodando ao
// mesmo tempo. Se a gente disparar uma 6a chamada em paralelo, a API
// provavelmente responde com erro de limite.
//
// Em vez de deixar isso estourar, implementamos um semaforo simples: um
// contador de "quantas chamadas estao em andamento agora" + uma fila de
// chamadas esperando a vez. Quando uma chamada termina (sucesso ou erro),
// ela libera a vaga pra proxima da fila comecar.
let chamadasEmAndamento = 0;
const filaDeEspera = [];

// Pede uma "vaga" pra fazer a chamada. Se ja tem 5 rodando, essa Promise so
// resolve quando alguma delas terminar e abrir espaco.
function esperarVaga() {
  if (chamadasEmAndamento < config.fishAudio.maxConcorrente) {
    chamadasEmAndamento++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    filaDeEspera.push(resolve);
  });
}

// Devolve a vaga depois que a chamada termina (sucesso ou erro) e libera a
// proxima pessoa da fila, se tiver alguem esperando.
function liberarVaga() {
  chamadasEmAndamento--;
  const proximaResolve = filaDeEspera.shift();
  if (proximaResolve) {
    chamadasEmAndamento++;
    proximaResolve();
  }
}

// Funcao principal deste provedor: recebe o texto, devolve o audio pronto.
export async function gerarAudioFishAudio(texto) {
  const { apiKey, modelo, formato, vozId, latencia } = config.fishAudio;

  if (!apiKey) {
    // Erro claro e imediato em vez de deixar o fetch falhar de forma confusa.
    throw new Error(
      'FISH_AUDIO_API_KEY nao definida. Pegue sua chave em https://fish.audio e coloque no .env'
    );
  }

  // Espera uma vaga no semaforo antes de gastar uma requisicao de verdade.
  await esperarVaga();

  try {
    const resposta = await fetch(URL_FISH_AUDIO_TTS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // O modelo vai no HEADER (nao no corpo) - assim que a API da Fish
        // Audio espera. "s2.1-pro-free" e o modelo gratuito.
        model: modelo,
      },
      body: JSON.stringify({
        text: texto,
        format: formato,
        latency: latencia,
        // reference_id so entra no corpo se voce configurou uma voz
        // especifica; se nao, a API usa a voz padrao do modelo.
        ...(vozId ? { reference_id: vozId } : {}),
      }),
    });

    // A API nao devolve JSON em caso de sucesso - devolve os bytes do audio
    // direto no corpo da resposta. Erros, sim, vem como JSON/texto.
    if (!resposta.ok) {
      const corpoErro = await resposta.text().catch(() => '');

      if (resposta.status === 401) {
        throw new Error('Fish Audio: chave de API invalida (401). Confira FISH_AUDIO_API_KEY no .env.');
      }
      if (resposta.status === 402) {
        throw new Error(
          'Fish Audio: sem permissao de cobranca ou limite do plano gratuito atingido (402).'
        );
      }
      if (resposta.status === 429) {
        // Isso so deveria acontecer se outro processo tambem estiver
        // chamando a Fish Audio ao mesmo tempo (o semaforo acima cobre o
        // uso dentro deste servidor, mas nao chamadas vindas de outro lugar).
        throw new Error(
          'Fish Audio: limite de requisicoes simultaneas estourado (429), mesmo com a fila local. Tente novamente em instantes.'
        );
      }

      throw new Error(`Fish Audio: erro ${resposta.status} - ${corpoErro || resposta.statusText}`);
    }

    const bytesDoAudio = await resposta.arrayBuffer();
    return { audio: Buffer.from(bytesDoAudio), formato };
  } finally {
    // Libera a vaga sempre, mesmo se deu erro - senao a fila trava pra sempre.
    liberarVaga();
  }
}
