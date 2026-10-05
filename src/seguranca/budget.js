// Teto de gasto do agente, por dia e por mes (em USD, a moeda que a API cobra).
// Ao atingir qualquer teto, o agente para e avisa o dono; nao ha como ultrapassar
// sem alterar o limite, e alterar limite exige aprovacao humana (ver approvals.js).

function chaveDia(data) {
  return data.toISOString().slice(0, 10);
}
function chaveMes(data) {
  return data.toISOString().slice(0, 7);
}

export function criarOrcamento({ tetoDiarioUsd, tetoMensalUsd, agora = () => new Date() }) {
  let gastos = { dia: {}, mes: {} };

  return {
    registrarGasto(valorUsd) {
      if (!(valorUsd >= 0)) throw new Error('valor de gasto invalido');
      const d = agora();
      gastos.dia[chaveDia(d)] = (gastos.dia[chaveDia(d)] || 0) + valorUsd;
      gastos.mes[chaveMes(d)] = (gastos.mes[chaveMes(d)] || 0) + valorUsd;
    },

    situacao() {
      const d = agora();
      return {
        hoje: gastos.dia[chaveDia(d)] || 0,
        mes: gastos.mes[chaveMes(d)] || 0,
        tetoDiarioUsd,
        tetoMensalUsd,
      };
    },

    // Pode fazer mais uma chamada que custa `estimativaUsd`?
    podeGastar(estimativaUsd = 0) {
      const s = this.situacao();
      if (s.hoje + estimativaUsd > tetoDiarioUsd) {
        return { permitido: false, motivo: `teto diario de US$ ${tetoDiarioUsd} atingido` };
      }
      if (s.mes + estimativaUsd > tetoMensalUsd) {
        return { permitido: false, motivo: `teto mensal de US$ ${tetoMensalUsd} atingido` };
      }
      return { permitido: true };
    },
  };
}
