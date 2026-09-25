// Transcricao de fala (STT) via Whisper na Groq. Recebe PCM 16-bit mono 16kHz
// e devolve o texto. Usa fetch/FormData nativos do Node.

import { config } from '../config.js';

const URL_GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export function pcmParaWav(pcm, taxa = 16000) {
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + pcm.length, 4);
  cab.write('WAVE', 8);
  cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20); // PCM
  cab.writeUInt16LE(1, 22); // mono
  cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36);
  cab.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cab, pcm]);
}

export async function transcrever(pcm, taxa = 16000) {
  const { apiKey, modelo } = config.groq;
  if (!apiKey) throw new Error('GROQ_API_KEY nao definida no servidor.');

  const form = new FormData();
  form.append('file', new Blob([pcmParaWav(pcm, taxa)], { type: 'audio/wav' }), 'fala.wav');
  form.append('model', modelo);
  form.append('language', 'pt');
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const resposta = await fetch(URL_GROQ_STT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new Error(`Groq STT erro ${resposta.status}: ${corpo.slice(0, 200)}`);
  }

  const { text } = await resposta.json();
  return (text || '').trim();
}
