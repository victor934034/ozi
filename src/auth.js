// Autenticacao multiusuario: cadastro/login por email+senha, login com
// Google, e emissao/validacao de tokens JWT. Cada usuario tem seus proprios
// fatos, lembretes, memoria vetorial, dispositivos e gasto de Claude -
// tudo isolado por usuario_id (ver src/memory/sqlite.js).

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { criarUsuario, buscarUsuarioPorEmail, buscarUsuarioPorGoogleId, buscarUsuarioPorId } from './memory/sqlite.js';

const CUSTO_HASH = 12; // rounds do bcrypt - 12 e um padrao seguro sem ficar lento demais
const VALIDADE_TOKEN = '30d';

function emitirToken(usuario) {
  if (!config.auth.jwtSecret) {
    throw new Error('JWT_SECRET nao configurado no servidor.');
  }
  return jwt.sign(
    { usuarioId: usuario.id, email: usuario.email },
    config.auth.jwtSecret,
    { expiresIn: VALIDADE_TOKEN }
  );
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Cadastro/login por email + senha ---

export async function registrar({ email, senha, nome }) {
  if (!validarEmail(email)) {
    throw new Error('Email invalido.');
  }
  if (!senha || senha.length < 8) {
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }
  if (buscarUsuarioPorEmail(email)) {
    throw new Error('Ja existe uma conta com esse email.');
  }

  const senhaHash = await bcrypt.hash(senha, CUSTO_HASH);
  const usuario = criarUsuario({ email, senhaHash, nome: nome || email.split('@')[0], googleId: null });

  return { usuario, token: emitirToken(usuario) };
}

export async function login({ email, senha }) {
  const usuario = buscarUsuarioPorEmail(email);

  // Mensagem de erro identica pros dois casos (usuario nao existe / senha
  // errada) - evita que alguem descubra quais emails tem conta so testando.
  const erroGenerico = () => new Error('Email ou senha incorretos.');

  if (!usuario || !usuario.senha_hash) throw erroGenerico();

  const senhaConfere = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaConfere) throw erroGenerico();

  return { usuario, token: emitirToken(usuario) };
}

// --- Login com Google ---
// O app Android usa o Google Identity Services pra obter um "ID token"
// depois que o usuario escolhe a conta Google - a gente so precisa validar
// esse token com o Google (confirma que e legitimo e pega o email de la),
// nunca vemos a senha da conta Google do usuario.

let googleClient = null;
function obterGoogleClient() {
  if (!config.auth.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID nao configurado no servidor (configure o Firebase primeiro).');
  }
  if (!googleClient) googleClient = new OAuth2Client(config.auth.googleClientId);
  return googleClient;
}

export async function loginComGoogle(idToken) {
  const client = obterGoogleClient();

  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.auth.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Token do Google invalido.');
  }

  let usuario = buscarUsuarioPorGoogleId(payload.sub) || buscarUsuarioPorEmail(payload.email);

  if (!usuario) {
    usuario = criarUsuario({
      email: payload.email,
      senhaHash: null,
      nome: payload.name || payload.email.split('@')[0],
      googleId: payload.sub,
    });
  }

  return { usuario, token: emitirToken(usuario) };
}

// --- Validacao de token (usada no WebSocket e na API do painel) ---

export function validarToken(token) {
  if (!config.auth.jwtSecret) {
    throw new Error('JWT_SECRET nao configurado no servidor.');
  }
  const payload = jwt.verify(token, config.auth.jwtSecret); // lanca excecao se invalido/expirado
  const usuario = buscarUsuarioPorId(payload.usuarioId);
  if (!usuario) throw new Error('Usuario do token nao existe mais.');
  return usuario;
}
