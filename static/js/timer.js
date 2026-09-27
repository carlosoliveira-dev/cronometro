const HOUR_MS = 3600000;
const MINUTE_MS = 60000;
const SECOND_MS = 1000;

export function createStopwatch(clock) {
  const now = clock ?? (() => performance.now());
  let running = false;
  let accumulated = 0;
  let mark = 0;

  return {
    get running() {
      return running;
    },

    get elapsedMs() {
      return running ? accumulated + (now() - mark) : accumulated;
    },

    start() {
      if (running) {
        return this.elapsedMs;
      }
      mark = now();
      running = true;
      return this.elapsedMs;
    },

    pause() {
      if (!running) {
        return accumulated;
      }
      accumulated += now() - mark;
      running = false;
      return accumulated;
    },

    toggle() {
      return running ? this.pause() : this.start();
    },

    reset() {
      running = false;
      accumulated = 0;
      mark = 0;
    },

    restore(ms) {
      running = false;
      accumulated = Math.max(0, Math.floor(Number(ms) || 0));
      mark = 0;
    },
  };
}

export function timeParts(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const hours = Math.floor(total / HOUR_MS);
  return {
    hours,
    min: Math.floor(total / MINUTE_MS) % 60,
    s: Math.floor(total / SECOND_MS) % 60,
    ms: total % 1000,
    hasHours: hours > 0,
  };
}

export function formatTime(ms) {
  const p = timeParts(ms);
  const min = String(p.min).padStart(2, "0");
  const s = String(p.s).padStart(2, "0");
  const resto = String(p.ms).padStart(3, "0");
  return (p.hasHours ? `${p.hours}:` : "") + `${min}:${s}.${resto}`;
}

function digits(value, max) {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > max) {
    return null;
  }
  return Number(value);
}

export function parseTime(text) {
  if (typeof text !== "string") {
    return null;
  }
  const groups = text.trim().replace(",", ".").split(":");
  if (groups.length > 3) {
    return null;
  }
  const lastGroup = groups.pop();
  if (lastGroup === "") {
    return null;
  }
  const dotParts = lastGroup.split(".");
  if (dotParts.length > 2) {
    return null;
  }
  const seconds = digits(dotParts[0], 2);
  if (seconds === null) {
    return null;
  }
  const hasMilliseconds = dotParts.length === 2;
  const textMs = hasMilliseconds ? dotParts[1] : null;
  const milliseconds = hasMilliseconds ? digits(textMs, 3) : 0;
  if (milliseconds === null) {
    return null;
  }
  const hasMinutes = groups.length >= 1;
  const minutes = hasMinutes ? digits(groups.pop(), 2) : 0;
  if (minutes === null) {
    return null;
  }
  const hasHours = groups.length >= 1;
  const hours = hasHours ? digits(groups.pop(), 3) : 0;
  if (hours === null) {
    return null;
  }
  const scale = hasMilliseconds ? Math.pow(10, 3 - textMs.length) : 1;
  return ((hours * 60 + minutes) * 60 + seconds) * SECOND_MS + milliseconds * scale;
}

export function sumLapSplits(laps) {
  return laps.reduce((sum, lap) => sum + lap.splitMs, 0);
}

export function recompute(laps) {
  const totals = new Array(laps.length);
  let accumulated = 0;
  for (let i = laps.length - 1; i >= 0; i--) {
    accumulated += laps[i].splitMs;
    totals[i] = accumulated;
  }
  return laps.map((lap, i) => ({ ...lap, totalMs: totals[i] }));
}

export function addLap(laps, totalMs, id, max) {
  const splitMs = Math.max(0, Math.floor(Number(totalMs) || 0) - sumLapSplits(laps));
  const next = [{ id, splitMs }, ...laps];
  if (Number.isFinite(max) && max > 0 && next.length > max) {
    next.length = max;
  }
  return recompute(next);
}

export function editSplit(laps, id, newSplitMs) {
  const index = laps.findIndex((lap) => lap.id === id);
  if (index < 0) {
    return { error: "Lap not found." };
  }
  const value = Math.floor(Number(newSplitMs));
  if (!Number.isFinite(value) || value < 0) {
    return { error: "Enter a valid time." };
  }

  const updated = laps.map((lap) => ({ ...lap }));
  updated[index].splitMs = value;
  if (index === 0) {
    return { laps: recompute(updated) };
  }

  const newer = [];
  for (let i = index - 1; i >= 0; i--) {
    newer.push(i);
  }
  const older = [];
  for (let i = index + 1; i < updated.length; i++) {
    older.push(i);
  }

  let toRemove = value - laps[index].splitMs;
  let toRestore = -toRemove;
  for (const i of [...newer, ...older]) {
    if (toRemove > 0) {
      const taken = Math.min(updated[i].splitMs, toRemove);
      updated[i].splitMs -= taken;
      toRemove -= taken;
    } else if (toRestore > 0) {
      updated[i].splitMs += toRestore;
      toRestore = 0;
    }
  }
  if (toRemove > 0) {
    updated[index].splitMs -= toRemove;
  }

  return { laps: recompute(updated) };
}

export function removeLap(laps, id) {
  return recompute(laps.filter((lap) => lap.id !== id));
}

export function bestAndWorst(laps) {
  if (laps.length < 2) {
    return { bestId: null, worstId: null };
  }
  let best = laps[0];
  let worst = laps[0];
  for (const lap of laps) {
    if (lap.splitMs < best.splitMs) {
      best = lap;
    }
    if (lap.splitMs > worst.splitMs) {
      worst = lap;
    }
  }
  if (best.splitMs === worst.splitMs) {
    return { bestId: null, worstId: null };
  }
  return { bestId: best.id, worstId: worst.id };
}
