// Log de auditoria append-only com hash encadeado. Cada linha guarda o hash
// da anterior; mudar ou apagar uma linha quebra a cadeia e verificar() acusa.
// Nao existe funcao de editar ou apagar entradas.

import fs from 'node:fs';
import crypto from 'node:crypto';

const HASH_INICIAL = '0'.repeat(64);

function calcularHash(anterior, registro) {
  return crypto.createHash('sha256').update(anterior + JSON.stringify(registro)).digest('hex');
}

export function criarAuditoria({ arquivo }) {
  function ultimoHash() {
    if (!fs.existsSync(arquivo)) return HASH_INICIAL;
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
    return linhas.length ? JSON.parse(linhas[linhas.length - 1]).hash : HASH_INICIAL;
  }

  return {
    registrar(evento) {
      const registro = { em: new Date().toISOString(), ...evento };
      const anterior = ultimoHash();
      const linha = { ...registro, anterior, hash: calcularHash(anterior, registro) };
      fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n');
      return linha;
    },

    // Confere a cadeia inteira. Devolve { valido, quebradaNaLinha }.
    verificar() {
      if (!fs.existsSync(arquivo)) return { valido: true, quebradaNaLinha: null };
      const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
      let anterior = HASH_INICIAL;
      for (let i = 0; i < linhas.length; i++) {
        const { anterior: ant, hash, ...registro } = JSON.parse(linhas[i]);
        if (ant !== anterior || calcularHash(anterior, registro) !== hash) {
          return { valido: false, quebradaNaLinha: i + 1 };
        }
        anterior = hash;
      }
      return { valido: true, quebradaNaLinha: null };
    },
  };
}
