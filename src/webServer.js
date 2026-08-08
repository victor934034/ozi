import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { listarDispositivos } from './memory/sqlite.js';
import { registrar, login, loginComGoogle, validarToken } from './auth.js';

const publicDir = path.join(config.rootDir, 'public');

const tiposConteudo = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function lerCorpoJson(req) {
  return new Promise((resolve, reject) => {
    let corpo = '';
    req.on('data', (chunk) => {
      corpo += chunk;
      if (corpo.length > 10_000) req.destroy(); // protecao basica contra corpo gigante
    });
    req.on('end', () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch (erro) {
        reject(erro);
      }
    });
    req.on('error', reject);
  });
}

function responderJson(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados));
}

// Extrai o usuario autenticado a partir do header Authorization: Bearer
// <token JWT>. Devolve null se o token estiver ausente/invalido/expirado -
// quem chama decide o que fazer (normalmente responder 401).
function usuarioDaRequisicao(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    return validarToken(token);
  } catch {
    return null;
  }
}

function usuarioPublico(usuario) {
  return { id: usuario.id, email: usuario.email, nome: usuario.nome };
}

function servirArquivoEstatico(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(publicDir, urlPath);

  // Nao deixa sair do diretorio public/
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Proibido');
    return;
  }

  fs.readFile(filePath, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404);
      res.end('Nao encontrado');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': tiposConteudo[ext] || 'application/octet-stream' });
    res.end(conteudo);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- Cadastro por email + senha ---
  if (url.pathname === '/api/auth/registrar' && req.method === 'POST') {
    try {
      const { email, senha, nome } = await lerCorpoJson(req);
      const { usuario, token } = await registrar({ email, senha, nome });
      responderJson(res, 201, { ok: true, token, usuario: usuarioPublico(usuario) });
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro.message });
    }
    return;
  }

  // --- Login por email + senha ---
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, senha } = await lerCorpoJson(req);
      const { usuario, token } = await login({ email, senha });
      responderJson(res, 200, { ok: true, token, usuario: usuarioPublico(usuario) });
    } catch (erro) {
      responderJson(res, 401, { ok: false, erro: erro.message });
    }
    return;
  }

  // --- Login com Google (usado pelo app Android) ---
  // O app manda o "ID token" que recebeu do Google Identity Services -
  // o servidor valida isso direto com o Google, nunca ve a senha da conta.
  if (url.pathname === '/api/auth/google' && req.method === 'POST') {
    try {
      const { idToken } = await lerCorpoJson(req);
      const { usuario, token } = await loginComGoogle(idToken);
      responderJson(res, 200, { ok: true, token, usuario: usuarioPublico(usuario) });
    } catch (erro) {
      responderJson(res, 401, { ok: false, erro: erro.message });
    }
    return;
  }

  // --- Painel administrativo: listar MEUS dispositivos ---
  // Cada usuario logado ve so os proprios dispositivos - nao existe mais
  // uma senha de "super admin" que ve tudo de todo mundo.
  if (url.pathname === '/api/dispositivos' && req.method === 'GET') {
    const usuario = usuarioDaRequisicao(req);
    if (!usuario) {
      responderJson(res, 401, { erro: 'Nao autorizado. Faca login primeiro.' });
      return;
    }

    const dispositivos = listarDispositivos(usuario.id);
    responderJson(res, 200, { dispositivos });
    return;
  }

  servirArquivoEstatico(req, res);
});

server.listen(config.webPort, () => {
  console.log(`[web] pagina do Ozi em http://localhost:${config.webPort}`);
  console.log(`[web] painel administrativo em http://localhost:${config.webPort}/admin.html`);
});
