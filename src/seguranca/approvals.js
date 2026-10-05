// Fila de aprovacoes humanas. O agente so PEDE; quem aprova ou nega e o dono,
// por um caminho que o agente nao consegue chamar (aprovar/negar sao funcoes
// separadas, e o guard nao expoe nenhuma delas para as ferramentas).

import crypto from 'node:crypto';

export function criarAprovacoes({ agora = () => new Date() } = {}) {
  const pendentes = new Map();

  return {
    pedir({ acao, descricao, detalhes = {} }) {
      const id = crypto.randomBytes(6).toString('hex');
      const pedido = { id, acao, descricao, detalhes, criadoEm: agora().toISOString(), estado: 'pendente' };
      pendentes.set(id, pedido);
      return pedido;
    },

    listarPendentes() {
      return [...pendentes.values()].filter((p) => p.estado === 'pendente');
    },

    // Chamado pelo painel/terminal do dono, nunca pelo agente.
    aprovar(id) {
      return decidir(id, 'aprovado');
    },
    negar(id) {
      return decidir(id, 'negado');
    },

    estado(id) {
      return pendentes.get(id)?.estado ?? null;
    },
  };

  function decidir(id, estado) {
    const pedido = pendentes.get(id);
    if (!pedido) throw new Error(`aprovacao ${id} nao existe`);
    if (pedido.estado !== 'pendente') throw new Error(`aprovacao ${id} ja foi ${pedido.estado}`);
    pedido.estado = estado;
    pedido.decididoEm = agora().toISOString();
    return pedido;
  }
}
