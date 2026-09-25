// Rota de OTA que o firmware xiaozhi consulta ao ligar (CONFIG_OTA_URL).
// Ela devolve o endereco do WebSocket + token e a hora do servidor. NAO
// devolve a secao "firmware" nem "activation" de proposito: sem "firmware" o
// dispositivo nunca tenta atualizar, e sem "activation" ele considera-se
// ativado e vai direto pro modo de conversa (ver main/ota.cc no xiaozhi).

import { config } from '../config.js';
import { emitirToken } from '../auth.js';
import db, { buscarUsuarioPorEmail } from '../memory/sqlite.js';

// Conta dona dos dispositivos ESP: XIAOZHI_OWNER_EMAIL, ou a primeira conta
// cadastrada. (Vinculo por dispositivo fica pra uma etapa futura.)
export function usuarioDonoDosDispositivos() {
  if (config.xiaozhi.donoEmail) return buscarUsuarioPorEmail(config.xiaozhi.donoEmail);
  return db.prepare('SELECT * FROM usuarios ORDER BY id ASC LIMIT 1').get();
}

function urlPublicaDoWebSocket(req) {
  if (config.xiaozhi.urlPublica) return config.xiaozhi.urlPublica;
  // Atras do proxy do EasyPanel o esquema real vem em x-forwarded-proto.
  const https = (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
  return `${https ? 'wss' : 'ws'}://${req.headers.host}/xiaozhi/v1/`;
}

export function tratarOtaXiaozhi(req, res) {
  const dono = usuarioDonoDosDispositivos();
  if (!dono) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Nenhuma conta Ozi cadastrada ainda.' }));
    return;
  }

  const deviceId = req.headers['device-id'] || 'desconhecido';
  console.log(`[xiaozhi] OTA consultado por ${deviceId} (conta ${dono.email})`);

  const resposta = {
    server_time: {
      timestamp: Date.now(),
      timezone_offset: -180, // America/Sao_Paulo, em minutos
    },
    websocket: {
      url: urlPublicaDoWebSocket(req),
      token: emitirToken(dono),
      version: 1,
    },
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resposta));
}
