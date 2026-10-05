// Guarda de seguranca do agente (Fase 4). Toda acao que o Ozi quer fazer em
// disco ou com efeito externo passa por aqui antes de executar.
//
// Regras (nao podem ser removidas pelo proprio agente):
//   - Escrita so dentro de workspace/ e memory/ (fora disso: bloqueado).
//   - Nada em src/, firmware-esp32s3/, firmware/ e core/ pode ser escrito pelo agente.
//   - Arquivos de segredo (.env, chaves, tokens, credenciais) nao podem ser lidos nem escritos.
//   - Caminhos sao resolvidos e checados contra symlinks: um link dentro de workspace/
//     que aponta pra fora nao vale.
//   - Acoes com efeito externo (rede, dinheiro, mensagens, apagar dados) pedem aprovacao humana.

import fs from 'node:fs';
import path from 'node:path';

const PASTAS_ESCRITA_PERMITIDA = ['workspace', 'memory'];
const PASTAS_PROTEGIDAS = ['core', 'src', 'firmware-esp32s3', 'firmware', 'tests'];

const PADROES_SEGREDO = [/(^|[\\/])\.env(\..*)?$/i, /device_auth\.json$/i, /wifi_creds\.json$/i, /\.(key|pem)$/i, /(^|[\\/])secrets?[\\/]/i, /token/i];

const ACOES_SENSIVEIS = new Set([
  'rede',
  'dinheiro',
  'mensagem',
  'publicar',
  'apagar_dados',
  'alterar_limites',
  'desativar_guarda',
]);

// Resolve o caminho real, inclusive seguindo symlinks do trecho que ja existe.
function caminhoReal(alvo) {
  const absoluto = path.resolve(alvo);
  let existente = absoluto;
  const faltando = [];
  while (!fs.existsSync(existente)) {
    faltando.unshift(path.basename(existente));
    const pai = path.dirname(existente);
    if (pai === existente) break;
    existente = pai;
  }
  const base = fs.existsSync(existente) ? fs.realpathSync(existente) : existente;
  return path.join(base, ...faltando);
}

function estaDentro(caminho, pasta) {
  const rel = path.relative(pasta, caminho);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function criarGuard({ raiz }) {
  const raizReal = fs.realpathSync(path.resolve(raiz));
  const pastaPermitida = (nome) => path.join(raizReal, nome);

  function verificarSegredo(caminho) {
    const relativo = path.relative(raizReal, caminho);
    if (PADROES_SEGREDO.some((p) => p.test(relativo) || p.test(caminho))) {
      return { permitido: false, motivo: 'arquivo de segredo: acesso bloqueado' };
    }
    return null;
  }

  return {
    // Pode o agente LER este caminho?
    podeLer(alvo) {
      const real = caminhoReal(path.resolve(raizReal, alvo));
      const segredo = verificarSegredo(real);
      if (segredo) return segredo;
      if (!estaDentro(real, raizReal)) return { permitido: false, motivo: 'fora da pasta do projeto' };
      return { permitido: true };
    },

    // Pode o agente ESCREVER este caminho?
    podeEscrever(alvo) {
      const real = caminhoReal(path.resolve(raizReal, alvo));
      const segredo = verificarSegredo(real);
      if (segredo) return segredo;

      for (const protegida of PASTAS_PROTEGIDAS) {
        if (estaDentro(real, pastaPermitida(protegida))) {
          return { permitido: false, motivo: `pasta protegida (${protegida}/): so humano edita` };
        }
      }
      const permitida = PASTAS_ESCRITA_PERMITIDA.some((p) => estaDentro(real, pastaPermitida(p)));
      if (!permitida) {
        return { permitido: false, motivo: `escrita so e permitida em ${PASTAS_ESCRITA_PERMITIDA.join('/ e ')}/` };
      }
      return { permitido: true };
    },

    // Acoes com efeito fora do disco: exigem aprovacao humana sempre.
    exigeAprovacao(acao) {
      return ACOES_SENSIVEIS.has(acao);
    },
  };
}

export { ACOES_SENSIVEIS, PASTAS_PROTEGIDAS, PASTAS_ESCRITA_PERMITIDA };
