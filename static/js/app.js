import {
  addLap,
  removeLap,
  createStopwatch,
  editSplit,
  formatTime,
  bestAndWorst,
  parseTime,
  timeParts,
  recompute,
} from "./timer.js";

const STORAGE_KEY = "stopwatch:v1";
const RENDER_LIMIT = 200;
const SAVE_INTERVAL = 10000;

const el = (id) => document.getElementById(id);

const body = document.body;
const root = document.documentElement;
const maxLaps = Number(body.dataset.maxLaps) || 5000;

const stopwatch = createStopwatch();
let laps = [];
let editingId = null;
let counter = 0;
let scheduled = false;
let lastSaved = 0;
let toastTimeout = 0;

const preferences = {
  sound: true,
  vibrate: true,
  wake: false,
};

const timeHours = el("time-h");
const timeHoursSep = el("time-h-sep");
const timeMin = el("time-min");
const timeSec = el("time-sec");
const timeMs = el("time-ms");
const status = el("status");
const lapList = el("lap-list");
const emptyState = el("empty-state");
const lapTemplate = el("lap-template");
const scrollNotice = el("scroll-notice");
const summaryLaps = el("summary-laps");
const summaryBest = el("summary-best");
const summaryWorst = el("summary-worst");
const btnStart = el("btn-start");
const btnReset = el("btn-reset");
const btnLap = el("btn-lap");
const btnTheme = el("btn-theme");
const btnSound = el("btn-sound");
const btnVibrate = el("btn-vibrate");
const btnWake = el("btn-wake");
const dlg = el("dlg-edit");
const editForm = el("form-edit");
const timeInput = el("time-input");
const fieldError = el("field-error");
const dlgNumber = el("dlg-number");
const toast = el("toast");

const dois = (n) => String(n).padStart(2, "0");
const tres = (n) => String(n).padStart(3, "0");

const cache = { hours: null, min: null, s: null, ms: null };

function renderTime() {
  const p = timeParts(stopwatch.elapsedMs);

  if (p.hours !== cache.hours) {
    cache.hours = p.hours;
    timeHours.textContent = String(p.hours);
    timeHours.classList.toggle("hidden", !p.hasHours);
    timeHoursSep.classList.toggle("hidden", !p.hasHours);
  }
  if (p.min !== cache.min) {
    cache.min = p.min;
    timeMin.textContent = dois(p.min);
  }
  if (p.s !== cache.s) {
    cache.s = p.s;
    timeSec.textContent = dois(p.s);
    if (p.s > 0 || p.min > 0 || p.hours > 0) {
      timeSec.classList.remove("pulse-seconds");
      void timeSec.offsetWidth;
      timeSec.classList.add("pulse-seconds");
    }
  }
  if (p.ms !== cache.ms) {
    cache.ms = p.ms;
    timeMs.textContent = tres(p.ms);
  }
}

function updateControls() {
  const elapsed = stopwatch.elapsedMs;
  const running = stopwatch.running;
  const hasTime = elapsed > 0;

  btnStart.textContent = running ? "Stop" : hasTime ? "Resume" : "Start";
  btnStart.setAttribute("aria-label", running ? "Stop the stopwatch" : "Start the stopwatch");
  btnLap.disabled = !running;
  btnReset.disabled = !hasTime && laps.length === 0;
  body.classList.toggle("running", running);

  if (running) {
    status.textContent = "Running";
  } else if (hasTime) {
    status.textContent = "Paused";
  } else {
    status.textContent = laps.length > 0 ? `Ready · ${laps.length} lap${laps.length > 1 ? "s" : ""}` : "Ready to start";
  }
}

function schedule() {
  if (scheduled) {
    return;
  }
  scheduled = true;
  requestAnimationFrame(tick);
}

function tick() {
  scheduled = false;
  renderTime();
  if (stopwatch.running) {
    if (Date.now() - lastSaved > SAVE_INTERVAL) {
      save();
    }
    schedule();
  }
}

function renderLaps() {
  const { bestId, worstId } = bestAndWorst(laps);
  const fragment = document.createDocumentFragment();
  const visible = laps.slice(0, RENDER_LIMIT);

  visible.forEach((lap, index) => {
    const item = lapTemplate.content.firstElementChild.cloneNode(true);
    const p = timeParts(lap.splitMs);
    item.dataset.id = String(lap.id);
    item.firstElementChild.textContent = `#${laps.length - index}`;
    item.querySelector(".split-min").textContent = dois(p.min);
    item.querySelector(".split-sec").textContent = dois(p.s);
    item.querySelector(".split-ms").textContent = tres(p.ms);
    item.querySelector(".total").textContent = `total ${formatTime(lap.totalMs)}`;
    item.querySelector(".badge-best").classList.toggle("hidden", lap.id !== bestId);
    item.querySelector(".badge-worst").classList.toggle("hidden", lap.id !== worstId);
    item.querySelector(".btn-edit").setAttribute("aria-label", `Edit lap ${laps.length - index}`);
    item.querySelector(".btn-delete").setAttribute("aria-label", `Delete lap ${laps.length - index}`);
    if (index === 0) {
      item.classList.add("rise");
    }
    fragment.append(item);
  });

  lapList.replaceChildren(fragment);
  lapList.classList.toggle("hidden", laps.length === 0);
  emptyState.classList.toggle("hidden", laps.length > 0);

  const truncated = laps.length > visible.length;
  scrollNotice.classList.toggle("hidden", !truncated);
  if (truncated) {
    scrollNotice.textContent = `showing the ${visible.length} most recent of ${laps.length}`;
  }

  const best = bestId === null ? null : laps.find((v) => v.id === bestId);
  const worst = worstId === null ? null : laps.find((v) => v.id === worstId);
  summaryLaps.textContent = String(laps.length);
  summaryBest.textContent = best ? formatTime(best.splitMs) : "—";
  summaryWorst.textContent = worst ? formatTime(worst.splitMs) : "—";
}

function notify(text) {
  toast.textContent = text;
  toast.classList.add("opacity-100");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("opacity-100"), 2000);
}

let audioContext = null;

function beep(frequency) {
  if (!preferences.sound) {
    return;
  }
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      return;
    }
    audioContext ??= new Context();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  } catch {
    preferences.sound = false;
    updateToggle(btnSound, false);
  }
}

function vibrate() {
  if (preferences.vibrate && typeof navigator.vibrate === "function") {
    navigator.vibrate([18, 40, 18]);
  }
}

function save() {
  lastSaved = Date.now();
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        laps: laps.map((lap) => ({ id: lap.id, splitMs: Math.round(lap.splitMs) })),
        elapsedMs: Math.round(stopwatch.elapsedMs),
        preferences: { ...preferences, theme: root.classList.contains("dark") ? "dark" : "light" },
      }),
    );
  } catch {
    notify("Could not save in this browser");
  }
}

function load() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== "object") {
    return false;
  }
  if (Array.isArray(saved.laps)) {
    laps = recompute(
      saved.laps
        .filter((lap) => lap && Number.isFinite(Number(lap.splitMs)))
        .slice(0, maxLaps)
        .map((lap) => ({ id: lap.id, splitMs: Math.max(0, Math.floor(Number(lap.splitMs))) })),
    );
  }
  if (saved.elapsedMs > 0) {
    stopwatch.restore(saved.elapsedMs);
  }
  const prefs = saved.preferences;
  if (prefs && typeof prefs === "object") {
    if (typeof prefs.sound === "boolean") {
      preferences.sound = prefs.sound;
    }
    if (typeof prefs.vibrate === "boolean") {
      preferences.vibrate = prefs.vibrate;
    }
    if (typeof prefs.wake === "boolean") {
      preferences.wake = prefs.wake;
    }
  }
  return laps.length > 0 || saved.elapsedMs > 0;
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  counter += 1;
  return `lap-${Date.now().toString(36)}-${counter}`;
}

function toggleStopwatch() {
  const running = stopwatch.running;
  stopwatch.toggle();
  updateControls();
  renderTime();
  schedule();
  beep(running ? 520 : 780);
  if (!running) {
    vibrate();
  }
  save();
}

function recordLap() {
  if (!stopwatch.running || stopwatch.elapsedMs <= 0) {
    return;
  }
  laps = addLap(laps, stopwatch.elapsedMs, newId(), maxLaps);
  renderLaps();
  lapList.scrollTop = 0;
  updateControls();
  beep(880);
  vibrate();
  save();
}

function resetAll() {
  stopwatch.reset();
  laps = [];
  cache.hours = null;
  renderLaps();
  updateControls();
  renderTime();
  beep(440);
  save();
  notify("Stopwatch reset");
}

function deleteLap(id) {
  const antes = laps.length;
  laps = removeLap(laps, id);
  if (laps.length === antes) {
    return;
  }
  renderLaps();
  updateControls();
  save();
  notify("Lap deleted");
}

function lapNumber(id) {
  const index = laps.findIndex((lap) => String(lap.id) === String(id));
  return index < 0 ? "?" : laps.length - index;
}

function openEdit(id) {
  const lap = laps.find((v) => String(v.id) === String(id));
  if (!lap) {
    return;
  }
  editingId = lap.id;
  dlgNumber.textContent = `#${lapNumber(lap.id)}`;
  timeInput.value = formatTime(lap.splitMs);
  fieldError.classList.add("hidden");
  dlg.showModal();
  timeInput.focus();
  timeInput.select();
}

editForm.addEventListener("submit", (event) => {
  const milliseconds = parseTime(timeInput.value);
  const result = milliseconds === null ? { error: "Use mm:ss.mmm, for example 01:23.456" } : editSplit(laps, editingId, milliseconds);
  if (result.error) {
    event.preventDefault();
    fieldError.textContent = result.error;
    fieldError.classList.remove("hidden");
    return;
  }
  laps = result.laps;
  save();
  renderLaps();
  notify("Lap updated");
});

dlg.addEventListener("close", () => {
  editingId = null;
});

el("btn-cancel-edit").addEventListener("click", () => dlg.close());

timeInput.addEventListener("input", () => fieldError.classList.add("hidden"));

function updateToggle(button, on) {
  button.dataset.state = String(on);
  button.setAttribute("aria-pressed", String(on));
}

function setTheme(dark) {
  root.classList.toggle("dark", dark);
  save();
}

btnTheme.addEventListener("click", () => {
  const dark = !root.classList.contains("dark");
  setTheme(dark);
  notify(dark ? "Dark theme" : "Light theme");
});

btnSound.addEventListener("click", () => {
  preferences.sound = !preferences.sound;
  updateToggle(btnSound, preferences.sound);
  save();
  if (preferences.sound) {
    beep(880);
  }
});

btnVibrate.addEventListener("click", () => {
  preferences.vibrate = !preferences.vibrate;
  updateToggle(btnVibrate, preferences.vibrate);
  save();
  if (preferences.vibrate) {
    vibrate();
  }
});

let wakeLock = null;

async function syncWakeLock(enable) {
  if (!("wakeLock" in navigator)) {
    return;
  }
  if (enable) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        updateToggle(btnWake, false);
        if (preferences.wake) {
          notify("The screen may now sleep normally");
        }
      });
      updateToggle(btnWake, true);
    } catch {
      preferences.wake = false;
      updateToggle(btnWake, false);
      notify("Could not keep the screen awake");
    }
  } else if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    updateToggle(btnWake, false);
  }
}

if (!("wakeLock" in navigator)) {
  btnWake.classList.add("hidden");
} else {
  btnWake.addEventListener("click", () => {
    preferences.wake = !preferences.wake;
    updateToggle(btnWake, preferences.wake);
    save();
    void syncWakeLock(preferences.wake);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    schedule();
    if (preferences.wake && !wakeLock) {
      void syncWakeLock(true);
    }
  } else {
    save();
  }
});

window.addEventListener("pagehide", save);

btnStart.addEventListener("click", toggleStopwatch);
btnLap.addEventListener("click", recordLap);
btnReset.addEventListener("click", resetAll);

lapList.addEventListener("click", (event) => {
  const item = event.target.closest("li[data-id]");
  if (!item) {
    return;
  }
  if (event.target.closest(".btn-edit")) {
    openEdit(item.dataset.id);
  } else if (event.target.closest(".btn-delete")) {
    deleteLap(item.dataset.id);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (dlg.open) {
    return;
  }
  if (event.target instanceof Element && event.target.closest("button, input, textarea, select, a")) {
    return;
  }
  const key = event.key.toLowerCase();
  if (event.code === "Space" || key === "enter") {
    event.preventDefault();
    toggleStopwatch();
  } else if (key === "l") {
    recordLap();
  } else if (key === "r") {
    resetAll();
  }
});

const restored = load();
updateToggle(btnSound, preferences.sound);
updateToggle(btnVibrate, preferences.vibrate);
updateToggle(btnWake, preferences.wake);
renderLaps();
updateControls();
renderTime();
if (restored) {
  notify("Previous session restored");
}
if (preferences.wake) {
  void syncWakeLock(true);
}
