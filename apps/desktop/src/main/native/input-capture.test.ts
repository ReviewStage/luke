import assert from "node:assert/strict";
import test from "node:test";
import { InputCaptureWatcher, parseInputCaptureLine } from "./input-capture";

interface Harness {
  watcher: InputCaptureWatcher;
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

  const watcher = new InputCaptureWatcher({
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
    onCapturing: (running) => events.push(`capturing:${running ? 1 : 0}`),
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

test("a capture line is parsed and reported", () => {
  const context = harness();
  assert.equal(context.watcher.start(), true);
  context.emit("capture running=1\n");
  assert.deepEqual(context.events, ["capturing:1"]);
});

test("a capture survives being split across chunks", () => {
  const context = harness();
  context.watcher.start();
  context.emit("capture runn");
  assert.deepEqual(context.events, []);
  context.emit("ing=0\ncapture running=1\n");
  assert.deepEqual(context.events, ["capturing:0", "capturing:1"]);
});

test("an unavailable line withdraws the answer without ending the watch", () => {
  const context = harness();
  context.watcher.start();
  context.emit("unavailable no-input-device\n");
  // A microphone can be plugged in after the helper found none.
  context.emit("capture running=1\n");
  assert.deepEqual(context.events, ["unavailable", "capturing:1"]);
});

test("a helper that dies takes its answer with it", () => {
  const context = harness();
  context.watcher.start();
  context.emit("capture running=1\n");
  context.die();
  assert.deepEqual(context.events, ["capturing:1", "unavailable"]);
  context.emit("capture running=1\n");
  assert.deepEqual(context.events, ["capturing:1", "unavailable"]);
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
  context.emit("capture running=1\n");
  context.die();
  assert.deepEqual(context.events, []);
});

test("a line that does not parse is dropped rather than guessed at", () => {
  assert.equal(parseInputCaptureLine("capture running=2"), undefined);
  assert.equal(parseInputCaptureLine("capture running="), undefined);
  assert.equal(parseInputCaptureLine("capture running=1 extra"), undefined);
  assert.equal(parseInputCaptureLine("ready"), undefined);
  assert.equal(parseInputCaptureLine("capture running=0"), false);
  assert.equal(parseInputCaptureLine("capture running=1"), true);
});
