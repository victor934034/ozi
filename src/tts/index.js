// Ponto UNICO de entrada do sistema de TTS (Text-to-Speech = texto virando
// audio). O resto do projeto (server.js, etc.) so deve importar `gerarAudio`
// DESTE arquivo - nunca de um provedor especifico (ex: fishAudio.js)
// diretamente.
//
// Por que isso importa: se um dia voce quiser trocar de provedor (ex: sair
// da Fish Audio e usar ElevenLabs ou Edge TTS), voce so precisa:
//   1. criar src/tts/providers/novoProvedor.js exportando uma funcao com a
//      mesma assinatura: async (texto) => { audio: Buffer, formato: string }
//   2. registrar essa funcao no mapa PROVEDORES abaixo
//   3. mudar a variavel de ambiente TTS_PROVIDER
// Nenhum outro arquivo do projeto precisa mudar uma linha sequer.

import { config } from '../config.js';
import { gerarAudioFishAudio } from './providers/fishAudio.js';
import { registrarChamadaTTS, contarChamadasTTS } from '../memory/sqlite.js';

// Mapa "nome do provedor" -> "funcao que sabe gerar audio com esse provedor".
const PROVEDORES = {
  'fish-audio': gerarAudioFishAudio,
};

/**
 * Recebe um texto (ex: a resposta que o Claude gerou) e devolve um audio
 * pronto pra tocar, no formato { audio: Buffer, formato: 'wav' | 'mp3' | ... }.
 *
 * Essa funcao tambem cuida de duas coisas que sao iguais pra qualquer
 * provedor (por isso ficam aqui e nao dentro de cada provider):
 *   - contar quantas chamadas foram feitas (sucesso/falha), salvando no
 *     SQLite pra voce acompanhar o uso crescendo ao longo do tempo;
 *   - logar no console um resumo de cada chamada.
 */
export async function gerarAudio(texto) {
  const nomeProvedor = config.ttsProvider;
  const funcaoDoProvedor = PROVEDORES[nomeProvedor];

  if (!funcaoDoProvedor) {
    throw new Error(
      `Provedor de TTS desconhecido: "${nomeProvedor}". Provedores disponiveis: ${Object.keys(PROVEDORES).join(', ')}`
    );
  }

  const inicio = Date.now();

  try {
    const resultado = await funcaoDoProvedor(texto);
    const duracaoMs = Date.now() - inicio;

    registrarChamadaTTS({
      provedor: nomeProvedor,
      sucesso: true,
      caracteres: texto.length,
      duracaoMs,
    });

    const { total, falhas } = contarChamadasTTS(nomeProvedor);
    console.log(
      `[tts] chamada #${total} (${nomeProvedor}) OK - ${texto.length} caracteres - ${duracaoMs}ms - falhas ate agora: ${falhas}`
    );

    return resultado;
  } catch (erro) {
    const duracaoMs = Date.now() - inicio;

    registrarChamadaTTS({
      provedor: nomeProvedor,
      sucesso: false,
      caracteres: texto.length,
      duracaoMs,
    });

    const { total, falhas } = contarChamadasTTS(nomeProvedor);
    console.error(`[tts] chamada #${total} (${nomeProvedor}) FALHOU - ${erro.message} - falhas ate agora: ${falhas}`);

    // Repassa o erro pra quem chamou decidir o que fazer (ex: o server.js
    // pode optar por responder so em texto quando o audio falha, em vez de
    // travar a conversa inteira).
    throw erro;
  }
}
