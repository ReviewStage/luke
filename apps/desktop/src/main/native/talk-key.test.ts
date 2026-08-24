import assert from "node:assert/strict";
import test from "node:test";
import { TalkKeyWatcher } from "./talk-key";

interface Harness {
  watcher: TalkKeyWatcher;
  edges: string[];
  candidates: string[][];
  killed: () => boolean;
  emit: (chunk: string) => void;
  die: () => void;
}

function harness(): Harness {
  const edges: string[] = [];
  const candidates: string[][] = [];
  let killed = false;
  let onData: ((chunk: string) => void) | undefined;
  const exits: (() => void)[] = [];

  const watcher = new TalkKeyWatcher({
    spawnHelper: (requested) => {
      candidates.push([...requested]);
      return {
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
      };
    },
    onPress: () => edges.push("press"),
    onRelease: () => edges.push("release"),
    onRegistered: (accelerator) => edges.push(`registered:${accelerator}`),
    onUnavailable: () => edges.push("unavailable"),
  });

  return {
    watcher,
    edges,
    candidates,
    killed: () => killed,
    emit: (chunk) => onData?.(chunk),
    die: () => {
      for (const exit of [...exits]) exit();
    },
  };
}

test("the helper's own accelerator choice is the one reported", () => {
  const context = harness();
  assert.equal(context.watcher.start(["Alt+Space", "Alt+S"]), true);
  // The candidates are the app's list, in the app's order: which one wins is
  // the helper's answer, because only it knows what this Mac already owns.
  assert.deepEqual(context.candidates, [["Alt+Space", "Alt+S"]]);

  context.emit("registered Alt+S\n");
  assert.deepEqual(context.edges, ["registered:Alt+S"]);
});

test("a press and its release survive being split across chunks", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\ndo");
  // A half-read "up" is the difference between a turn ending and a microphone
  // left open, so a line is only acted on once it is whole.
  assert.deepEqual(context.edges, ["registered:Alt+Space"]);

  context.emit("wn\nu");
  assert.deepEqual(context.edges, ["registered:Alt+Space", "press"]);

  context.emit("p\n");
  assert.deepEqual(context.edges, ["registered:Alt+Space", "press", "release"]);
});

test("several edges arriving at once are read in the order they happened", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\ndown\nup\ndown\n");

  assert.deepEqual(context.edges, ["registered:Alt+Space", "press", "release", "press"]);
});

test("a helper that dies after registering still gives the key up", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\n");
  context.die();

  // Registering once is not a promise to keep working. Without this the app
  // would show a talk key that nothing is watching for.
  assert.deepEqual(context.edges, ["registered:Alt+Space", "unavailable"]);
});

test("a partial press from a dying helper is discarded", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\ndown");
  context.die();

  assert.deepEqual(context.edges, ["registered:Alt+Space", "unavailable"]);
});

test("a refusal is reported once, not once per way of hearing it", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("unavailable already-owned\n");
  context.die();

  assert.deepEqual(context.edges, ["unavailable"]);
});

test("stopping is the app's own doing and is not a key becoming unavailable", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\n");
  void context.watcher.stop();
  context.die();

  assert.equal(context.killed(), true);
  // Falling back to another key during shutdown would register a global
  // shortcut on the way out of the app.
  assert.deepEqual(context.edges, ["registered:Alt+Space"]);
});

test("a line the dying helper got out after a stop is dropped, not acted on", () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\n");
  void context.watcher.stop();
  // The pipe outlives the kill by however long the process takes to die, so a
  // press in that window still arrives here. Acting on it would open the
  // microphone under a chord the app has already let go of.
  context.emit("down\nregistered Alt+Space\n");

  assert.deepEqual(context.edges, ["registered:Alt+Space"]);
});

test("stopping reports when the helper's process is actually gone", async () => {
  const context = harness();
  context.watcher.start(["Alt+Space"]);
  context.emit("registered Alt+Space\n");

  let gone = false;
  const stopped = context.watcher.stop().then(() => {
    gone = true;
  });
  // The kill is asked for at once, but the chord is only released when the
  // process exits — which is what a successor has to wait for.
  assert.equal(context.killed(), true);
  await Promise.resolve();
  assert.equal(gone, false);

  context.die();
  await stopped;
  assert.equal(gone, true);
});
