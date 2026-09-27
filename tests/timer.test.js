import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
  sumLapSplits,
} from "../static/js/timer.js";

function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

describe("createStopwatch", () => {
  it("adds up the intervals without losing the millisecond fraction", () => {
    const clock = fakeClock();
    const c = createStopwatch(clock.now);

    c.start();
    clock.advance(1234.5678);
    c.pause();
    assert.equal(Math.floor(c.elapsedMs), 1234);

    c.start();
    clock.advance(765.4322);
    assert.equal(Math.floor(c.elapsedMs), 2000);
  });

  it("ignores a repeated start and a pause while stopped", () => {
    const clock = fakeClock();
    const c = createStopwatch(clock.now);

    c.start();
    clock.advance(500);
    c.start();
    clock.advance(500);
    assert.equal(Math.floor(c.elapsedMs), 1000);

    c.pause();
    clock.advance(5000);
    assert.equal(Math.floor(c.elapsedMs), 1000);
    assert.equal(c.running, false);
  });

  it("resets and restores", () => {
    const clock = fakeClock();
    const c = createStopwatch(clock.now);

    c.start();
    clock.advance(3000);
    assert.equal(c.running, true);
    c.reset();
    assert.equal(c.elapsedMs, 0);
    assert.equal(c.running, false);

    c.restore(4271.9);
    assert.equal(c.elapsedMs, 4271);
    assert.equal(c.running, false);
  });

  it("toggles the running state", () => {
    const clock = fakeClock();
    const c = createStopwatch(clock.now);

    c.toggle();
    clock.advance(250);
    c.toggle();
    clock.advance(9999);
    assert.equal(Math.floor(c.elapsedMs), 250);
  });
});

describe("formatTime", () => {
  it("pads two digits for minutes and seconds and three for milliseconds", () => {
    assert.equal(formatTime(0), "00:00.000");
    assert.equal(formatTime(7), "00:00.007");
    assert.equal(formatTime(999), "00:00.999");
    assert.equal(formatTime(1000), "00:01.000");
    assert.equal(formatTime(61001), "01:01.001");
    assert.equal(formatTime(600000), "10:00.000");
    assert.equal(formatTime(3599999), "59:59.999");
  });

  it("prepends the hours after one hour", () => {
    assert.equal(formatTime(3600000), "1:00:00.000");
    assert.equal(formatTime(3600000 + 61001), "1:01:01.001");
    assert.equal(formatTime(3600000 * 2 + 1000), "2:00:01.000");
    assert.equal(formatTime(3600000 * 20 + 1000), "20:00:01.000");
  });

  it("truncates and never goes negative", () => {
    assert.equal(formatTime(1999.9), "00:01.999");
    assert.equal(formatTime(-50), "00:00.000");
    assert.equal(formatTime(Number.NaN), "00:00.000");
  });
});

describe("timeParts", () => {
  it("splits the total into the groups shown in the display", () => {
    assert.deepEqual(timeParts(3723004), { hours: 1, min: 2, s: 3, ms: 4, hasHours: true });
    assert.deepEqual(timeParts(63456), { hours: 0, min: 1, s: 3, ms: 456, hasHours: false });
  });
});

describe("parseTime", () => {
  it("accepts the forms with and without minutes", () => {
    assert.equal(parseTime("01:23.456"), 83456);
    assert.equal(parseTime("1:23.456"), 83456);
    assert.equal(parseTime("23.456"), 23456);
    assert.equal(parseTime("1:2.3"), 62300);
    assert.equal(parseTime("1:2"), 62000);
    assert.equal(parseTime("12"), 12000);
    assert.equal(parseTime("01:23,456"), 83456);
    assert.equal(parseTime("  05:00.000  "), 300000);
    assert.equal(parseTime("0:00.001"), 1);
    assert.equal(parseTime("1:02:03.000"), 3723000);
  });

  it("rejects invalid input", () => {
    for (const invalid of ["", " ", "abc", "1:2:3:4", "1..2", "-1", "1:-2", "12.34.56", "1:2.", "007:00.0", "1:2:3:4:5", null, undefined, 42]) {
      assert.equal(parseTime(invalid), null, `expected null for ${JSON.stringify(invalid)}`);
    }
  });

  it("round-trips every lap time it can read", () => {
    for (const text of ["00:00.000", "01:23.456", "59:59.999", "1:00:00.000"]) {
      assert.equal(formatTime(parseTime(text)), text);
    }
  });
});

describe("laps", () => {
  it("derives the split from the total and orders newest first", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 22500, "b", 100);
    laps = addLap(laps, 31000, "c", 100);

    assert.deepEqual(
      laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 8500, 31000],
        ["b", 12500, 22500],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(sumLapSplits(laps), 31000);
  });

  it("honours the limit by dropping the oldest laps", () => {
    let laps = [];
    for (const total of [1000, 2000, 3000, 4000]) {
      laps = addLap(laps, total, `v${total}`, 3);
    }
    assert.deepEqual(
      laps.map((v) => v.id),
      ["v4000", "v3000", "v2000"],
    );
    assert.equal(laps[0].splitMs, 1000);
  });

  it("recomputes the totals when a split in the middle is edited", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    const result = editSplit(laps, "b", 15000);
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 5000, 30000],
        ["b", 15000, 25000],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(sumLapSplits(result.laps), 30000);
  });

  it("borrows from the newer laps when the delta is too large", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    const result = editSplit(laps, "a", 14000);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 30000],
        ["b", 6000, 20000],
        ["a", 14000, 14000],
      ],
    );
    assert.equal(sumLapSplits(result.laps), 30000);
  });

  it("shrinks the edited value when there is not enough to borrow", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    const result = editSplit(laps, "a", 25000);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 5000, 30000],
        ["b", 0, 25000],
        ["a", 25000, 25000],
      ],
    );
    assert.equal(sumLapSplits(result.laps), 30000);
    assert.ok(result.laps.every((v) => v.splitMs >= 0));
  });

  it("keeps the total when editing the oldest lap by absorbing from the older ones", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    const result = editSplit(laps, "a", 5000);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 30000],
        ["b", 15000, 20000],
        ["a", 5000, 5000],
      ],
    );
    assert.equal(sumLapSplits(result.laps), 30000);
  });

  it("never leaves a negative split when there is nothing to absorb", () => {
    const laps = [
      { id: "c", splitMs: 0, totalMs: 0 },
      { id: "a", splitMs: 0, totalMs: 0 },
      { id: "b", splitMs: 0, totalMs: 0 },
    ];

    const result = editSplit(laps, "a", 5000);
    assert.deepEqual(
      result.laps.map((v) => v.splitMs),
      [0, 0, 0],
    );
  });

  it("spreads the slack to the newer laps when the edited split shrinks", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    const result = editSplit(laps, "b", 5000);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 15000, 30000],
        ["b", 5000, 15000],
        ["a", 10000, 10000],
      ],
    );
    assert.equal(sumLapSplits(result.laps), 30000);
  });

  it("editing the newest lap does not affect the others", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);

    const result = editSplit(laps, "b", 5000);
    assert.deepEqual(
      result.laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["b", 5000, 15000],
        ["a", 10000, 10000],
      ],
    );
  });

  it("refuses a negative value or an unknown id", () => {
    const laps = addLap([], 10000, "a", 100);
    assert.equal(editSplit(laps, "a", -1).error, "Enter a valid time.");
    assert.equal(editSplit(laps, "a", Number.NaN).error, "Enter a valid time.");
    assert.equal(editSplit(laps, "zzz", 100).error, "Lap not found.");
  });

  it("recomputes the totals on delete without shifting the others", () => {
    let laps = [];
    laps = addLap(laps, 10000, "a", 100);
    laps = addLap(laps, 20000, "b", 100);
    laps = addLap(laps, 30000, "c", 100);

    laps = removeLap(laps, "b");
    assert.deepEqual(
      laps.map((v) => [v.id, v.splitMs, v.totalMs]),
      [
        ["c", 10000, 20000],
        ["a", 10000, 10000],
      ],
    );
  });

  it("recompute does not mutate the input", () => {
    const original = [{ id: "a", splitMs: 1000 }];
    const recomputed = recompute(original);
    assert.equal(original[0].totalMs, undefined);
    assert.equal(recomputed[0].totalMs, 1000);
  });
});

describe("bestAndWorst", () => {
  it("ignores the case where every lap is equal", () => {
    const laps = [{ id: "a", splitMs: 5000 }, { id: "b", splitMs: 5000 }];
    assert.deepEqual(bestAndWorst(laps), { bestId: null, worstId: null });
  });

  it("needs at least two laps", () => {
    assert.deepEqual(bestAndWorst([{ id: "a", splitMs: 100 }]), { bestId: null, worstId: null });
  });

  it("flags the fastest and the slowest lap", () => {
    const laps = [
      { id: "a", splitMs: 12000 },
      { id: "b", splitMs: 9000 },
      { id: "c", splitMs: 15000 },
    ];
    assert.deepEqual(bestAndWorst(laps), { bestId: "b", worstId: "c" });
  });
});
