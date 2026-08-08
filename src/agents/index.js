import vm from 'node:vm';
import { askClaude } from '../claude.js';
import { addMemory, searchSimilar } from '../memory/vector.js';
import { registrarErro, registrarSucesso, registrarCorrecaoBemSucedida } from '../mood.js';

// Executor: roda um trecho de JS isolado (vm) e captura erro se houver.
// Isso simula "tentar rodar uma tarefa/comando" sem dar acesso real ao
// sistema de arquivos/rede do host (sandbox do Node vm module).
function executar(codigo) {
  try {
    const contexto = vm.createContext({});
    const resultado = vm.runInContext(codigo, contexto, { timeout: 1000 });
    return { ok: true, resultado };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  }
}

// Historiador: busca no banco vetorial se esse erro ja apareceu antes.
async function buscarHistorico(mensagemErro) {
  return searchSimilar(mensagemErro, { topK: 3 });
}

// Programador: recebe o problema + memoria relevante, gera uma sugestao de correcao.
async function gerarCorrecao(codigoOriginal, mensagemErro, memoriasRelevantes) {
  const contextoMemoria = memoriasRelevantes.length
    ? memoriasRelevantes
        .map((m) => `- contexto anterior: ${m.contexto}\n  solucao que funcionou: ${m.solucao}`)
        .join('\n')
    : '(nenhuma memoria relevante encontrada)';

  const system = `Voce e o "Programador" de um pipeline de autocorrecao. Receba um trecho de
codigo JavaScript que falhou, o erro, e memorias de situacoes parecidas resolvidas antes.
Responda APENAS com o codigo JavaScript corrigido, sem explicacao, sem markdown.`;

  const prompt = `Codigo original:\n${codigoOriginal}\n\nErro:\n${mensagemErro}\n\nMemorias relevantes:\n${contextoMemoria}\n\nCodigo corrigido:`;

  const { texto } = await askClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 512,
  });

  return texto.replace(/```(js|javascript)?/g, '').trim();
}

// Loop completo: executor -> historiador -> programador -> retry (uma vez).
export async function runAgentLoop(codigo) {
  const tentativaInicial = executar(codigo);

  if (tentativaInicial.ok) {
    registrarSucesso();
    return {
      status: 'sucesso',
      resultado: tentativaInicial.resultado,
      etapas: ['executor'],
    };
  }

  registrarErro();
  const memoriasRelevantes = await buscarHistorico(tentativaInicial.erro);
  const codigoCorrigido = await gerarCorrecao(codigo, tentativaInicial.erro, memoriasRelevantes);
  const tentativaCorrigida = executar(codigoCorrigido);

  await addMemory({
    contexto: `codigo: ${codigo}`,
    resultado: `erro: ${tentativaInicial.erro}`,
    solucao: tentativaCorrigida.ok ? codigoCorrigido : '(correcao nao funcionou)',
    tags: ['autocorrecao'],
  });

  if (tentativaCorrigida.ok) {
    registrarCorrecaoBemSucedida();
    return {
      status: 'corrigido',
      erroOriginal: tentativaInicial.erro,
      codigoCorrigido,
      resultado: tentativaCorrigida.resultado,
      memoriasUsadas: memoriasRelevantes.length,
      etapas: ['executor', 'historiador', 'programador', 'executor (retry)'],
    };
  }

  return {
    status: 'falhou',
    erroOriginal: tentativaInicial.erro,
    codigoCorrigido,
    erroCorrecao: tentativaCorrigida.erro,
    memoriasUsadas: memoriasRelevantes.length,
    etapas: ['executor', 'historiador', 'programador', 'executor (retry)'],
  };
}
