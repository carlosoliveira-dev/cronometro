import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CSS = "static/dist/app.css";
const FONTES = ["templates/index.html", "static/js/app.js", "static/js/timer.js"];

function escapar(seletor) {
  return seletor.replace(/[^a-zA-Z0-9_-]/g, (caractere) => `\\${caractere}`);
}

function coletarHooks() {
  const hooks = new Set();
  const js = readFileSync("static/js/app.js", "utf8");
  for (const padrao of [/querySelector(?:All)?\("([^"]+)"\)/g, /closest\("([^"]+)"\)/g]) {
    for (const achado of js.matchAll(padrao)) {
      for (const hook of achado[1].split(/\s+/)) {
        if (hook.startsWith(".")) {
          hooks.add(hook.slice(1));
        }
      }
    }
  }
  return hooks;
}

function coletarClasses() {
  const encontradas = new Map();
  for (const arquivo of FONTES) {
    const texto = readFileSync(arquivo, "utf8");
    const candidatas = [];
    for (const achado of texto.matchAll(/class="([^"]*)"/g)) {
      candidatas.push(...achado[1].split(/\s+/));
    }
    for (const achado of texto.matchAll(/classList\.(?:add|remove|toggle)\("([^"]+)"/g)) {
      candidatas.push(...achado[1].split(/\s+/));
    }
    for (const classe of candidatas) {
      if (!classe || classe.startsWith("{{") || encontradas.has(classe)) {
        continue;
      }
      encontradas.set(classe, arquivo);
    }
  }
  return encontradas;
}

describe("css compilado", () => {
  it("existe", () => {
    assert.ok(
      existsSync(CSS),
      `${CSS} nao encontrado: rode "npm run build:css" antes de testar`,
    );
  });

  it("contem as classes proprias do tema e das animacoes", () => {
    const css = readFileSync(CSS, "utf8");
    for (const seletor of [
      ".tempo-display",
      ".altura-app",
      ".altura-lista",
      ".text-display",
      ".text-minutos",
      ".text-milis",
      ".text-horas",
      ".acento-segundos",
      ".dark .acento-segundos",
      ".separador",
      ".rodando .separador",
      ".pulso-segundos",
      ".surgir",
      ".so-lua",
      ".dark .so-sol",
      ".so-sol",
      "[data-estado=false] .so-on",
      "[data-estado=true] .so-off",
    ]) {
      assert.ok(css.includes(seletor), `seletor ${seletor} ausente do css`);
    }
  });

  it("tem todos os utilitarios usados no template e nos scripts", () => {
    const css = readFileSync(CSS, "utf8");
    const hooks = coletarHooks();
    const faltando = [];
    for (const [classe, arquivo] of coletarClasses()) {
      if (hooks.has(classe) || css.includes(escapar(classe))) {
        continue;
      }
      faltando.push(`${classe} (${arquivo})`);
    }
    assert.deepEqual(faltando, [], `classes sem estilo no css: ${faltando.join(", ")}`);
  });

  it("gera as cores de acento dos dois temas", () => {
    const css = readFileSync(CSS, "utf8");
    assert.ok(css.includes("var(--color-accent-600)"), "o tema claro nao usa --color-accent-600");
    assert.ok(css.includes("var(--color-accent-400)"), "o tema escuro nao usa --color-accent-400");
    assert.ok(
      css.includes("@media (prefers-color-scheme:dark)") || css.includes(".dark"),
      "nenhuma regra de tema escuro foi gerada",
    );
  });
});
