import test from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../lib/timing.ts";

// A scheduler the test drives by hand, so the assertion is about real call
// counts instead of wall-clock guessing.
function manualScheduler() {
  let next = 1;
  const timers = new Map();
  return {
    scheduler: {
      set: (handler, ms) => { const handle = next++; timers.set(handle, { handler, ms }); return handle; },
      clear: (handle) => { timers.delete(handle); },
      now: () => 0,
    },
    pending: () => [...timers.values()],
    fire: () => { const entries = [...timers.entries()]; timers.clear(); for (const [, timer] of entries) timer.handler(); return entries.length; },
  };
}

test("rapid calls collapse into one write", () => {
  const clock = manualScheduler();
  const writes = [];
  const sink = debounce((value) => writes.push(value), 400, clock.scheduler);
  for (let index = 0; index < 12; index++) sink.call(index);
  assert.equal(clock.pending().length, 1, "only one timer is armed no matter how many scroll events arrive");
  assert.deepEqual(writes, [], "nothing is written while the gesture is still in flight");
  clock.fire();
  assert.deepEqual(writes, [11], "the last position is the one that lands");
});

test("flush writes the pending value immediately, cancel writes nothing", () => {
  const clock = manualScheduler();
  const writes = [];
  const sink = debounce((value) => writes.push(value), 400, clock.scheduler);
  sink.call("a");
  assert.equal(sink.pending(), true);
  sink.flush();
  assert.deepEqual(writes, ["a"], "leaving the page persists the final viewport");
  assert.equal(sink.pending(), false);
  sink.call("b");
  sink.cancel();
  clock.fire();
  assert.deepEqual(writes, ["a"], "a cancelled interaction is not persisted");
});

test("a new call after the timer fired starts a fresh schedule", () => {
  const clock = manualScheduler();
  const writes = [];
  const sink = debounce((value) => writes.push(value), 400, clock.scheduler);
  sink.call(1);
  clock.fire();
  sink.call(2);
  assert.equal(clock.pending().length, 1);
  clock.fire();
  assert.deepEqual(writes, [1, 2]);
});
