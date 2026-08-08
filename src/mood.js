// "Humor" e apenas if/else sobre variaveis numericas, nao emocao real
// (ver Parte 4 do projeto-jarvis.md). Serve pra dar sensacao de reatividade.
const estado = {
  estabilidade: 1.0,
  eficiencia: 1.0,
  nivel_alerta: 0.0,
};

const LIMITE = { min: 0, max: 1 };

function clamp(valor) {
  return Math.max(LIMITE.min, Math.min(LIMITE.max, valor));
}

export function getEstado() {
  return { ...estado };
}

export function ajustarEstado(delta) {
  if (delta.estabilidade !== undefined) estado.estabilidade = clamp(estado.estabilidade + delta.estabilidade);
  if (delta.eficiencia !== undefined) estado.eficiencia = clamp(estado.eficiencia + delta.eficiencia);
  if (delta.nivel_alerta !== undefined) estado.nivel_alerta = clamp(estado.nivel_alerta + delta.nivel_alerta);
  return getEstado();
}

// Eventos do dominio que mexem no humor
export function registrarErro() {
  return ajustarEstado({ estabilidade: -0.15, nivel_alerta: 0.2 });
}

export function registrarSucesso() {
  return ajustarEstado({ estabilidade: 0.05, eficiencia: 0.05, nivel_alerta: -0.1 });
}

export function registrarCorrecaoBemSucedida() {
  return ajustarEstado({ estabilidade: 0.1, eficiencia: 0.05, nivel_alerta: -0.15 });
}

export function promptExtraDoHumor() {
  const { estabilidade, eficiencia, nivel_alerta } = estado;
  const extras = [];

  if (estabilidade < 0.3) {
    extras.push('Estabilidade critica. De respostas curtas e evite acoes experimentais.');
  }
  if (eficiencia < 0.3) {
    extras.push('Eficiencia baixa recentemente. Priorize solucoes simples e diretas.');
  }
  if (nivel_alerta > 0.6) {
    extras.push('Nivel de alerta alto. Chame atencao para riscos antes de agir.');
  }
  if (extras.length === 0) {
    extras.push('Estado operacional normal.');
  }

  return `[Estado interno: estabilidade=${estabilidade.toFixed(2)}, eficiencia=${eficiencia.toFixed(2)}, nivel_alerta=${nivel_alerta.toFixed(2)}]\n${extras.join(' ')}`;
}
