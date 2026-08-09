import path from 'node:path';
import db from './sqlite.js';
import { config } from '../config.js';

// Fase 1 usa embeddings locais (Xenova/transformers, sem custo de API e sem
// precisar rodar um servidor ChromaDB separado). Troque por ChromaDB depois
// se quiser, a interface (addMemory/searchSimilar/decayMemories) fica igual.
let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    const { pipeline, env } = await import('@xenova/transformers');
    // Sem isso, o cache do modelo baixado fica fora do volume persistente
    // (/app/data) - todo redeploy/restart do container perderia o cache e
    // baixaria o modelo (~dezenas de MB) de novo na primeira mensagem do
    // primeiro usuario, causando uma demora grande so nessa primeira vez.
    // Apontando pro dataDir, o download so acontece uma vez de verdade.
    env.cacheDir = path.join(config.dataDir, 'modelos-cache');

    // "all-MiniLM-L6-v2" (usado antes) e treinado majoritariamente em ingles
    // e discrimina mal frases em portugues (diferenca de similaridade entre
    // texto relacionado e nao-relacionado era de so ~0.06, na pratica
    // inutil pra busca). Este modelo multilingue separa muito melhor
    // (testado: relacionado ~0.34 vs nao-relacionado ~-0.05).
    embedderPromise = pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }
  return embedderPromise;
}

// Carrega o modelo de embeddings ja na subida do servidor, em vez de deixar
// isso acontecer so quando a primeira mensagem de um usuario chegar - assim
// quem paga esse custo (alguns segundos) e o boot do processo, nao a
// experiencia de quem esta conversando.
export function precarregarEmbedder() {
  const inicio = Date.now();
  getEmbedder()
    .then(() => console.log(`[memoria] modelo de embeddings pronto (${Date.now() - inicio}ms)`))
    .catch((erro) => {
      console.error('[memoria] erro pre-carregando modelo de embeddings:', erro.message);
    });
}

async function embed(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// usuario_id NOT NULL: cada usuario so pode buscar/decair as proprias
// memorias, nunca as de outra pessoa (isolamento entre contas).
db.exec(`
  CREATE TABLE IF NOT EXISTS memorias_vetoriais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    contexto TEXT NOT NULL,
    resultado TEXT,
    solucao TEXT,
    tags TEXT,
    embedding TEXT NOT NULL,
    peso REAL NOT NULL DEFAULT 1.0,
    ultima_vez_usada TEXT NOT NULL DEFAULT (datetime('now')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vetores ja normalizados (norm=1), entao produto interno = cosseno
}

export async function addMemory({ usuarioId, contexto, resultado = '', solucao = '', tags = [] }) {
  const vetor = await embed(`${contexto}\n${resultado}\n${solucao}`);
  const info = db
    .prepare(
      `INSERT INTO memorias_vetoriais (usuario_id, contexto, resultado, solucao, tags, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(usuarioId, contexto, resultado, solucao, JSON.stringify(tags), JSON.stringify(vetor));
  return info.lastInsertRowid;
}

export async function searchSimilar(usuarioId, query, { topK = 3, minPeso = 0.05 } = {}) {
  const queryVec = await embed(query);
  const rows = db
    .prepare('SELECT * FROM memorias_vetoriais WHERE usuario_id = ? AND peso >= ?')
    .all(usuarioId, minPeso);

  const scored = rows.map((row) => {
    const vetor = JSON.parse(row.embedding);
    const similaridade = cosineSim(queryVec, vetor);
    return { ...row, similaridade, score: similaridade * row.peso };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const tocarMemoria = db.prepare(
    `UPDATE memorias_vetoriais
     SET peso = MIN(1.0, peso + 0.1), ultima_vez_usada = datetime('now')
     WHERE id = ?`
  );
  for (const item of top) tocarMemoria.run(item.id);

  return top.map(({ embedding, ...rest }) => rest);
}

// Rotina "Sonho": reduz peso de memorias nao acessadas ha muito tempo e
// apaga as que ficaram irrelevantes. Roda por usuario (pode ser chamada
// manualmente ou agendada de madrugada pra todo mundo).
export function decayMemories(usuarioId, { diasParaDecair = 3, fatorDecaimento = 0.7, pesoMinimo = 0.05 } = {}) {
  const candidatas = db
    .prepare(
      `SELECT id, peso FROM memorias_vetoriais
       WHERE usuario_id = ? AND julianday('now') - julianday(ultima_vez_usada) >= ?`
    )
    .all(usuarioId, diasParaDecair);

  const atualizarPeso = db.prepare('UPDATE memorias_vetoriais SET peso = ? WHERE id = ?');
  const apagar = db.prepare('DELETE FROM memorias_vetoriais WHERE id = ?');

  let decaidas = 0;
  let apagadas = 0;

  for (const { id, peso } of candidatas) {
    const novoPeso = peso * fatorDecaimento;
    if (novoPeso < pesoMinimo) {
      apagar.run(id);
      apagadas++;
    } else {
      atualizarPeso.run(novoPeso, id);
      decaidas++;
    }
  }

  return { decaidas, apagadas };
}

export function listarMemorias(usuarioId) {
  return db
    .prepare(
      'SELECT id, contexto, peso, ultima_vez_usada FROM memorias_vetoriais WHERE usuario_id = ? ORDER BY peso DESC'
    )
    .all(usuarioId);
}
