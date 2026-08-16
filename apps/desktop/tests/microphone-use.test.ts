import assert from "node:assert/strict";
import test from "node:test";
import {
  LUKE_BUNDLE_PREFIXES,
  type MicrophoneReading,
  MicrophoneUseWatcher,
  microphoneReadingFromLine,
} from "../src/microphone-use";
import { MAXIMUM_CALL_APP_ICON_LENGTH } from "../src/shared/contracts";

interface Harness {
  watcher: MicrophoneUseWatcher;
  readings: (MicrophoneReading | undefined)[];
  diagnostics: string[];
  prefixes: readonly string[][];
  spawns: () => number;
  killed: () => boolean;
  emit: (chunk: string) => void;
  die: () => void;
}

function harness(options: { refuseToSpawn?: boolean } = {}): Harness {
  const readings: (MicrophoneReading | undefined)[] = [];
  const diagnostics: string[] = [];
  const prefixes: readonly string[][] = [];
  let spawns = 0;
  let killed = false;
  let onData: ((chunk: string) => void) | undefined;
  const exits: (() => void)[] = [];

  const watcher = new MicrophoneUseWatcher({
    spawnHelper: (given) => {
      spawns += 1;
      (prefixes as string[][]).push([...given]);
      if (options.refuseToSpawn) throw new Error("spawn ENOENT mac-microphone-use");
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
    onChanged: (reading) => readings.push(reading),
    onDiagnostic: (message) => diagnostics.push(message),
  });

  return {
    watcher,
    readings,
    diagnostics,
    prefixes,
    spawns: () => spawns,
    killed: () => killed,
    emit: (chunk) => onData?.(chunk),
    die: () => {
      for (const exit of [...exits]) exit();
    },
  };
}

const ZOOM = '{"running":true,"apps":[{"id":"us.zoom.xos","name":"zoom.us"}]}';
const IDLE = '{"running":false,"apps":[]}';

test("a reading names the apps holding the device", () => {
  const reading = microphoneReadingFromLine(ZOOM);

  assert.deepEqual(reading, { running: true, apps: [{ id: "us.zoom.xos", name: "zoom.us" }] });
});

test("a line that is not a reading is nothing rather than a guess", () => {
  // A half-written line is a real thing to receive, and a reading built out of
  // undefined would drive the panel.
  for (const line of ["", "{", "null", "[]", '"on"', '{"running":true}', '{"apps":[]}']) {
    assert.equal(microphoneReadingFromLine(line), undefined, line);
  }
});

test("an app with no usable identifier is dropped, not drawn nameless", () => {
  const reading = microphoneReadingFromLine(
    '{"running":true,"apps":[{"id":"","name":"Ghost"},{"id":"a.b","name":""},{"name":"x"}]}',
  );

  // The identifier is what an ignore list is keyed by, so an entry without one
  // could never be acted on. A missing name falls back to the identifier.
  assert.deepEqual(reading, { running: true, apps: [{ id: "a.b", name: "a.b" }] });
});

test("an app's icon rides with it, and an implausible one does not", () => {
  const withIcon = microphoneReadingFromLine(
    '{"running":true,"apps":[{"id":"us.zoom.xos","name":"zoom.us","icon":"iVBORw0KGgo="}]}',
  );
  assert.equal(withIcon?.apps[0]?.icon, "iVBORw0KGgo=");

  // Dropped rather than carried: the row falls back to a glyph, which is a
  // better answer than a settings file with something else's megabyte in it.
  const huge = "A".repeat(MAXIMUM_CALL_APP_ICON_LENGTH + 1);
  const oversized = microphoneReadingFromLine(
    JSON.stringify({ running: true, apps: [{ id: "us.zoom.xos", name: "zoom.us", icon: huge }] }),
  );
  assert.equal(oversized?.apps[0]?.icon, undefined);
  assert.equal(oversized?.apps[0]?.id, "us.zoom.xos");
});

test("an icon arriving late is a change worth reporting", () => {
  const context = harness();
  context.watcher.start();
  context.emit('{"running":true,"apps":[{"id":"us.zoom.xos","name":"zoom.us"}]}\n');
  context.emit('{"running":true,"apps":[{"id":"us.zoom.xos","name":"zoom.us","icon":"iVBOR"}]}\n');

  // The same app on the same device, but the panel now has something to draw
  // for it — so the row has to be told.
  assert.equal(context.readings.length, 2);
  assert.equal(context.readings[1]?.apps[0]?.icon, "iVBOR");
});

test("the unavailable line is not an empty list", () => {
  assert.equal(microphoneReadingFromLine('{"unavailable":true}'), undefined);
  assert.deepEqual(microphoneReadingFromLine(IDLE), { running: false, apps: [] });
});

test("Luke's own identifiers are handed to the helper to drop", () => {
  const context = harness();
  context.watcher.start();

  // He holds the device for the length of a conversation rather than a turn,
  // so without these his own call reads as one the developer joined.
  assert.deepEqual(context.prefixes, [[...LUKE_BUNDLE_PREFIXES]]);
  assert.ok(LUKE_BUNDLE_PREFIXES.includes("dev.reviewstage.luke"));
});

test("the microphone is unreadable until the helper says otherwise", () => {
  const context = harness();
  assert.equal(context.watcher.reading, undefined);

  context.watcher.start();
  assert.deepEqual(context.readings, []);

  context.watcher.stop();
});

test("a reading survives being split across chunks", () => {
  const context = harness();
  context.watcher.start();
  context.emit(`${IDLE}\n{"running":true,"apps":[{"id":"us.zoo`);

  assert.equal(context.readings.length, 1);

  context.emit('m.xos","name":"zoom.us"}]}\n');
  assert.equal(context.readings.length, 2);
  assert.deepEqual(context.readings[1]?.apps, [{ id: "us.zoom.xos", name: "zoom.us" }]);
});

test("only a change is reported, however often the helper says it", () => {
  const context = harness();
  context.watcher.start();
  context.emit(`${IDLE}\n${IDLE}\n${ZOOM}\n${ZOOM}\n`);

  assert.equal(context.readings.length, 2);
});

test("a helper that dies mid-call gives the call up with it", () => {
  const context = harness();
  context.watcher.start();
  context.emit(`${ZOOM}\n`);
  context.die();

  assert.equal(context.readings.length, 2);
  assert.equal(context.readings[1], undefined);
  assert.deepEqual(context.diagnostics, ["the helper stopped answering"]);
});

test("a helper that cannot be spawned leaves the microphone unreadable", () => {
  const context = harness({ refuseToSpawn: true });
  context.watcher.start();

  assert.equal(context.spawns(), 1);
  assert.equal(context.watcher.reading, undefined);
  // The one failure that reports itself by producing no output whatsoever, so
  // the reason has to be given here or nowhere.
  assert.equal(context.diagnostics.length, 1);
  assert.match(context.diagnostics[0] ?? "", /could not be started/);
});

test("stopping is the app's own doing and is not the microphone going quiet", () => {
  const context = harness();
  context.watcher.start();
  context.emit(`${ZOOM}\n`);
  context.watcher.stop();
  context.die();
  context.emit(`${IDLE}\n`);

  assert.equal(context.killed(), true);
  assert.equal(context.readings.length, 1);
  assert.deepEqual(context.diagnostics, []);
});
