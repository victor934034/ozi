// WebSocket do protocolo xiaozhi (ver docs/websocket.md no repositorio
// 78/xiaozhi-esp32). O firmware manda audio Opus (16kHz, mono, quadros de
// 60ms) e JSON de controle; aqui a gente:
//   1. detecta o fim da fala (VAD por energia - o modo "auto" do firmware
//      espera que o SERVIDOR decida quando o usuario parou de falar);
//   2. transcreve com Whisper (Groq);
//   3. manda o texto pro cerebro do Ozi (mesma processarMensagem do app);
//   4. converte a resposta em voz (Fish Audio, PCM) e devolve em Opus,
//      no ritmo de fala real pra nao estourar a fila de decodificacao do ESP.

import { WebSocketServer } from 'ws';
import OpusScript from 'opusscript';
import { validarToken } from '../auth.js';
import { processarMensagem } from '../server.js';
import { gerarAudio } from '../tts/index.js';
import { registrarConexaoDispositivo, registrarDesconexaoDispositivo } from '../memory/sqlite.js';
import { transcrever } from './stt.js';

const TAXA = 16000;
const QUADRO_MS = 60;
const AMOSTRAS_QUADRO = (TAXA * QUADRO_MS) / 1000; // 960

// --- VAD por energia (RMS de cada quadro de 60ms) ---
const LIMIAR_MINIMO_RMS = 450; // abaixo disso e ruido de fundo
const QUADROS_PARA_INICIAR = 2; // 120ms seguidos acima do limiar = comecou a falar
const SILENCIO_FINAL_MS = 900; // quanto silencio depois da fala fecha a frase
const FALA_MINIMA_MS = 300; // menos que isso e um estalo, nao uma frase
const FALA_MAXIMA_MS = 15000; // corta frases enormes
const ESPERA_INICIAL_MS = 10000; // sem ninguem falar, desiste de escutar

function rms(pcm) {
  let soma = 0;
  const n = pcm.length / 2;
  for (let i = 0; i < pcm.length; i += 2) {
    const v = pcm.readInt16LE(i);
    soma += v * v;
  }
  return Math.sqrt(soma / n);
}

function limparParaFala(texto) {
  return texto
    .replace(/[*_`#>~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function dividirEmFrases(texto) {
  const partes = texto.match(/[^.!?\n]+[.!?]*/g) || [texto];
  const frases = [];
  let atual = '';
  for (const p of partes.map((x) => x.trim()).filter(Boolean)) {
    atual = atual ? `${atual} ${p}` : p;
    if (atual.length >= 40) {
      frases.push(atual);
      atual = '';
    }
  }
  if (atual) frases.push(atual);
  return frases;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function criarWebSocketXiaozhi() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const deviceId = req.headers['device-id'] || 'xiaozhi';
    let usuario;
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      usuario = validarToken(token);
    } catch {
      console.log(`[xiaozhi] ${deviceId}: token invalido, recusando`);
      ws.close(1008, 'token invalido');
      return;
    }

    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const decoder = new OpusScript(TAXA, 1, OpusScript.Application.AUDIO);
    const encoder = new OpusScript(TAXA, 1, OpusScript.Application.AUDIO);
    const historico = [];

    let escutando = false;
    let modo = 'auto';
    let processando = false;
    let falando = false;
    let cancelarFala = false;
    let quadros = []; // PCM (Buffer) da fala atual
    let iniciouFala = false;
    let acimaSeguidos = 0;
    let msFala = 0;
    let msSilencio = 0;
    let msEspera = 0;

    registrarConexaoDispositivo(usuario.id, deviceId, 'Ozi (xiaozhi)');
    console.log(`[xiaozhi] ${deviceId} conectado (conta ${usuario.email})`);

    const enviar = (obj) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ session_id: sessionId, ...obj }));
    };

    function reiniciarEscuta() {
      quadros = [];
      iniciouFala = false;
      acimaSeguidos = 0;
      msFala = 0;
      msSilencio = 0;
      msEspera = 0;
    }

    async function falar(texto) {
      const frases = dividirEmFrases(limparParaFala(texto));
      if (!frases.length) return;

      falando = true;
      cancelarFala = false;
      enviar({ type: 'tts', state: 'start' });

      // Gera o audio da proxima frase enquanto a atual ainda toca.
      const gerar = (frase) =>
        gerarAudio(frase, { sampleRate: TAXA, formato: 'pcm' }).then((r) => r.audio);
      let proximo = gerar(frases[0]);

      try {
        for (let i = 0; i < frases.length && !cancelarFala; i++) {
          const pcm = await proximo;
          if (i + 1 < frases.length) proximo = gerar(frases[i + 1]);

          enviar({ type: 'tts', state: 'sentence_start', text: frases[i] });

          // PCM -> quadros de 60ms -> Opus, enviados em ritmo de tempo real
          // (com uma rajada inicial pequena pra encher o buffer do ESP).
          const inicio = Date.now();
          let n = 0;
          for (let off = 0; off < pcm.length && !cancelarFala; off += AMOSTRAS_QUADRO * 2) {
            let quadro = pcm.subarray(off, off + AMOSTRAS_QUADRO * 2);
            if (quadro.length < AMOSTRAS_QUADRO * 2) {
              quadro = Buffer.concat([quadro, Buffer.alloc(AMOSTRAS_QUADRO * 2 - quadro.length)]);
            }
            if (ws.readyState !== ws.OPEN) return;
            ws.send(Buffer.from(encoder.encode(quadro, AMOSTRAS_QUADRO)));
            n++;
            const alvo = inicio + Math.max(0, n - 4) * QUADRO_MS; // 4 quadros de folga
            const espera = alvo - Date.now();
            if (espera > 0) await dormir(espera);
          }
        }
      } catch (erro) {
        console.error('[xiaozhi] erro no TTS:', erro.message);
      } finally {
        falando = false;
        enviar({ type: 'tts', state: 'stop' });
      }
    }

    async function responder() {
      const pcm = Buffer.concat(quadros);
      reiniciarEscuta();
      processando = true;
      try {
        const texto = await transcrever(pcm, TAXA);
        console.log(`[xiaozhi] STT: "${texto}"`);
        if (!texto) return;

        enviar({ type: 'stt', text: texto });
        const { resposta, ehConversa } = await processarMensagem(texto, historico, usuario.id, deviceId);
        console.log(`[xiaozhi] resposta: "${resposta.slice(0, 120)}"`);
        await falar(ehConversa ? resposta : resposta.slice(0, 300));
      } catch (erro) {
        console.error('[xiaozhi] erro processando fala:', erro.message);
        enviar({ type: 'alert', status: 'Erro', message: erro.message.slice(0, 80), emotion: 'sad' });
      } finally {
        processando = false;
      }
    }

    function tratarQuadroDeAudio(opus) {
      let pcm;
      try {
        pcm = Buffer.from(decoder.decode(opus));
      } catch {
        return;
      }
      const energia = rms(pcm);
      const falando_agora = energia > LIMIAR_MINIMO_RMS;

      if (!iniciouFala) {
        msEspera += QUADRO_MS;
        acimaSeguidos = falando_agora ? acimaSeguidos + 1 : 0;
        // guarda um pouco antes do inicio da fala pra nao cortar a primeira silaba
        quadros.push(pcm);
        if (quadros.length > 5 && acimaSeguidos === 0) quadros.shift();
        if (acimaSeguidos >= QUADROS_PARA_INICIAR) {
          iniciouFala = true;
          msFala = acimaSeguidos * QUADRO_MS;
          msSilencio = 0;
        } else if (msEspera >= ESPERA_INICIAL_MS && modo !== 'manual') {
          reiniciarEscuta(); // ninguem falou; recomeca a esperar sem acumular
        }
        return;
      }

      quadros.push(pcm);
      msFala += QUADRO_MS;
      msSilencio = falando_agora ? 0 : msSilencio + QUADRO_MS;

      if (modo !== 'manual' && (msSilencio >= SILENCIO_FINAL_MS || msFala >= FALA_MAXIMA_MS)) {
        if (msFala - msSilencio >= FALA_MINIMA_MS) responder();
        else reiniciarEscuta();
      }
    }

    ws.on('message', (data, ehBinario) => {
      if (ehBinario) {
        // Ignora o que chega enquanto o Ozi processa ou fala (eco/ruido).
        if (escutando && !processando && !falando) tratarQuadroDeAudio(data);
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        ws.send(
          JSON.stringify({
            type: 'hello',
            transport: 'websocket',
            session_id: sessionId,
            audio_params: { format: 'opus', sample_rate: TAXA, channels: 1, frame_duration: QUADRO_MS },
          })
        );
      } else if (msg.type === 'listen') {
        if (msg.state === 'start') {
          escutando = true;
          modo = msg.mode || 'auto';
          reiniciarEscuta();
        } else if (msg.state === 'stop') {
          escutando = false;
          // No modo manual (segurar o botao) o "stop" e quem fecha a frase.
          if (modo === 'manual' && quadros.length && !processando) responder();
          else reiniciarEscuta();
        } else if (msg.state === 'detect') {
          console.log(`[xiaozhi] palavra de ativacao: ${msg.text || ''}`);
        }
      } else if (msg.type === 'abort') {
        cancelarFala = true;
        reiniciarEscuta();
      }
      // "mcp" (respostas do dispositivo) e outros tipos: ignorados por enquanto.
    });

    ws.on('close', () => {
      cancelarFala = true;
      registrarDesconexaoDispositivo(usuario.id, deviceId);
      decoder.delete();
      encoder.delete();
      console.log(`[xiaozhi] ${deviceId} desconectado`);
    });

    ws.on('error', (erro) => console.error('[xiaozhi] erro no socket:', erro.message));
  });

  return wss;
}
