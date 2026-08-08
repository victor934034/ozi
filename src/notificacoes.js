// Envia notificacoes push pro app Android via Firebase Cloud Messaging.
//
// PENDENCIA (voce precisa fazer isso uma vez, no console do Firebase):
// 1. console.firebase.google.com -> seu projeto -> Configuracoes do
//    projeto (engrenagem) -> aba "Contas de servico"
// 2. Clique em "Gerar nova chave privada" - baixa um arquivo JSON
// 3. Coloque o CONTEUDO desse arquivo (o JSON inteiro, numa linha so) na
//    variavel de ambiente FIREBASE_SERVICE_ACCOUNT do .env
//
// Sem isso configurado, notificarUsuario() so loga um aviso e nao quebra
// nada - o resto do sistema funciona normal sem notificacoes.

import admin from 'firebase-admin';
import { config } from './config.js';
import { buscarTokensFcm } from './memory/sqlite.js';

let appFirebase = null;

function obterAppFirebase() {
  if (appFirebase) return appFirebase;

  if (!config.firebase.serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT nao configurado no .env.');
  }

  const credenciais = JSON.parse(config.firebase.serviceAccountJson);
  appFirebase = admin.initializeApp({
    credential: admin.credential.cert(credenciais),
  });
  return appFirebase;
}

// Manda uma notificacao pra todos os aparelhos Android logados de um
// usuario (ex: avisar que um lembrete venceu). Se o Firebase nao estiver
// configurado ou o envio falhar, so loga o erro - nunca derruba quem chamou.
export async function notificarUsuario(usuarioId, { titulo, corpo }) {
  try {
    const tokens = buscarTokensFcm(usuarioId);
    if (!tokens.length) return { enviadas: 0 };

    const app = obterAppFirebase();
    const resposta = await admin.messaging(app).sendEachForMulticast({
      tokens,
      notification: { title: titulo, body: corpo },
    });

    console.log(`[notificacoes] ${resposta.successCount}/${tokens.length} enviadas pro usuario ${usuarioId}`);
    return { enviadas: resposta.successCount };
  } catch (erro) {
    console.error('[notificacoes] erro enviando push:', erro.message);
    return { enviadas: 0, erro: erro.message };
  }
}
