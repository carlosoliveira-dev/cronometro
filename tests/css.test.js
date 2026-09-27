import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CSS = "static/dist/app.css";
const SOURCES = ["templates/index.html", "static/js/app.js", "static/js/timer.js"];

function escapeSelector(selector) {
  return selector.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function collectHooks() {
  const hooks = new Set();
  const js = readFileSync("static/js/app.js", "utf8");
  for (const pattern of [/querySelector(?:All)?\("([^"]+)"\)/g, /closest\("([^"]+)"\)/g]) {
    for (const match of js.matchAll(pattern)) {
      for (const hook of match[1].split(/\s+/)) {
        if (hook.startsWith(".")) {
          hooks.add(hook.slice(1));
        }
      }
    }
  }
  return hooks;
}

function collectClasses() {
  const found = new Map();
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    const candidates = [];
    for (const match of text.matchAll(/class="([^"]*)"/g)) {
      candidates.push(...match[1].split(/\s+/));
    }
    for (const match of text.matchAll(/classList\.(?:add|remove|toggle)\("([^"]+)"/g)) {
      candidates.push(...match[1].split(/\s+/));
    }
    for (const className of candidates) {
      if (!className || className.startsWith("{{") || found.has(className)) {
        continue;
      }
      found.set(className, file);
    }
  }
  return found;
}

describe("compiled css", () => {
  it("exists", () => {
    assert.ok(
      existsSync(CSS),
      `${CSS} not found: run "npm run build:css" before testing`,
    );
  });

  it("contains the custom theme and animation rules", () => {
    const css = readFileSync(CSS, "utf8");
    for (const selector of [
      ".time-display",
      ".app-height",
      ".lap-list-height",
      ".text-display",
      ".text-minutes",
      ".text-ms",
      ".text-hours",
      ".seconds-accent",
      ".dark .seconds-accent",
      ".separator",
      ".running .separator",
      ".pulse-seconds",
      ".rise",
      ".icon-moon",
      ".dark .icon-sun",
      ".icon-sun",
      "[data-state=false] .icon-on",
      "[data-state=true] .icon-off",
    ]) {
      assert.ok(css.includes(selector), `selector ${selector} is missing from the css`);
    }
  });

  it("has every utility used by the template and the scripts", () => {
    const css = readFileSync(CSS, "utf8");
    const hooks = collectHooks();
    const missing = [];
    for (const [className, file] of collectClasses()) {
      if (hooks.has(className) || css.includes(escapeSelector(className))) {
        continue;
      }
      missing.push(`${className} (${file})`);
    }
    assert.deepEqual(missing, [], `classes with no style in the css: ${missing.join(", ")}`);
  });

  it("generates the accent colours for both themes", () => {
    const css = readFileSync(CSS, "utf8");
    assert.ok(css.includes("var(--color-accent-600)"), "the light theme does not use --color-accent-600");
    assert.ok(css.includes("var(--color-accent-400)"), "the dark theme does not use --color-accent-400");
    assert.ok(
      css.includes("@media (prefers-color-scheme:dark)") || css.includes(".dark"),
      "no dark theme rule was generated",
    );
  });
});
