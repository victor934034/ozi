// Ponto de entrada da seguranca do agente. Quem usa o agente deve passar
// SEMPRE por executarAcao(), e nunca chamar as ferramentas direto.

import { criarGuard } from './guard.js';
import { criarAuditoria } from './audit.js';
import { criarOrcamento } from './budget.js';
import { criarAprovacoes } from './approvals.js';

export { criarGuard, criarAuditoria, criarOrcamento, criarAprovacoes };

export function criarContextoSeguranca({ raiz, arquivoAuditoria, tetoDiarioUsd, tetoMensalUsd, agora }) {
  const guard = criarGuard({ raiz });
  const auditoria = criarAuditoria({ arquivo: arquivoAuditoria });
  const orcamento = criarOrcamento({ tetoDiarioUsd, tetoMensalUsd, agora });
  const aprovacoes = criarAprovacoes({ agora });

  // Executa uma acao passando por todas as regras. `acao` = { tipo, alvo?, custoUsd?, executar }.
  async function executarAcao(acao) {
    const registro = (resultado, motivo) =>
      auditoria.registrar({ tipo: acao.tipo, alvo: acao.alvo ?? null, resultado, motivo: motivo ?? null });

    if (acao.tipo === 'escrever') {
      const decisao = guard.podeEscrever(acao.alvo);
      if (!decisao.permitido) {
        registro('bloqueado', decisao.motivo);
        return { ok: false, motivo: decisao.motivo };
      }
    }

    if (acao.tipo === 'ler') {
      const decisao = guard.podeLer(acao.alvo);
      if (!decisao.permitido) {
        registro('bloqueado', decisao.motivo);
        return { ok: false, motivo: decisao.motivo };
      }
    }

    if (acao.custoUsd) {
      const decisao = orcamento.podeGastar(acao.custoUsd);
      if (!decisao.permitido) {
        registro('bloqueado', decisao.motivo);
        return { ok: false, motivo: decisao.motivo };
      }
    }

    if (guard.exigeAprovacao(acao.tipo)) {
      const pedido = aprovacoes.pedir({ acao: acao.tipo, descricao: acao.descricao ?? acao.tipo, detalhes: acao.detalhes });
      registro('aguardando_aprovacao', pedido.id);
      return { ok: false, aguardandoAprovacao: true, pedidoId: pedido.id };
    }

    const resultado = await acao.executar();
    if (acao.custoUsd) orcamento.registrarGasto(acao.custoUsd);
    registro('executado', null);
    return { ok: true, resultado };
  }

  return { guard, auditoria, orcamento, aprovacoes, executarAcao };
}
