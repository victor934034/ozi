import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { config } from '../config.js';

// Cada dispositivo precisa de um ID estavel (o mesmo a cada reconexao),
// senao o painel administrativo veria um "robo novo" toda vez que voce
// reiniciasse o simulador. Guardamos esse ID num arquivo local - na
// primeira vez que roda, gera um novo; das proximas, reusa o mesmo.
// Pode sobrescrever via variavel de ambiente DEVICE_ID (util se voce quiser
// simular varios dispositivos diferentes ao mesmo tempo).
function obterDeviceId() {
  if (process.env.DEVICE_ID) return process.env.DEVICE_ID;

  const caminho = path.join(config.dataDir, 'fake-device-id.txt');
  if (existsSync(caminho)) return readFileSync(caminho, 'utf-8').trim();

  mkdirSync(config.dataDir, { recursive: true });
  const novoId = crypto.randomUUID();
  writeFileSync(caminho, novoId);
  return novoId;
}

const deviceId = obterDeviceId();
const deviceNome = process.env.DEVICE_NOME || 'Simulador (fake-device)';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function perguntarRl(pergunta) {
  return new Promise((resolve) => rl.question(pergunta, resolve));
}

// Agora que o servidor exige login, o simulador precisa se autenticar por
// REST antes de abrir o WebSocket - mesma conta que voce usaria no app
// Android ou na pagina web. Da pra passar por variavel de ambiente
// (DEVICE_EMAIL/DEVICE_SENHA) pra nao digitar toda vez, ou digitar na hora.
async function obterCredenciais() {
  const email = process.env.DEVICE_EMAIL || (await perguntarRl('Email: '));
  const senha = process.env.DEVICE_SENHA || (await perguntarRl('Senha: '));
  return { email, senha };
}

async function autenticar() {
  const { email, senha } = await obterCredenciais();
  const urlBase = `http://localhost:${config.port}`;

  const respLogin = await fetch(`${urlBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  const dadosLogin = await respLogin.json();
  if (dadosLogin.ok) return dadosLogin.token;

  // Se o login falhou porque a conta ainda nao existe, oferece criar na hora.
  console.log(`[fake-device] login falhou: ${dadosLogin.erro}`);
  const criar = await perguntarRl('Criar essa conta agora? (s/n): ');
  if (criar.trim().toLowerCase() !== 's') {
    throw new Error('sem conta, encerrando');
  }

  const respRegistro = await fetch(`${urlBase}/api/auth/registrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha, nome: email.split('@')[0] }),
  });
  const dadosRegistro = await respRegistro.json();
  if (!dadosRegistro.ok) throw new Error(`nao deu pra criar conta: ${dadosRegistro.erro}`);
  return dadosRegistro.token;
}

async function main() {
  let token;
  try {
    token = await autenticar();
  } catch (erro) {
    console.error('[fake-device] erro de autenticacao:', erro.message);
    process.exit(1);
  }

  const url = `ws://localhost:${config.port}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'autenticar', token }));
  });

  // O 'ws' passa (data, isBinary) pro handler de 'message'. Texto (JSON) vem
  // com isBinary=false; o audio gerado pelo TTS vem como Buffer binario puro
  // (isBinary=true) - e o mesmo formato que um ESP32 real receberia pra tocar
  // no alto-falante via HAL (tocar_audio()).
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      console.log('[fake-device] recebendo audio da resposta, tocando...');
      tocarAudio(data);
      return; // perguntar() ja foi chamado quando o texto chegou
    }

    const payload = JSON.parse(data.toString());

    if (payload.type === 'autenticado') {
      ws.send(JSON.stringify({ type: 'identificar', device_id: deviceId, nome: deviceNome }));
      console.log(`[fake-device] conectado a ${url} como "${deviceNome}" (${deviceId})`);
      console.log('[fake-device] digite uma mensagem (ou "sair" para encerrar)\n');
      console.log('Comandos especiais: run: <js> | sonho | lembrete: <texto> | lembretes | fato: chave=valor\n');
      perguntar();
      return;
    }

    if (payload.type === 'erro_auth') {
      console.error(`[fake-device] erro de autenticacao: ${payload.texto}`);
      ws.close();
      return;
    }

    if (payload.type === 'assistant_text') {
      console.log(`\nOzi: ${payload.text}\n`);
    } else if (payload.type === 'tts_erro') {
      console.log(`[aviso] nao deu pra gerar audio dessa resposta: ${payload.texto}`);
    } else if (payload.type === 'erro') {
      console.error(`\n[erro do servidor] ${payload.texto}\n`);
    }
    perguntar();
  });

  ws.on('close', () => {
    console.log('[fake-device] conexao encerrada');
    process.exit(0);
  });

  ws.on('error', (erro) => {
    console.error('[fake-device] erro de conexao:', erro.message);
    process.exit(1);
  });

  function perguntar() {
    rl.question('Voce: ', (texto) => {
      if (texto.trim().toLowerCase() === 'sair') {
        ws.close();
        rl.close();
        return;
      }
      ws.send(JSON.stringify({ type: 'user_text', text: texto }));
    });
  }
}

// Simula a HAL de audio do ESP32 (tocar_audio()) usando o alto-falante do
// PC: salva o audio recebido num arquivo .wav temporario e pede pro Windows
// tocar ele. So funciona no Windows (usa PowerShell) - num Linux/Mac voce
// trocaria essa funcao por `afplay`/`aplay`, por exemplo.
function tocarAudio(bufferAudio) {
  const caminhoTemp = path.join(os.tmpdir(), `ozi-fala-${Date.now()}.wav`);
  writeFileSync(caminhoTemp, bufferAudio);

  execFile(
    'powershell',
    ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${caminhoTemp}').PlaySync()`],
    (erro) => {
      if (erro) console.error('[fake-device] erro tocando audio:', erro.message);
    }
  );
}

main();
