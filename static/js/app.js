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
} from "./timer.js";

const CHAVE = "cronometro:v1";
const LIMITE_RENDER = 200;
const INTERVALO_SALVAMENTO = 10000;

const el = (id) => document.getElementById(id);

const corpo = document.body;
const raiz = document.documentElement;
const maxLaps = Number(corpo.dataset.maxLaps) || 5000;

const cronometro = criarCronometro();
let voltas = [];
let idEditando = null;
let contador = 0;
let agendado = false;
let ultimoSalvo = 0;
let avisoTimeout = 0;

const preferencias = {
  som: true,
  vibrar: true,
  wake: false,
};

const tempoHoras = el("tempo-h");
const tempoHorasSep = el("tempo-h-sep");
const tempoMin = el("tempo-min");
const tempoSeg = el("tempo-sec");
const tempoMs = el("tempo-ms");
const situacao = el("situacao");
const lista = el("lista-voltas");
const listaVazia = el("lista-vazia");
const modeloVolta = el("modelo-volta");
const avisoRolagem = el("aviso-rolagem");
const resumoVoltas = el("resumo-voltas");
const resumoMelhor = el("resumo-melhor");
const resumoPior = el("resumo-pior");
const btnIniciar = el("btn-iniciar");
const btnZerar = el("btn-zerar");
const btnVolta = el("btn-volta");
const btnTema = el("btn-tema");
const btnSom = el("btn-som");
const btnVibrar = el("btn-vibrar");
const btnWake = el("btn-wake");
const dlg = el("dlg-editar");
const formEditar = el("form-editar");
const campoTempo = el("campo-tempo");
const erroCampo = el("erro-campo");
const dlgNumero = el("dlg-numero");
const aviso = el("aviso");

const dois = (n) => String(n).padStart(2, "0");
const tres = (n) => String(n).padStart(3, "0");

const cache = { horas: null, min: null, s: null, ms: null };

function desenharTempo() {
  const p = partesDoTempo(cronometro.decorridoMs);

  if (p.horas !== cache.horas) {
    cache.horas = p.horas;
    tempoHoras.textContent = String(p.horas);
    tempoHoras.classList.toggle("hidden", !p.temHoras);
    tempoHorasSep.classList.toggle("hidden", !p.temHoras);
  }
  if (p.min !== cache.min) {
    cache.min = p.min;
    tempoMin.textContent = dois(p.min);
  }
  if (p.s !== cache.s) {
    cache.s = p.s;
    tempoSeg.textContent = dois(p.s);
    if (p.s > 0 || p.min > 0 || p.horas > 0) {
      tempoSeg.classList.remove("pulso-segundos");
      void tempoSeg.offsetWidth;
      tempoSeg.classList.add("pulso-segundos");
    }
  }
  if (p.ms !== cache.ms) {
    cache.ms = p.ms;
    tempoMs.textContent = tres(p.ms);
  }
}

function atualizarControles() {
  const decorrido = cronometro.decorridoMs;
  const rodando = cronometro.rodando;
  const temTempo = decorrido > 0;

  btnIniciar.textContent = rodando ? "Parar" : temTempo ? "Retomar" : "Iniciar";
  btnIniciar.setAttribute("aria-label", rodando ? "Parar o cronômetro" : "Iniciar o cronômetro");
  btnVolta.disabled = !rodando;
  btnZerar.disabled = !temTempo && voltas.length === 0;
  corpo.classList.toggle("rodando", rodando);

  if (rodando) {
    situacao.textContent = "Cronometrando";
  } else if (temTempo) {
    situacao.textContent = "Pausado";
  } else {
    situacao.textContent = voltas.length > 0 ? `Pronto · ${voltas.length} volta${voltas.length > 1 ? "s" : ""}` : "Pronto para iniciar";
  }
}

function agendar() {
  if (agendado) {
    return;
  }
  agendado = true;
  requestAnimationFrame(tique);
}

function tique() {
  agendado = false;
  desenharTempo();
  if (cronometro.rodando) {
    if (Date.now() - ultimoSalvo > INTERVALO_SALVAMENTO) {
      salvar();
    }
    agendar();
  }
}

function renderizarLista() {
  const { melhorId, piorId } = melhorEPior(voltas);
  const fragmento = document.createDocumentFragment();
  const visiveis = voltas.slice(0, LIMITE_RENDER);

  visiveis.forEach((volta, indice) => {
    const item = modeloVolta.content.firstElementChild.cloneNode(true);
    const p = partesDoTempo(volta.splitMs);
    item.dataset.id = String(volta.id);
    item.firstElementChild.textContent = `#${voltas.length - indice}`;
    item.querySelector(".split-min").textContent = dois(p.min);
    item.querySelector(".split-sec").textContent = dois(p.s);
    item.querySelector(".split-ms").textContent = tres(p.ms);
    item.querySelector(".total").textContent = `acumulado ${formatarTempo(volta.totalMs)}`;
    item.querySelector(".selo-melhor").classList.toggle("hidden", volta.id !== melhorId);
    item.querySelector(".selo-pior").classList.toggle("hidden", volta.id !== piorId);
    item.querySelector(".btn-editar").setAttribute("aria-label", `Editar volta ${voltas.length - indice}`);
    item.querySelector(".btn-apagar").setAttribute("aria-label", `Apagar volta ${voltas.length - indice}`);
    if (indice === 0) {
      item.classList.add("surgir");
    }
    fragmento.append(item);
  });

  lista.replaceChildren(fragmento);
  lista.classList.toggle("hidden", voltas.length === 0);
  listaVazia.classList.toggle("hidden", voltas.length > 0);

  const truncada = voltas.length > visiveis.length;
  avisoRolagem.classList.toggle("hidden", !truncada);
  if (truncada) {
    avisoRolagem.textContent = `mostrando as ${visiveis.length} mais recentes de ${voltas.length}`;
  }

  const melhor = melhorId === null ? null : voltas.find((v) => v.id === melhorId);
  const pior = piorId === null ? null : voltas.find((v) => v.id === piorId);
  resumoVoltas.textContent = String(voltas.length);
  resumoMelhor.textContent = melhor ? formatarTempo(melhor.splitMs) : "—";
  resumoPior.textContent = pior ? formatarTempo(pior.splitMs) : "—";
}

function avisar(texto) {
  aviso.textContent = texto;
  aviso.classList.add("opacity-100");
  clearTimeout(avisoTimeout);
  avisoTimeout = setTimeout(() => aviso.classList.remove("opacity-100"), 2000);
}

let contextoAudio = null;

function bip(frequencia) {
  if (!preferencias.som) {
    return;
  }
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) {
      return;
    }
    contextoAudio ??= new Contexto();
    if (contextoAudio.state === "suspended") {
      void contextoAudio.resume();
    }
    const agora = contextoAudio.currentTime;
    const oscilador = contextoAudio.createOscillator();
    const ganho = contextoAudio.createGain();
    oscilador.type = "sine";
    oscilador.frequency.setValueAtTime(frequencia, agora);
    ganho.gain.setValueAtTime(0.0001, agora);
    ganho.gain.exponentialRampToValueAtTime(0.22, agora + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + 0.18);
    oscilador.connect(ganho).connect(contextoAudio.destination);
    oscilador.start(agora);
    oscilador.stop(agora + 0.2);
  } catch {
    preferencias.som = false;
    atualizarBotaoAlternador(btnSom, false);
  }
}

function vibrar() {
  if (preferencias.vibrar && typeof navigator.vibrate === "function") {
    navigator.vibrate([18, 40, 18]);
  }
}

function salvar() {
  ultimoSalvo = Date.now();
  try {
    localStorage.setItem(
      CHAVE,
      JSON.stringify({
        voltas: voltas.map((volta) => ({ id: volta.id, splitMs: Math.round(volta.splitMs) })),
        decorridoMs: Math.round(cronometro.decorridoMs),
        preferencias: { ...preferencias, tema: raiz.classList.contains("dark") ? "escuro" : "claro" },
      }),
    );
  } catch {
    avisar("Não foi possível salvar neste navegador");
  }
}

function carregar() {
  let dados = null;
  try {
    const bruto = localStorage.getItem(CHAVE);
    dados = bruto ? JSON.parse(bruto) : null;
  } catch {
    dados = null;
  }
  if (!dados || typeof dados !== "object") {
    return false;
  }
  if (Array.isArray(dados.voltas)) {
    voltas = recomputar(
      dados.voltas
        .filter((volta) => volta && Number.isFinite(Number(volta.splitMs)))
        .slice(0, maxLaps)
        .map((volta) => ({ id: volta.id, splitMs: Math.max(0, Math.floor(Number(volta.splitMs))) })),
    );
  }
  if (dados.decorridoMs > 0) {
    cronometro.restaurar(dados.decorridoMs);
  }
  const prefs = dados.preferencias;
  if (prefs && typeof prefs === "object") {
    if (typeof prefs.som === "boolean") {
      preferencias.som = prefs.som;
    }
    if (typeof prefs.vibrar === "boolean") {
      preferencias.vibrar = prefs.vibrar;
    }
    if (typeof prefs.wake === "boolean") {
      preferencias.wake = prefs.wake;
    }
  }
  return voltas.length > 0 || dados.decorridoMs > 0;
}

function novoId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  contador += 1;
  return `volta-${Date.now().toString(36)}-${contador}`;
}

function alternarCronometro() {
  const rodando = cronometro.rodando;
  cronometro.alternar();
  atualizarControles();
  desenharTempo();
  agendar();
  bip(rodando ? 520 : 780);
  if (!rodando) {
    vibrar();
  }
  salvar();
}

function registrarVolta() {
  if (!cronometro.rodando || cronometro.decorridoMs <= 0) {
    return;
  }
  voltas = adicionarVolta(voltas, cronometro.decorridoMs, novoId(), maxLaps);
  renderizarLista();
  lista.scrollTop = 0;
  atualizarControles();
  bip(880);
  vibrar();
  salvar();
}

function zerarTudo() {
  cronometro.zerar();
  voltas = [];
  cache.horas = null;
  renderizarLista();
  atualizarControles();
  desenharTempo();
  bip(440);
  salvar();
  avisar("Cronômetro zerado");
}

function apagar(id) {
  const antes = voltas.length;
  voltas = apagarVolta(voltas, id);
  if (voltas.length === antes) {
    return;
  }
  renderizarLista();
  atualizarControles();
  salvar();
  avisar("Volta apagada");
}

function numeroDaVolta(id) {
  const indice = voltas.findIndex((volta) => String(volta.id) === String(id));
  return indice < 0 ? "?" : voltas.length - indice;
}

function abrirEdicao(id) {
  const volta = voltas.find((v) => String(v.id) === String(id));
  if (!volta) {
    return;
  }
  idEditando = volta.id;
  dlgNumero.textContent = `#${numeroDaVolta(volta.id)}`;
  campoTempo.value = formatarTempo(volta.splitMs);
  erroCampo.classList.add("hidden");
  dlg.showModal();
  campoTempo.focus();
  campoTempo.select();
}

formEditar.addEventListener("submit", (evento) => {
  const milissegundos = parseTempo(campoTempo.value);
  const resultado = milissegundos === null ? { erro: "Use mm:ss.mmm, por exemplo 01:23.456" } : editarSplit(voltas, idEditando, milissegundos);
  if (resultado.erro) {
    evento.preventDefault();
    erroCampo.textContent = resultado.erro;
    erroCampo.classList.remove("hidden");
    return;
  }
  voltas = resultado.voltas;
  salvar();
  renderizarLista();
  avisar("Volta atualizada");
});

dlg.addEventListener("close", () => {
  idEditando = null;
});

el("btn-cancelar-edicao").addEventListener("click", () => dlg.close());

campoTempo.addEventListener("input", () => erroCampo.classList.add("hidden"));

function atualizarBotaoAlternador(botao, ligado) {
  botao.dataset.estado = String(ligado);
  botao.setAttribute("aria-pressed", String(ligado));
}

function definirTema(escuro) {
  raiz.classList.toggle("dark", escuro);
  salvar();
}

btnTema.addEventListener("click", () => {
  const escuro = !raiz.classList.contains("dark");
  definirTema(escuro);
  avisar(escuro ? "Tema escuro" : "Tema claro");
});

btnSom.addEventListener("click", () => {
  preferencias.som = !preferencias.som;
  atualizarBotaoAlternador(btnSom, preferencias.som);
  salvar();
  if (preferencias.som) {
    bip(880);
  }
});

btnVibrar.addEventListener("click", () => {
  preferencias.vibrar = !preferencias.vibrar;
  atualizarBotaoAlternador(btnVibrar, preferencias.vibrar);
  salvar();
  if (preferencias.vibrar) {
    vibrar();
  }
});

let wakeLock = null;

async function sincronizarWakeLock(ligar) {
  if (!("wakeLock" in navigator)) {
    return;
  }
  if (ligar) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        atualizarBotaoAlternador(btnWake, false);
        if (preferencias.wake) {
          avisar("A tela pode apagar normalmente");
        }
      });
      atualizarBotaoAlternador(btnWake, true);
    } catch {
      preferencias.wake = false;
      atualizarBotaoAlternador(btnWake, false);
      avisar("Não foi possível manter a tela ligada");
    }
  } else if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    atualizarBotaoAlternador(btnWake, false);
  }
}

if (!("wakeLock" in navigator)) {
  btnWake.classList.add("hidden");
} else {
  btnWake.addEventListener("click", () => {
    preferencias.wake = !preferencias.wake;
    atualizarBotaoAlternador(btnWake, preferencias.wake);
    salvar();
    void sincronizarWakeLock(preferencias.wake);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    agendar();
    if (preferencias.wake && !wakeLock) {
      void sincronizarWakeLock(true);
    }
  } else {
    salvar();
  }
});

window.addEventListener("pagehide", salvar);

btnIniciar.addEventListener("click", alternarCronometro);
btnVolta.addEventListener("click", registrarVolta);
btnZerar.addEventListener("click", zerarTudo);

lista.addEventListener("click", (evento) => {
  const item = evento.target.closest("li[data-id]");
  if (!item) {
    return;
  }
  if (evento.target.closest(".btn-editar")) {
    abrirEdicao(item.dataset.id);
  } else if (evento.target.closest(".btn-apagar")) {
    apagar(item.dataset.id);
  }
});

document.addEventListener("keydown", (evento) => {
  if (evento.defaultPrevented || evento.metaKey || evento.ctrlKey || evento.altKey) {
    return;
  }
  if (dlg.open) {
    return;
  }
  if (evento.target instanceof Element && evento.target.closest("button, input, textarea, select, a")) {
    return;
  }
  const tecla = evento.key.toLowerCase();
  if (evento.code === "Space" || tecla === "enter") {
    evento.preventDefault();
    alternarCronometro();
  } else if (tecla === "l") {
    registrarVolta();
  } else if (tecla === "r") {
    zerarTudo();
  }
});

const restaurado = carregar();
atualizarBotaoAlternador(btnSom, preferencias.som);
atualizarBotaoAlternador(btnVibrar, preferencias.vibrar);
atualizarBotaoAlternador(btnWake, preferencias.wake);
renderizarLista();
atualizarControles();
desenharTempo();
if (restaurado) {
  avisar("Sessão anterior restaurada");
}
if (preferencias.wake) {
  void sincronizarWakeLock(true);
}
