import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
  wsPort: Number(process.env.JARVIS_WS_PORT) || 8787,
  webPort: Number(process.env.JARVIS_WEB_PORT) || 8788,

  // Qual provedor de TTS (texto -> audio) usar. Hoje so existe "fish-audio",
  // mas o resto do sistema nunca fala com o provedor diretamente - so com
  // src/tts/index.js - entao adicionar um novo provedor no futuro (ex:
  // "elevenlabs") e so criar o arquivo do provedor e trocar essa variavel.
  ttsProvider: process.env.TTS_PROVIDER || 'fish-audio',

  fishAudio: {
    apiKey: process.env.FISH_AUDIO_API_KEY,
    // s2.1-pro-free = modelo gratuito da Fish Audio (ver documentacao oficial).
    modelo: process.env.FISH_AUDIO_MODEL || 's2.1-pro-free',
    // wav e o formato mais simples de tocar (tem cabecalho, qualquer player
    // reconhece), por isso e o padrao aqui. mp3/opus/pcm tambem sao aceitos
    // pela API se um dia precisar economizar banda.
    formato: process.env.FISH_AUDIO_FORMAT || 'wav',
    // Troca qualidade por velocidade: "normal" (padrao da API) prioriza
    // qualidade e e mais lento; "balanced" reduz um pouco a qualidade e
    // acelera a geracao; "low" e o mais rapido possivel. Pra um assistente
    // de voz, resposta rapida importa mais que audio perfeito.
    latencia: process.env.FISH_AUDIO_LATENCY || 'balanced',
    // Opcional: ID de uma voz especifica da biblioteca da Fish Audio.
    // Sem isso, a API usa a voz padrao do modelo.
    vozId: process.env.FISH_AUDIO_VOICE_ID || undefined,
    // Plano gratuito da Fish Audio permite no maximo 5 requisicoes
    // simultaneas. Deixamos configuravel caso voce faca upgrade de plano.
    maxConcorrente: Number(process.env.FISH_AUDIO_MAX_CONCORRENTE) || 5,
  },

  // Preco oficial da API do Claude Sonnet 5 (promocional ate 31/08/2026,
  // ver https://docs.claude.com/en/docs/about-claude/pricing). Usado pra
  // calcular quanto cada dispositivo gastou no painel administrativo.
  // Se a Anthropic mudar o preco, so atualizar aqui.
  claudePrecos: {
    porMilhaoEntrada: Number(process.env.CLAUDE_PRECO_ENTRADA_USD) || 2,
    porMilhaoSaida: Number(process.env.CLAUDE_PRECO_SAIDA_USD) || 10,
  },

  auth: {
    // Assina/valida os tokens JWT emitidos no login. Se isso vazar, da pra
    // forjar login de qualquer usuario - nunca comite o .env.
    jwtSecret: process.env.JWT_SECRET || null,
    // Client ID do projeto Firebase/Google Cloud - usado pra validar o
    // token que o app Android manda depois do "Entrar com Google". Fica
    // vazio ate voce configurar o Firebase (ver README).
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  },

  tuya: {
    clientId: process.env.TUYA_CLIENT_ID,
    clientSecret: process.env.TUYA_CLIENT_SECRET,
    projectCode: process.env.TUYA_PROJECT_CODE,
    // Depende do "Data Center" escolhido ao criar o projeto no
    // iot.tuya.com - ver .env.example pra lista de endpoints por regiao.
    endpoint: process.env.TUYA_ENDPOINT,
    // UID da conta do Smart Life vinculada ao projeto (painel Tuya -> aba
    // Devices -> Link App Account). Uso pessoal = so uma conta por enquanto.
    uid: process.env.TUYA_UID,
  },

  firebase: {
    // Conteudo INTEIRO (numa linha so) do JSON da conta de servico gerada
    // em Firebase Console -> Configuracoes do projeto -> Contas de servico
    // -> Gerar nova chave privada. Usado pra ENVIAR notificacoes push
    // (diferente do google-services.json do app, que so RECEBE).
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT || null,
  },
};

if (!config.anthropicApiKey) {
  console.warn(
    '[config] ANTHROPIC_API_KEY nao definido. Copie .env.example para .env e preencha a chave.'
  );
}

if (!config.auth.jwtSecret) {
  console.warn(
    '[config] JWT_SECRET nao definido. Login/registro de usuario vai falhar ate voce definir isso no .env (gere com: openssl rand -hex 32).'
  );
}
