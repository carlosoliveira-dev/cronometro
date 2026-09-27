const HORA_MS = 3600000;
const MINUTO_MS = 60000;
const SEGUNDO_MS = 1000;

export function criarCronometro(relogio) {
  const agora = relogio ?? (() => performance.now());
  let rodando = false;
  let acumulado = 0;
  let marca = 0;

  return {
    get rodando() {
      return rodando;
    },

    get decorridoMs() {
      return rodando ? acumulado + (agora() - marca) : acumulado;
    },

    iniciar() {
      if (rodando) {
        return this.decorridoMs;
      }
      marca = agora();
      rodando = true;
      return this.decorridoMs;
    },

    pausar() {
      if (!rodando) {
        return acumulado;
      }
      acumulado += agora() - marca;
      rodando = false;
      return acumulado;
    },

    alternar() {
      return rodando ? this.pausar() : this.iniciar();
    },

    zerar() {
      rodando = false;
      acumulado = 0;
      marca = 0;
    },

    restaurar(ms) {
      rodando = false;
      acumulado = Math.max(0, Math.floor(Number(ms) || 0));
      marca = 0;
    },
  };
}

export function partesDoTempo(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const horas = Math.floor(total / HORA_MS);
  return {
    horas,
    min: Math.floor(total / MINUTO_MS) % 60,
    s: Math.floor(total / SEGUNDO_MS) % 60,
    ms: total % 1000,
    temHoras: horas > 0,
  };
}

export function formatarTempo(ms) {
  const p = partesDoTempo(ms);
  const min = String(p.min).padStart(2, "0");
  const s = String(p.s).padStart(2, "0");
  const resto = String(p.ms).padStart(3, "0");
  return (p.temHoras ? `${p.horas}:` : "") + `${min}:${s}.${resto}`;
}

function digitos(valor, max) {
  if (typeof valor !== "string" || !/^\d+$/.test(valor) || valor.length > max) {
    return null;
  }
  return Number(valor);
}

export function parseTempo(texto) {
  if (typeof texto !== "string") {
    return null;
  }
  const grupos = texto.trim().replace(",", ".").split(":");
  if (grupos.length > 3) {
    return null;
  }
  const ultimo = grupos.pop();
  if (ultimo === "") {
    return null;
  }
  const comPonto = ultimo.split(".");
  if (comPonto.length > 2) {
    return null;
  }
  const segundos = digitos(comPonto[0], 2);
  if (segundos === null) {
    return null;
  }
  const temMilissegundos = comPonto.length === 2;
  const textoMs = temMilissegundos ? comPonto[1] : null;
  const milissegundos = temMilissegundos ? digitos(textoMs, 3) : 0;
  if (milissegundos === null) {
    return null;
  }
  const temMinutos = grupos.length >= 1;
  const minutos = temMinutos ? digitos(grupos.pop(), 2) : 0;
  if (minutos === null) {
    return null;
  }
  const temHoras = grupos.length >= 1;
  const horas = temHoras ? digitos(grupos.pop(), 3) : 0;
  if (horas === null) {
    return null;
  }
  const fator = temMilissegundos ? Math.pow(10, 3 - textoMs.length) : 1;
  return ((horas * 60 + minutos) * 60 + segundos) * SEGUNDO_MS + milissegundos * fator;
}

export function totalDasVoltas(voltas) {
  return voltas.reduce((soma, volta) => soma + volta.splitMs, 0);
}

export function recomputar(voltas) {
  const totais = new Array(voltas.length);
  let acumulado = 0;
  for (let i = voltas.length - 1; i >= 0; i--) {
    acumulado += voltas[i].splitMs;
    totais[i] = acumulado;
  }
  return voltas.map((volta, i) => ({ ...volta, totalMs: totais[i] }));
}

export function adicionarVolta(voltas, totalMs, id, maximo) {
  const splitMs = Math.max(0, Math.floor(Number(totalMs) || 0) - totalDasVoltas(voltas));
  const proximas = [{ id, splitMs }, ...voltas];
  if (Number.isFinite(maximo) && maximo > 0 && proximas.length > maximo) {
    proximas.length = maximo;
  }
  return recomputar(proximas);
}

export function editarSplit(voltas, id, novoSplitMs) {
  const indice = voltas.findIndex((volta) => volta.id === id);
  if (indice < 0) {
    return { erro: "Volta não encontrada." };
  }
  const valor = Math.floor(Number(novoSplitMs));
  if (!Number.isFinite(valor) || valor < 0) {
    return { erro: "Informe um tempo válido." };
  }

  const novas = voltas.map((volta) => ({ ...volta }));
  novas[indice].splitMs = valor;
  if (indice === 0) {
    return { voltas: recomputar(novas) };
  }

  const posteriores = [];
  for (let i = indice - 1; i >= 0; i--) {
    posteriores.push(i);
  }
  const anteriores = [];
  for (let i = indice + 1; i < novas.length; i++) {
    anteriores.push(i);
  }

  let aRemover = valor - voltas[indice].splitMs;
  let aRepor = -aRemover;
  for (const i of [...posteriores, ...anteriores]) {
    if (aRemover > 0) {
      const retirado = Math.min(novas[i].splitMs, aRemover);
      novas[i].splitMs -= retirado;
      aRemover -= retirado;
    } else if (aRepor > 0) {
      novas[i].splitMs += aRepor;
      aRepor = 0;
    }
  }
  if (aRemover > 0) {
    novas[indice].splitMs -= aRemover;
  }

  return { voltas: recomputar(novas) };
}

export function apagarVolta(voltas, id) {
  return recomputar(voltas.filter((volta) => volta.id !== id));
}

export function melhorEPior(voltas) {
  if (voltas.length < 2) {
    return { melhorId: null, piorId: null };
  }
  let melhor = voltas[0];
  let pior = voltas[0];
  for (const volta of voltas) {
    if (volta.splitMs < melhor.splitMs) {
      melhor = volta;
    }
    if (volta.splitMs > pior.splitMs) {
      pior = volta;
    }
  }
  if (melhor.splitMs === pior.splitMs) {
    return { melhorId: null, piorId: null };
  }
  return { melhorId: melhor.id, piorId: pior.id };
}
