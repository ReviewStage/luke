import assert from "node:assert/strict";
import test from "node:test";
import type { OutputAudioState } from "#shared/contracts";
import { OutputVolumeWatcher, parseOutputLine } from "./output-volume";

interface Harness {
  watcher: OutputVolumeWatcher;
  events: string[];
  killed: () => boolean;
  emit: (chunk: string) => void;
  die: () => void;
}

function harness(spawnFails = false): Harness {
  const events: string[] = [];
  let killed = false;
  let onData: ((chunk: string) => void) | undefined;
  const exits: (() => void)[] = [];

  const watcher = new OutputVolumeWatcher({
    spawnHelper: () =>
      spawnFails
        ? undefined
        : {
            stdout: {
              setEncoding: () => undefined,
              on: (_event, listener) => {
                onData = listener;
              },
            },
            on: (event, listener) => {
              if (event === "exit") exits.push(listener);
            },
            removeAllListeners: () => {
              exits.length = 0;
            },
            kill: () => {
              killed = true;
            },
          },
    onState: (state: OutputAudioState) =>
      events.push(`state:${state.muted ? 1 : 0}:${state.volume}`),
    onUnavailable: () => events.push("unavailable"),
  });

  return {
    watcher,
    events,
    killed: () => killed,
    emit: (chunk) => onData?.(chunk),
    die: () => {
      for (const exit of [...exits]) exit();
    },
  };
}

test("a state line is parsed and reported", () => {
  const context = harness();
  assert.equal(context.watcher.start(), true);
  context.emit("output muted=1 volume=0.42\n");
  assert.deepEqual(context.events, ["state:1:0.42"]);
});

test("a state survives being split across chunks", () => {
  const context = harness();
  context.watcher.start();
  // A half-read line is the difference between "muted" and nothing at all, so
  // a line is only acted on once it is whole.
  context.emit("output muted=0 vol");
  assert.deepEqual(context.events, []);
  context.emit("ume=0.00\noutput muted=1 volume=1.00\n");
  assert.deepEqual(context.events, ["state:0:0", "state:1:1"]);
});

test("an unavailable line withdraws the answer without ending the watch", () => {
  const context = harness();
  context.watcher.start();
  context.emit("unavailable no-output-device\n");
  // The default device can change to one the helper can read, so the watcher
  // keeps listening and the next state lands.
  context.emit("output muted=0 volume=0.30\n");
  assert.deepEqual(context.events, ["unavailable", "state:0:0.3"]);
});

test("a helper that dies takes its answer with it", () => {
  const context = harness();
  context.watcher.start();
  context.emit("output muted=1 volume=0.00\n");
  context.die();
  assert.deepEqual(context.events, ["state:1:0", "unavailable"]);
  // Dead is dead: a late line from the old pipe must not redraw anything.
  context.emit("output muted=1 volume=0.00\n");
  assert.deepEqual(context.events, ["state:1:0", "unavailable"]);
});

test("a helper that cannot spawn reports unavailable once", () => {
  const context = harness(true);
  assert.equal(context.watcher.start(), false);
  assert.deepEqual(context.events, ["unavailable"]);
});

test("stopping kills the helper and silences everything after", () => {
  const context = harness();
  context.watcher.start();
  context.watcher.stop();
  assert.equal(context.killed(), true);
  context.emit("output muted=1 volume=0.00\n");
  context.die();
  // The stop was the app's own doing, so nothing is reported for it.
  assert.deepEqual(context.events, []);
});

test("a line that does not parse is dropped rather than guessed at", () => {
  assert.equal(parseOutputLine("output muted=2 volume=0.5"), undefined);
  assert.equal(parseOutputLine("output muted=1 volume=1.5"), undefined);
  assert.equal(parseOutputLine("output muted=1"), undefined);
  assert.equal(parseOutputLine("ready"), undefined);
  assert.deepEqual(parseOutputLine("output muted=0 volume=0.07"), {
    muted: false,
    volume: 0.07,
  });
});
