import assert from "node:assert/strict";
import test from "node:test";
import { MediaDuckController, type MediaDuckProcess } from "./media-duck";

/** Short enough to wait out for real, long enough to act inside of. */
const RELEASE_DELAY_MS = 40;

interface Harness {
  controller: MediaDuckController;
  /** Every line written to every helper, in order, newlines stripped. */
  commands: string[];
  spawns: () => number;
  stdinEnded: () => boolean;
  die: () => void;
}

function harness(options: { spawns?: (() => MediaDuckProcess | undefined)[] } = {}): Harness {
  const commands: string[] = [];
  let spawned = 0;
  let ended = false;
  const exits: (() => void)[] = [];

  const spawnHelper = (): MediaDuckProcess | undefined => {
    const scripted = options.spawns?.[spawned];
    spawned += 1;
    if (scripted) return scripted();
    return {
      stdin: {
        write: (chunk: string) => commands.push(chunk.trim()),
        end: () => {
          ended = true;
        },
      },
      on: (event, listener) => {
        if (event === "exit") exits.push(listener);
      },
      removeAllListeners: () => {
        exits.length = 0;
      },
    };
  };

  return {
    controller: new MediaDuckController({ spawnHelper, releaseDelayMs: RELEASE_DELAY_MS }),
    commands,
    spawns: () => spawned,
    stdinEnded: () => ended,
    die: () => {
      for (const exit of [...exits]) exit();
    },
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RELEASE_DELAY_MS * 2));
}

test("an exchange ducks at once and restores only after the hangover", async () => {
  const context = harness();
  context.controller.setEnabled(true);

  context.controller.setExchangeActive(true);
  assert.deepEqual(context.commands, ["duck"]);

  context.controller.setExchangeActive(false);
  // The reply just ended; the players stay down through the pause a follow-up
  // question would arrive in.
  assert.deepEqual(context.commands, ["duck"]);

  await settle();
  assert.deepEqual(context.commands, ["duck", "restore"]);
});

test("a turn beginning inside the hangover keeps the duck held", async () => {
  const context = harness();
  context.controller.setEnabled(true);

  context.controller.setExchangeActive(true);
  context.controller.setExchangeActive(false);
  context.controller.setExchangeActive(true);
  await settle();

  // Neither a restore — the conversation never stopped — nor a second duck,
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // which would read the ducked volume back as the one to restore to.
  assert.deepEqual(context.commands, ["duck"]);

  context.controller.setExchangeActive(false);
  await settle();
  assert.deepEqual(context.commands, ["duck", "restore"]);
});

test("disabled, an exchange never touches the helper at all", async () => {
  const context = harness();
  context.controller.setEnabled(false);

  context.controller.setExchangeActive(true);
  context.controller.setExchangeActive(false);
  await settle();

  assert.equal(context.spawns(), 0);
  assert.deepEqual(context.commands, []);
});

test("turning the setting off mid-duck restores at once, without the hangover", () => {
  const context = harness();
  context.controller.setEnabled(true);
  context.controller.setExchangeActive(true);

  context.controller.setEnabled(false);

  // The hangover exists so a conversation does not pump; this is not a pause
  // in a conversation but the user asking for their volume back.
  assert.deepEqual(context.commands, ["duck", "restore"]);
});

test("enabling mid-exchange ducks the exchange already underway", () => {
  const context = harness();
  context.controller.setExchangeActive(true);
  assert.deepEqual(context.commands, []);

  context.controller.setEnabled(true);
  assert.deepEqual(context.commands, ["duck"]);
});

test("a helper that dies is replaced for the next exchange", async () => {
  const context = harness();
  context.controller.setEnabled(true);
  context.controller.setExchangeActive(true);
  context.die();

  // The dead helper took its memory of the volumes with it; nothing is owed a
  // restore, and the next exchange starts fresh.
  context.controller.setExchangeActive(false);
  await settle();
  assert.deepEqual(context.commands, ["duck"]);

  context.controller.setExchangeActive(true);
  assert.equal(context.spawns(), 2);
  assert.deepEqual(context.commands, ["duck", "duck"]);
});

test("enabling spawns the listening helper before any exchange", () => {
  const context = harness();
  context.controller.setEnabled(true);

  // The helper is up so it can hear the players' play-state broadcasts, but
  // nothing has asked for quiet, so nothing is written to it.
  assert.equal(context.spawns(), 1);
  assert.deepEqual(context.commands, []);
});

test("a helper that cannot be spawned leaves the exchange unharmed", () => {
  const failure = () => {
    throw new Error("no helper on this platform");
  };
  // Enabling tries the spawn once for the listener, and the duck once more.
  const context = harness({ spawns: [failure, failure] });
  context.controller.setEnabled(true);

  context.controller.setExchangeActive(true);
  context.controller.setExchangeActive(false);

  assert.equal(context.spawns(), 2);
  assert.deepEqual(context.commands, []);
});

test("a duck write that throws drops the helper, and the next exchange starts fresh", () => {
  const context = harness({
    spawns: [
      () => ({
        stdin: {
          write: () => {
            throw new Error("broken pipe");
          },
          end: () => undefined,
        },
        on: () => undefined,
        removeAllListeners: () => undefined,
      }),
    ],
  });
  context.controller.setEnabled(true);

  // The helper's pipe was already gone, so this exchange loses its quiet —
  // like a helper that died mid-duck — but nothing throws and nothing sticks.
  context.controller.setExchangeActive(true);
  assert.equal(context.spawns(), 1);

  context.controller.setExchangeActive(false);
  context.controller.setExchangeActive(true);
  assert.equal(context.spawns(), 2);
  assert.deepEqual(context.commands, ["duck"]);
});

test("a restore write that throws costs nothing but the dead helper", async () => {
  const written: string[] = [];
  const context = harness({
    spawns: [
      () => ({
        stdin: {
          write: (chunk: string) => {
            const command = chunk.trim();
            if (command === "restore") throw new Error("broken pipe");
            written.push(command);
          },
          end: () => undefined,
        },
        on: () => undefined,
        removeAllListeners: () => undefined,
      }),
    ],
  });
  context.controller.setEnabled(true);
  context.controller.setExchangeActive(true);
  context.controller.setExchangeActive(false);
  await settle();
  assert.deepEqual(written, ["duck"]);

  // The helper died owing a restore it can no longer deliver — its memory of
  // the volumes died with it — and the next exchange gets a fresh helper
  // rather than the broken pipe.
  context.controller.setExchangeActive(true);
  assert.equal(context.spawns(), 2);
  assert.deepEqual(context.commands, ["duck"]);
});

test("stopping a controller whose pipe already broke does not throw", () => {
  const context = harness({
    spawns: [
      () => ({
        stdin: {
          write: () => undefined,
          end: () => {
            throw new Error("already closed");
          },
        },
        on: () => undefined,
        removeAllListeners: () => undefined,
      }),
    ],
  });
  context.controller.setEnabled(true);
  context.controller.setExchangeActive(true);

  context.controller.stop();
});

test("stopping closes stdin rather than writing, and writes nothing after", async () => {
  const context = harness();
  context.controller.setEnabled(true);
  context.controller.setExchangeActive(true);

  context.controller.stop();

  // Stdin closing is itself the restore request — the helper brings the
  // players back up on EOF — so a written restore would say it twice.
  assert.equal(context.stdinEnded(), true);
  await settle();
  assert.deepEqual(context.commands, ["duck"]);
});
