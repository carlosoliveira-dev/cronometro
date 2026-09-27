import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adicionarVolta,
  apagarVolta,
  criarCronometro,
  editarSplit,
  formatarTempo,
  melhorEPior,
  parseTempo,
  partesDoTempo,
  recomputar,
  totalDasVoltas,
} from "../static/js/timer.js";

function relogioFalso(inicio = 1000) {
  let t = inicio;
  return {
    agora: () => t,
    avancar(ms) {
      t += ms;
    },
  };
}

describe("criarCronometro", () => {
  it("soma os intervalos sem perder fração de milissegundo", () => {
    const rel = relogioFalso();
    const c = criarCronometro(rel.agora);

    c.iniciar();
    rel.avancar(1234.5678);
    c.pausar();
    assert.equal(Math.floor(c.decorridoMs), 1234);

    c.iniciar();
    rel.avancar(765.4322);
    assert.equal(Math.floor(c.decorridoMs), 2000);
  });

  it("ignora iniciar repetido e pausa sem rodar", () => {
    const rel = relogioFalso();
    const c = criarCronometro(rel.agora);

    c.iniciar();
    rel.avancar(500);
    c.iniciar();
    rel.avancar(500);
    assert.equal(Math.floor(c.decorridoMs), 1000);

    c.pausar();
    rel.avancar(5000);
    assert.equal(Math.floor(c.decorridoMs), 1000);
    assert.equal(c.rodando, false);
  });

  it("zera e restaura", () => {
    const rel = relogioFalso();
    const c = criarCronometro(rel.agora);

    c.iniciar();
    rel.avancar(3000);
    assert.equal(c.rodando, true);
    c.zerar();
    assert.equal(c.decorridoMs, 0);
    assert.equal(c.rodando, false);

    c.restaurar(4271.9);
    assert.equal(c.decorridoMs, 4271);
    assert.equal(c.rodando, false);
  });

  it("alternar alterna o estado", () => {
    const rel = relogioFalso();
    const c = criarCronometro(rel.agora);

    c.alternar();
    rel.avancar(250);
    c.alternar();
    rel.avancar(9999);
    assert.equal(Math.floor(c.decorridoMs), 250);
  });
});

describe("formatarTempo", () => {
  it("usa dois digitos nos minutos e segundos e tres nos milissegundos", () => {
    assert.equal(formatarTempo(0), "00:00.000");
    assert.equal(formatarTempo(7), "00:00.007");
    assert.equal(formatarTempo(999), "00:00.999");
    assert.equal(formatarTempo(1000), "00:01.000");
    assert.equal(formatarTempo(61001), "01:01.001");
    assert.equal(formatarTempo(600000), "10:00.000");
    assert.equal(formatarTempo(3599999), "59:59.999");
  });

  it("acrescenta as horas quando passar de uma hora", () => {
    assert.equal(formatarTempo(3600000), "1:00:00.000");
    assert.equal(formatarTempo(3600000 + 61001), "1:01:01.001");
    assert.equal(formatarTempo(3600000 * 2 + 1000), "2:00:01.000");
    assert.equal(formatarTempo(3600000 * 20 + 1000), "20:00:01.000");
  });

  it("trunca e nunca fica negativo", () => {
    assert.equal(formatarTempo(1999.9), "00:01.999");
    assert.equal(formatarTempo(-50), "00:00.000");
    assert.equal(formatarTempo(Number.NaN), "00:00.000");
  });
});

describe("partesDoTempo", () => {
  it("quebra o total nos grupos usados no display", () => {
    assert.deepEqual(partesDoTempo(3723004), { horas: 1, min: 2, s: 3, ms: 4, temHoras: true });
    assert.deepEqual(partesDoTempo(63456), { horas: 0, min: 1, s: 3, ms: 456, temHoras: false });
  });
});

describe("parseTempo", () => {
  it("aceita as formas com e sem minutos", () => {
    assert.equal(parseTempo("01:23.456"), 83456);
    assert.equal(parseTempo("1:23.456"), 83456);
    assert.equal(parseTempo("23.456"), 23456);
    assert.equal(parseTempo("1:2.3"), 62300);
    assert.equal(parseTempo("1:2"), 62000);
    assert.equal(parseTempo("12"), 12000);
    assert.equal(parseTempo("01:23,456"), 83456);
    assert.equal(parseTempo("  05:00.000  "), 300000);
    assert.equal(parseTempo("0:00.001"), 1);
    assert.equal(parseTempo("1:02:03.000"), 3723000);
  });

  it("rejeita entradas invalidas", () => {
    for (const invalido of ["", " ", "abc", "1:2:3:4", "1..2", "-1", "1:-2", "12.34.56", "1:2.", "007:00.0", "1:2:3:4:5", null, undefined, 42]) {
      assert.equal(parseTempo(invalido), null, `esperava null para ${JSON.stringify(invalido)}`);
    }
  });

  it("formata o que le de volta sem perda", () => {
    for (const texto of ["00:00.000", "01:23.456", "59:59.999", "1:00:00.000"]) {
      assert.equal(formatarTempo(parseTempo(texto)), texto);
    }
  });
});

describe("voltas", () => {
  it("calcula o split a partir do total e ordena da mais recente para a mais antiga", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 22500, "b", 100);
    voltas = adicionarVolta(voltas, 31000, "c", 100);

    assert.deepEqual(
      voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 8500, 31000],
        ["b", 12500, 22500],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(totalDasVoltas(voltas), 31000);
  });

  it("respeita o limite,maximo descartando as mais antigas", () => {
    let voltas = [];
    for (const total of [1000, 2000, 3000, 4000]) {
      voltas = adicionarVolta(voltas, total, `v${total}`, 3);
    }
    assert.deepEqual(
      voltas.map((v) => v.id),
      ["v4000", "v3000", "v2000"],
    );
    assert.equal(voltas[0].splitMs, 1000);
  });

  it("recalcula os totais ao editar um split no meio da lista", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    const resultado = editarSplit(voltas, "b", 15000);
    assert.equal(resultado.erro, undefined);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 5000, 30000],
        ["b", 15000, 25000],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(totalDasVoltas(resultado.voltas), 30000);
  });

  it("pede emprestado as voltas seguintes quando o delta e grande demais", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    const resultado = editarSplit(voltas, "a", 14000);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 30000],
        ["b", 6000, 20000],
        ["a", 14000, 14000],
      ],
    );
    assert.equal(totalDasVoltas(resultado.voltas), 30000);
  });

  it("reduz o valor editado quando nao ha split seguinte suficiente", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    const resultado = editarSplit(voltas, "a", 25000);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 5000, 30000],
        ["b", 0, 25000],
        ["a", 25000, 25000],
      ],
    );
    assert.equal(totalDasVoltas(resultado.voltas), 30000);
    assert.ok(resultado.voltas.every((v) => v.splitMs >= 0));
  });

  it("mantem o total ao editar a volta mais antiga, absorvendo pelas anteriores", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    const resultado = editarSplit(voltas, "a", 5000);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 30000],
        ["b", 15000, 20000],
        ["a", 5000, 5000],
      ],
    );
    assert.equal(totalDasVoltas(resultado.voltas), 30000);
  });

  it("nunca deixa split negativo quando nao ha nada para absorver", () => {
    const voltas = [
      { id: "c", splitMs: 0, totalMs: 0 },
      { id: "a", splitMs: 0, totalMs: 0 },
      { id: "b", splitMs: 0, totalMs: 0 },
    ];

    const resultado = editarSplit(voltas, "a", 5000);
    assert.deepEqual(
      resultado.voltas.map((v) => v.splitMs),
      [0, 0, 0],
    );
  });

  it("distribui para as seguintes quando o split editado diminui", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    const resultado = editarSplit(voltas, "b", 5000);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 15000, 30000],
        ["b", 5000, 15000],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(totalDasVoltas(resultado.voltas), 30000);
  });

  it("editar a ultima volta nao afeta ninguem", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);

    const resultado = editarSplit(voltas, "b", 5000);
    assert.deepEqual(
      resultado.voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["b", 5000, 15000],
        ["a", 10000, 10000],
      ],
    );
  });

  it("recusa editar com valor negativo ou id inexistente", () => {
    const voltas = adicionarVolta([], 10000, "a", 100);
    assert.equal(editarSplit(voltas, "a", -1).erro, "Informe um tempo válido.");
    assert.equal(editarSplit(voltas, "a", Number.NaN).erro, "Informe um tempo válido.");
    assert.equal(editarSplit(voltas, "zzz", 100).erro, "Volta não encontrada.");
  });

  it("apagar recalcula os totais e nao desloca os demais", () => {
    let voltas = [];
    voltas = adicionarVolta(voltas, 10000, "a", 100);
    voltas = adicionarVolta(voltas, 20000, "b", 100);
    voltas = adicionarVolta(voltas, 30000, "c", 100);

    voltas = apagarVolta(voltas, "b");
    assert.deepEqual(
      voltas.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 20000],
        ["a", 10000, 10000],
      ],
    );
  });

  it("recomputar nao altera as entradas originais", () => {
    const original = [{ id: "a", splitMs: 1000 }];
    const recalculado = recomputar(original);
    assert.equal(original[0].totalMs, undefined);
    assert.equal(recalculado[0].totalMs, 1000);
  });
});

describe("melhorEPior", () => {
  it("ignora quando todas as voltas sao iguais", () => {
    const voltas = [{ id: "a", splitMs: 5000 }, { id: "b", splitMs: 5000 }];
    assert.deepEqual(melhorEPior(voltas), { melhorId: null, piorId: null });
  });

  it("precisa de pelo menos duas voltas", () => {
    assert.deepEqual(melhorEPior([{ id: "a", splitMs: 100 }]), { melhorId: null, piorId: null });
  });

  it("aponta a volta mais rapida e a mais lenta", () => {
    const voltas = [
      { id: "a", splitMs: 12000 },
      { id: "b", splitMs: 9000 },
      { id: "c", splitMs: 15000 },
    ];
    assert.deepEqual(melhorEPior(voltas), { melhorId: "b", piorId: "c" });
  });
});
