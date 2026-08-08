import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'jarvis.db'));
db.pragma('journal_mode = WAL');

// --- Migracao pra schema multiusuario --------------------------------
// As tabelas originais (Fase 1, single-user) nao tinham usuario_id. Como
// isso muda constraints (ex: "chave" de fato passa a ser UNICA POR
// USUARIO, nao globalmente), nao da pra so ALTER TABLE ADD COLUMN - a
// tabela precisa ser recriada. So os dados de teste da Fase 1 se perdem
// aqui (nada de producao, o sistema ainda nao tinha usuarios de verdade).
const jaEhMultiusuario = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usuarios'")
  .get();

if (!jaEhMultiusuario) {
  db.exec(`
    DROP TABLE IF EXISTS fatos;
    DROP TABLE IF EXISTS lembretes;
    DROP TABLE IF EXISTS dispositivos;
    DROP TABLE IF EXISTS uso_claude;
    DROP TABLE IF EXISTS memorias_vetoriais;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT,
    google_id TEXT UNIQUE,
    nome TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fatos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    chave TEXT NOT NULL,
    valor TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(usuario_id, chave)
  );

  CREATE TABLE IF NOT EXISTS lembretes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    descricao TEXT NOT NULL,
    quando TEXT,
    concluido INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Guarda 1 linha por chamada de TTS (texto->audio). Serve pra voce
  -- acompanhar ao longo do tempo quantas chamadas foram feitas, quantas
  -- falharam, e o tempo medio de resposta - fica salvo em disco, entao
  -- sobrevive a reinicios do servidor (diferente de um contador em memoria).
  CREATE TABLE IF NOT EXISTS tts_chamadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provedor TEXT NOT NULL,
    sucesso INTEGER NOT NULL,
    caracteres INTEGER NOT NULL,
    duracao_ms INTEGER NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Um mini-robo (ESP32 real ou o simulador) por linha, pertencendo a um
  -- usuario. Cadastro e automatico na primeira vez que ele se conecta e se
  -- identifica. "conectado" reflete se tem uma conexao WebSocket ativa
  -- AGORA (atualizado no connect/close do servidor).
  CREATE TABLE IF NOT EXISTS dispositivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    device_id TEXT NOT NULL,
    nome TEXT NOT NULL,
    conectado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    ultima_conexao TEXT,
    UNIQUE(usuario_id, device_id)
  );

  -- Uma linha por chamada ao Claude, com os tokens de entrada/saida e o
  -- custo ja calculado em dolar. Amarrado ao usuario + dispositivo que
  -- originou a conversa.
  CREATE TABLE IF NOT EXISTS uso_claude (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    device_id TEXT NOT NULL,
    tokens_entrada INTEGER NOT NULL,
    tokens_saida INTEGER NOT NULL,
    custo_usd REAL NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Zera o status "conectado" de todo mundo quando o servidor sobe - evita
// que um dispositivo fique preso como "online" pra sempre se o servidor
// caiu sem rodar o evento de desconexao da vez anterior.
db.prepare('UPDATE dispositivos SET conectado = 0').run();

// Migracao aditiva (nao destrutiva): adiciona a coluna de token do
// Firebase Cloud Messaging se ainda nao existir, sem apagar nada.
const colunasDispositivos = db.prepare("PRAGMA table_info(dispositivos)").all();
if (!colunasDispositivos.some((c) => c.name === 'fcm_token')) {
  db.exec('ALTER TABLE dispositivos ADD COLUMN fcm_token TEXT');
}

// --- Usuarios ---

export function criarUsuario({ email, senhaHash, nome, googleId }) {
  const info = db
    .prepare('INSERT INTO usuarios (email, senha_hash, google_id, nome) VALUES (?, ?, ?, ?)')
    .run(email, senhaHash, googleId, nome);
  return buscarUsuarioPorId(info.lastInsertRowid);
}

export function buscarUsuarioPorEmail(email) {
  return db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email) || null;
}

export function buscarUsuarioPorGoogleId(googleId) {
  if (!googleId) return null;
  return db.prepare('SELECT * FROM usuarios WHERE google_id = ?').get(googleId) || null;
}

export function buscarUsuarioPorId(id) {
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) || null;
}

// --- Fatos (por usuario) ---

export function salvarFato(usuarioId, chave, valor) {
  db.prepare(
    `INSERT INTO fatos (usuario_id, chave, valor) VALUES (?, ?, ?)
     ON CONFLICT(usuario_id, chave) DO UPDATE SET valor = excluded.valor`
  ).run(usuarioId, chave, valor);
}

export function buscarFato(usuarioId, chave) {
  const row = db.prepare('SELECT valor FROM fatos WHERE usuario_id = ? AND chave = ?').get(usuarioId, chave);
  return row ? row.valor : null;
}

export function listarFatos(usuarioId) {
  return db
    .prepare('SELECT chave, valor FROM fatos WHERE usuario_id = ? ORDER BY criado_em DESC')
    .all(usuarioId);
}

// --- Lembretes (por usuario) ---

export function criarLembrete(usuarioId, descricao, quando = null) {
  const info = db
    .prepare('INSERT INTO lembretes (usuario_id, descricao, quando) VALUES (?, ?, ?)')
    .run(usuarioId, descricao, quando);
  return info.lastInsertRowid;
}

export function listarLembretesPendentes(usuarioId) {
  return db
    .prepare('SELECT * FROM lembretes WHERE usuario_id = ? AND concluido = 0 ORDER BY criado_em DESC')
    .all(usuarioId);
}

export function concluirLembrete(usuarioId, id) {
  db.prepare('UPDATE lembretes SET concluido = 1 WHERE id = ? AND usuario_id = ?').run(id, usuarioId);
}

// --- TTS (uso agregado, nao e sensivel por usuario - fica global) ---

export function registrarChamadaTTS({ provedor, sucesso, caracteres, duracaoMs }) {
  db.prepare(
    `INSERT INTO tts_chamadas (provedor, sucesso, caracteres, duracao_ms)
     VALUES (?, ?, ?, ?)`
  ).run(provedor, sucesso ? 1 : 0, caracteres, duracaoMs);
}

export function contarChamadasTTS(provedor) {
  const linha = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN sucesso = 1 THEN 1 ELSE 0 END) AS sucessos
       FROM tts_chamadas WHERE provedor = ?`
    )
    .get(provedor);
  const total = linha.total || 0;
  const sucessos = linha.sucessos || 0;
  return { total, sucessos, falhas: total - sucessos };
}

// --- Dispositivos (por usuario) ---

export function registrarConexaoDispositivo(usuarioId, deviceId, nome) {
  db.prepare(
    `INSERT INTO dispositivos (usuario_id, device_id, nome, conectado, ultima_conexao)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(usuario_id, device_id) DO UPDATE SET
       nome = excluded.nome,
       conectado = 1,
       ultima_conexao = datetime('now')`
  ).run(usuarioId, deviceId, nome);
}

export function registrarDesconexaoDispositivo(usuarioId, deviceId) {
  db.prepare('UPDATE dispositivos SET conectado = 0 WHERE usuario_id = ? AND device_id = ?').run(usuarioId, deviceId);
}

// Lista os dispositivos de UM usuario, com status atual e total gasto em
// Claude (soma de uso_claude, 0 se nunca usou).
export function listarDispositivos(usuarioId) {
  return db
    .prepare(
      `SELECT
         d.device_id,
         d.nome,
         d.conectado,
         d.criado_em,
         d.ultima_conexao,
         COALESCE(SUM(u.custo_usd), 0) AS custo_total_usd,
         COUNT(u.id) AS total_chamadas_claude
       FROM dispositivos d
       LEFT JOIN uso_claude u ON u.device_id = d.device_id AND u.usuario_id = d.usuario_id
       WHERE d.usuario_id = ?
       GROUP BY d.device_id
       ORDER BY d.conectado DESC, d.ultima_conexao DESC`
    )
    .all(usuarioId);
}

// Registra uma chamada ao Claude (tokens + custo em dolar) associada a um
// usuario + dispositivo especifico.
export function registrarUsoClaude({ usuarioId, deviceId, tokensEntrada, tokensSaida, custoUsd }) {
  db.prepare(
    `INSERT INTO uso_claude (usuario_id, device_id, tokens_entrada, tokens_saida, custo_usd)
     VALUES (?, ?, ?, ?, ?)`
  ).run(usuarioId, deviceId, tokensEntrada, tokensSaida, custoUsd);
}

// --- Notificacoes push (token do Firebase Cloud Messaging) ---

export function salvarTokenFcm(usuarioId, deviceId, token) {
  db.prepare('UPDATE dispositivos SET fcm_token = ? WHERE usuario_id = ? AND device_id = ?').run(
    token,
    usuarioId,
    deviceId
  );
}

// Todos os tokens FCM validos de um usuario (pode ter mais de um
// dispositivo Android) - usado pra mandar notificacao pra todos de uma vez.
export function buscarTokensFcm(usuarioId) {
  return db
    .prepare('SELECT fcm_token FROM dispositivos WHERE usuario_id = ? AND fcm_token IS NOT NULL')
    .all(usuarioId)
    .map((linha) => linha.fcm_token);
}

export default db;
