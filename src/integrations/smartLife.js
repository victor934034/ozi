// Integracao com Smart Life (Tuya) - controla os dispositivos que ja estao
// cadastrados no seu app Smart Life, atraves da API oficial da Tuya.
//
// Usa o SDK oficial (@tuya/tuya-connector-nodejs, publicado pela propria
// Tuya) em vez de implementar a assinatura HMAC das requisicoes na mao.
//
// Pre-requisito (feito uma vez, fora do codigo): criar um projeto em
// https://iot.tuya.com -> Cloud -> Development, pegar Client ID/Secret, e
// "linkar" sua conta do app Smart Life ao projeto (aba Devices -> Link Tuya
// App Account, escaneando o QR code pelo app). Sem esse link, a lista de
// dispositivos vem sempre vazia mesmo com as credenciais certas.

import { TuyaContext } from '@tuya/tuya-connector-nodejs';
import { config } from '../config.js';

let tuya = null;

function obterCliente() {
  if (tuya) return tuya;

  const { clientId, clientSecret, endpoint } = config.tuya;
  if (!clientId || !clientSecret || !endpoint) {
    throw new Error(
      'Smart Life nao configurado. Defina TUYA_CLIENT_ID, TUYA_CLIENT_SECRET e TUYA_ENDPOINT no .env.'
    );
  }

  tuya = new TuyaContext({
    baseUrl: endpoint,
    accessKey: clientId,
    secretKey: clientSecret,
  });
  return tuya;
}

// Lista todos os dispositivos da conta Smart Life vinculada ao projeto.
//
// Nota tecnica: o endpoint "obvio" pra isso seria device.list() do SDK, mas
// esse endpoint na verdade exige que voce ja saiba os device_ids de
// antemao (serve pra consultar detalhes de dispositivos especificos, nao
// pra "listar tudo"). O jeito certo de listar TODOS os dispositivos de uma
// conta vinculada via "Link App Account" e por UID, atraves de
// /v1.0/users/{uid}/devices - que nao tem um metodo pronto no SDK, entao
// chamamos direto com cliente.request().
export async function listarDispositivos() {
  const cliente = obterCliente();
  const { uid } = config.tuya;

  if (!uid) {
    throw new Error('TUYA_UID nao configurado no .env (veja a UID na aba Devices -> Link App Account do painel Tuya).');
  }

  const resposta = await cliente.request({
    path: `/v1.0/users/${uid}/devices`,
    method: 'GET',
  });

  if (!resposta.success) {
    throw new Error(`Smart Life: erro listando dispositivos - ${resposta.msg || resposta.code}`);
  }

  return resposta.result.map((d) => ({
    id: d.id,
    nome: d.name.trim(),
    categoria: d.category,
    online: d.online,
    // O "status" ja vem junto nessa chamada (economiza uma consulta extra
    // se voce so quer saber, por exemplo, se a luz esta ligada).
    status: d.status,
  }));
}

// Descobre qual "code" o dispositivo usa pra ligar/desligar (varia por tipo
// de aparelho - a maioria usa "switch_1", mas lampadas costumam usar
// "switch_led", por exemplo). Evita hardcodar um unico nome que so funciona
// pra alguns dispositivos.
async function obterCodigoDeLigaDesliga(deviceId) {
  const cliente = obterCliente();
  const resposta = await cliente.deviceFunction.devices({ device_id: deviceId });

  if (!resposta.success) {
    throw new Error(`Smart Life: erro consultando funcoes do dispositivo - ${resposta.msg}`);
  }

  const funcaoDeSwitch = resposta.result.functions.find(
    (f) => f.type === 'Boolean' && f.code.startsWith('switch')
  );

  // Se nao achar nenhuma funcao obviamente de liga/desliga, tenta o nome
  // mais comum como ultimo recurso.
  return funcaoDeSwitch ? funcaoDeSwitch.code : 'switch_1';
}

async function enviarComando(deviceId, codigo, valor) {
  const cliente = obterCliente();

  // Nao usamos cliente.deviceFunction.command() aqui de proposito: essa
  // funcao do SDK tem um bug (manda GET num endpoint que a API da Tuya so
  // aceita POST, e da erro "uri path invalid"). Chamamos o endpoint direto,
  // do jeito que a documentacao da Tuya realmente espera.
  const resposta = await cliente.request({
    path: `/v1.0/iot-03/devices/${deviceId}/commands`,
    method: 'POST',
    body: { commands: [{ code: codigo, value: valor }] },
  });

  if (!resposta.success) {
    throw new Error(`Smart Life: comando falhou - ${resposta.msg || resposta.code}`);
  }
  return true;
}

export async function ligar(deviceId) {
  const codigo = await obterCodigoDeLigaDesliga(deviceId);
  return enviarComando(deviceId, codigo, true);
}

export async function desligar(deviceId) {
  const codigo = await obterCodigoDeLigaDesliga(deviceId);
  return enviarComando(deviceId, codigo, false);
}

// Devolve o status atual (lista de {code, value}) - util pra saber se algo
// ja esta ligado antes de mandar outro comando, ou pra responder "a luz da
// sala ta ligada?".
export async function status(deviceId) {
  const cliente = obterCliente();
  const resposta = await cliente.deviceStatus.status({ device_id: deviceId });

  if (!resposta.success) {
    throw new Error(`Smart Life: erro consultando status - ${resposta.msg}`);
  }
  return resposta.result;
}
