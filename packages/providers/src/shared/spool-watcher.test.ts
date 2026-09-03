import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { HOOK_EVENT } from "./hook-events.js";
import {
  type ObservedSpoolEvent,
  type SpoolWatch,
  type SpoolWatchHandle,
  watchObservationSpool,
} from "./spool-watcher.js";

type SpoolEvent = (typeof HOOK_EVENT)[keyof typeof HOOK_EVENT];

const EVENTS: readonly SpoolEvent[] = Object.values(HOOK_EVENT);
const DEBOUNCE_MS = 500;
const REARM_INTERVAL_MS = 5000;

type Timer = ReturnType<typeof setTimeout>;

interface FakeClock {
  schedule: (callback: () => void, delayMs: number) => Timer;
  cancel: (timer: Timer) => void;
  advance: (ms: number) => Promise<void>;
  pending: () => number[];
}

function fakeClock(): FakeClock {
  let nowMs = 0;
  let nextId = 1;
  const timers = new Map<Timer, { dueMs: number; callback: () => void }>();
  return {
    schedule: (callback, delayMs) => {
      // SAFETY: the watcher only hands the timer back to `cancel`, so any
      // distinct value serves as its handle.
      const timer = nextId++ as unknown as Timer;
      timers.set(timer, { dueMs: nowMs + delayMs, callback });
      return timer;
    },
    cancel: (timer) => {
      timers.delete(timer);
    },
    advance: async (ms) => {
      const untilMs = nowMs + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, entry]) => entry.dueMs <= untilMs)
          .sort(([, a], [, b]) => a.dueMs - b.dueMs)[0];
        if (!due) break;
        const [timer, entry] = due;
        timers.delete(timer);
        nowMs = entry.dueMs;
        entry.callback();
        await settle();
      }
      nowMs = untilMs;
    },
    pending: () => [...timers.values()].map((entry) => entry.dueMs - nowMs),
  };
}

/** Gives the reads a fired timer started a chance to finish before asserting. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("condition never held");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

interface FakeWatcher {
  watch: SpoolWatch;
  directories: string[];
  emit: (eventType: string, fileName: string | null) => void;
  fail: (error: Error) => void;
  closedCount: () => number;
  /** Errors the next watch calls throw, consumed one per call. */
  refuse: (...errors: Error[]) => void;
}

function fakeWatcher(): FakeWatcher {
  const directories: string[] = [];
  const refusals: Error[] = [];
  let closed = 0;
  let listener: ((eventType: string, fileName: string | null) => void) | undefined;
  let errorListener: ((error: Error) => void) | undefined;
  return {
    directories,
    watch: (directory, options, onChange) => {
      assert.equal(options.persistent, false);
      const refusal = refusals.shift();
      if (refusal) throw refusal;
      directories.push(directory);
      listener = onChange;
      const handle: SpoolWatchHandle = {
        on: (_event, onError) => {
          errorListener = onError;
        },
        close: () => {
          closed += 1;
          if (listener === onChange) listener = undefined;
        },
      };
      return handle;
    },
    emit: (eventType, fileName) => listener?.(eventType, fileName),
    fail: (error) => errorListener?.(error),
    closedCount: () => closed,
    refuse: (...errors) => {
      refusals.push(...errors);
    },
  };
}

function missingDirectoryError(): Error {
  const error: NodeJS.ErrnoException = new Error("ENOENT: no such file or directory, watch");
  error.code = "ENOENT";
  return error;
}

async function temporarySpool(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-spool-watcher-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeSpoolFile(spoolDirectory: string, fileName: string, content: string) {
  await fs.writeFile(path.join(spoolDirectory, fileName), content, "utf8");
}

function standWatcher(
  t: TestContext,
  spoolDirectory: string,
  watcher: FakeWatcher,
  clock: FakeClock,
) {
  const batches: (readonly ObservedSpoolEvent<SpoolEvent>[])[] = [];
  const handle = watchObservationSpool({
    spoolDirectory,
    events: EVENTS,
    onEvents: (events) => {
      batches.push(events);
    },
    watch: watcher.watch,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  t.after(() => handle.close());
  return { handle, batches };
}

test("one debounce window reports every readable spool file it saw as one batch", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  const { batches } = standWatcher(t, spoolDirectory, watcher, clock);
  assert.deepEqual(watcher.directories, [spoolDirectory]);

  await writeSpoolFile(spoolDirectory, "session-a.json", '{"event":"stop"}');
  await writeSpoolFile(spoolDirectory, "session-b.json", '{"event":"prompt"}');
  await writeSpoolFile(spoolDirectory, "foreign.json", '{"event":"something-else"}');
  await writeSpoolFile(spoolDirectory, "broken.json", "not json");
  await writeSpoolFile(spoolDirectory, ".session-c.123.tmp", '{"event":"stop"}');

  watcher.emit("rename", "session-a.json");
  watcher.emit("change", "session-a.json");
  watcher.emit("rename", "session-b.json");
  watcher.emit("rename", "foreign.json");
  watcher.emit("rename", "broken.json");
  watcher.emit("rename", "absent.json");
  watcher.emit("rename", ".session-c.123.tmp");
  watcher.emit("rename", "../escape.json");
  watcher.emit("rename", null);

  await clock.advance(DEBOUNCE_MS - 1);
  assert.equal(batches.length, 0);
  await clock.advance(1);
  await waitFor(() => batches.length === 1);

  const batch = batches[0] ?? [];
  assert.deepEqual(
    batch.map(({ providerSessionId, event }) => ({ providerSessionId, event })),
    [
      { providerSessionId: "session-a", event: HOOK_EVENT.STOP },
      { providerSessionId: "session-b", event: HOOK_EVENT.PROMPT },
    ],
  );
  const statsA = await fs.stat(path.join(spoolDirectory, "session-a.json"));
  assert.equal(batch[0]?.atMs, statsA.mtimeMs);
});

test("the batch window opens at the first event and is not extended by later ones", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  const { batches } = standWatcher(t, spoolDirectory, watcher, clock);

  await writeSpoolFile(spoolDirectory, "first.json", '{"event":"session-start"}');
  await writeSpoolFile(spoolDirectory, "second.json", '{"event":"stop"}');
  watcher.emit("rename", "first.json");
  await clock.advance(DEBOUNCE_MS - 100);
  watcher.emit("rename", "second.json");
  await clock.advance(100);
  await waitFor(() => batches.length === 1);
  assert.deepEqual(
    batches.map((batch) => batch.map((event) => event.providerSessionId)),
    [["first", "second"]],
  );

  watcher.emit("rename", "second.json");
  await clock.advance(DEBOUNCE_MS);
  await waitFor(() => batches.length === 2);
  assert.deepEqual(
    batches.map((batch) => batch.map((event) => event.providerSessionId)),
    [["first", "second"], ["second"]],
  );
});

test("a batch whose files all fail to read reports nothing", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  const { batches } = standWatcher(t, spoolDirectory, watcher, clock);

  watcher.emit("rename", "gone.json");
  await clock.advance(DEBOUNCE_MS);
  assert.equal(batches.length, 0);
});

test("a spool directory that does not exist yet is watched once it appears", async (t) => {
  const spoolDirectory = path.join(await temporarySpool(t), "events");
  const watcher = fakeWatcher();
  watcher.refuse(missingDirectoryError(), missingDirectoryError());
  const clock = fakeClock();
  const { batches } = standWatcher(t, spoolDirectory, watcher, clock);
  assert.deepEqual(watcher.directories, []);
  assert.deepEqual(clock.pending(), [REARM_INTERVAL_MS]);

  await clock.advance(REARM_INTERVAL_MS);
  assert.deepEqual(watcher.directories, []);
  assert.deepEqual(clock.pending(), [REARM_INTERVAL_MS]);

  await fs.mkdir(spoolDirectory);
  await clock.advance(REARM_INTERVAL_MS);
  assert.deepEqual(watcher.directories, [spoolDirectory]);
  assert.deepEqual(clock.pending(), []);

  await writeSpoolFile(spoolDirectory, "late.json", '{"event":"stop"}');
  watcher.emit("rename", "late.json");
  await clock.advance(DEBOUNCE_MS);
  await waitFor(() => batches.length === 1);
  assert.deepEqual(
    batches.map((batch) => batch.map((event) => event.providerSessionId)),
    [["late"]],
  );
});

test("a watch that fails is closed and stood up again after the rearm interval", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  const { batches } = standWatcher(t, spoolDirectory, watcher, clock);

  watcher.fail(new Error("watch failed"));
  assert.equal(watcher.closedCount(), 1);
  assert.deepEqual(clock.pending(), [REARM_INTERVAL_MS]);
  watcher.fail(new Error("watch failed again"));
  assert.equal(watcher.closedCount(), 1);
  assert.deepEqual(clock.pending(), [REARM_INTERVAL_MS]);

  await clock.advance(REARM_INTERVAL_MS);
  assert.deepEqual(watcher.directories, [spoolDirectory, spoolDirectory]);

  await writeSpoolFile(spoolDirectory, "after.json", '{"event":"notification"}');
  watcher.emit("rename", "after.json");
  await clock.advance(DEBOUNCE_MS);
  await waitFor(() => batches.length === 1);
  assert.deepEqual(
    batches.map((batch) => batch.map((event) => event.event)),
    [[HOOK_EVENT.NOTIFICATION]],
  );
});

test("closing stops the watch, drops pending ids, and cancels the rearm", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  const { handle, batches } = standWatcher(t, spoolDirectory, watcher, clock);

  await writeSpoolFile(spoolDirectory, "pending.json", '{"event":"stop"}');
  watcher.emit("rename", "pending.json");
  assert.deepEqual(clock.pending(), [DEBOUNCE_MS]);
  handle.close();
  assert.equal(watcher.closedCount(), 1);
  assert.deepEqual(clock.pending(), []);

  watcher.emit("rename", "pending.json");
  await clock.advance(DEBOUNCE_MS + REARM_INTERVAL_MS);
  assert.equal(batches.length, 0);
  assert.deepEqual(watcher.directories, [spoolDirectory]);
  handle.close();
  assert.equal(watcher.closedCount(), 1);
});

test("closing while a directory is still awaited stops the retries", async (t) => {
  const spoolDirectory = path.join(await temporarySpool(t), "events");
  const watcher = fakeWatcher();
  watcher.refuse(missingDirectoryError());
  const clock = fakeClock();
  const { handle } = standWatcher(t, spoolDirectory, watcher, clock);
  assert.deepEqual(clock.pending(), [REARM_INTERVAL_MS]);
  handle.close();
  assert.deepEqual(clock.pending(), []);
  await fs.mkdir(spoolDirectory);
  await clock.advance(REARM_INTERVAL_MS);
  assert.deepEqual(watcher.directories, []);
});

test("a batch read after close is not reported", async (t) => {
  const spoolDirectory = await temporarySpool(t);
  const watcher = fakeWatcher();
  const clock = fakeClock();
  let closeDuringRead: () => void = () => undefined;
  const batches: (readonly ObservedSpoolEvent<SpoolEvent>[])[] = [];
  const handle = watchObservationSpool({
    spoolDirectory,
    events: EVENTS,
    onEvents: (events) => {
      batches.push(events);
    },
    watch: watcher.watch,
    schedule: (callback, delayMs) =>
      clock.schedule(() => {
        callback();
        closeDuringRead();
      }, delayMs),
    cancel: clock.cancel,
  });
  closeDuringRead = () => handle.close();

  await writeSpoolFile(spoolDirectory, "racing.json", '{"event":"stop"}');
  watcher.emit("rename", "racing.json");
  await clock.advance(DEBOUNCE_MS);
  assert.equal(batches.length, 0);
});
