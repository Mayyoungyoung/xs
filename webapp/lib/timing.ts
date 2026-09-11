// Small timing helpers that are easy to test on their own.

export type Debounced<A extends unknown[]> = {
  call: (...args: A) => void;
  flush: () => void;
  cancel: () => void;
  pending: () => boolean;
};

// Schedules with a real timer when available; tests can pass their own
// scheduler to assert how often the work actually runs.
export type Scheduler = { set: (handler: () => void, ms: number) => number; clear: (handle: number) => void; now: () => number };

export const realScheduler: Scheduler = {
  set: (handler, ms) => window.setTimeout(handler, ms),
  clear: (handle) => window.clearTimeout(handle),
  now: () => Date.now(),
};

export function debounce<A extends unknown[]>(handler: (...args: A) => void, waitMs: number, scheduler: Scheduler = realScheduler): Debounced<A> {
  let handle: number | undefined;
  let lastArgs: A | undefined;
  const run = () => {
    handle = undefined;
    const args = lastArgs;
    lastArgs = undefined;
    if (args) handler(...args);
  };
  return {
    call(...args: A) {
      lastArgs = args;
      if (handle !== undefined) scheduler.clear(handle);
      handle = scheduler.set(run, waitMs);
    },
    flush() {
      if (handle === undefined) return;
      scheduler.clear(handle);
      run();
    },
    cancel() {
      if (handle !== undefined) scheduler.clear(handle);
      handle = undefined;
      lastArgs = undefined;
    },
    pending() { return handle !== undefined; },
  };
}
