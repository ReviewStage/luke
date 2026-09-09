import assert from "node:assert/strict";
import test from "node:test";
import { FOCUS_FRAME_LIMIT, focusSeek } from "./focus-seek";

/**
 * A stand-in for the browser's own frame schedule: nothing is run until a test
 * says how many frames passed, so a seek's own bookkeeping is what is read
 * rather than a timer's.
 */
function frames() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const globals = globalThis as unknown as {
    requestAnimationFrame: (callback: () => void) => number;
    cancelAnimationFrame: (handle: number) => void;
  };
  globals.requestAnimationFrame = (callback) => {
    const handle = next++;
    pending.set(handle, callback);
    return handle;
  };
  globals.cancelAnimationFrame = (handle) => {
    pending.delete(handle);
  };
  return {
    /** Runs whatever the last frame asked for, and answers whether anything did. */
    tick(): boolean {
      const entry = [...pending.entries()].at(-1);
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1]();
      return true;
    },
    get waiting(): number {
      return pending.size;
    },
  };
}

/** The one thing a seek reads off a target, and the one thing it does to it. */
function target(ready: boolean) {
  let acted = 0;
  return {
    element: { ready } as unknown as HTMLElement & { ready: boolean },
    get acted(): number {
      return acted;
    },
    note(): void {
      acted += 1;
    },
  };
}

test("a target already drawn is acted on at once, and only once", () => {
  const schedule = frames();
  const found = target(true);
  focusSeek({
    find: () => found.element,
    ready: (element) => element.ready,
    act: () => found.note(),
  });
  assert.equal(found.acted, 1);
  assert.equal(schedule.waiting, 0, "nothing is waited for once the target answered");
});

test("a target the panel has not drawn yet is waited for, then acted on", () => {
  const schedule = frames();
  const found = target(false);
  focusSeek({
    find: () => found.element,
    ready: (element) => element.ready,
    act: () => found.note(),
  });
  assert.equal(found.acted, 0);
  assert.equal(schedule.tick(), true);
  assert.equal(found.acted, 0);
  found.element.ready = true;
  assert.equal(schedule.tick(), true);
  assert.equal(found.acted, 1);
  assert.equal(schedule.waiting, 0);
});

test("a target that is never drawn is given up on rather than sought forever", () => {
  const schedule = frames();
  const found = target(false);
  focusSeek({
    find: () => found.element,
    ready: (element) => element.ready,
    act: () => found.note(),
    frames: 3,
  });
  for (let frame = 0; frame < 4; frame++) assert.equal(schedule.tick(), true, `frame ${frame}`);
  assert.equal(schedule.tick(), false, "the seek stopped asking for frames");
  assert.equal(found.acted, 0);
});

test("a target that is not there yet is sought the same way one that is hidden is", () => {
  const schedule = frames();
  const found = target(true);
  let present = false;
  focusSeek({
    find: () => (present ? found.element : null),
    ready: (element) => element.ready,
    act: () => found.note(),
  });
  assert.equal(found.acted, 0);
  present = true;
  assert.equal(schedule.tick(), true);
  assert.equal(found.acted, 1);
});

test("the canceller stops a frame already asked for", () => {
  const schedule = frames();
  const found = target(false);
  const stop = focusSeek({
    find: () => found.element,
    ready: (element) => element.ready,
    act: () => found.note(),
  });
  assert.equal(schedule.waiting, 1);
  stop();
  assert.equal(schedule.tick(), false);
  assert.equal(found.acted, 0);
});

test("the frame limit is the one backstop every seek shares", () => {
  assert.equal(FOCUS_FRAME_LIMIT, 60);
});
