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

test("a helper that cannot be spawned leaves the exchange unharmed", () => {
  const context = harness({
    spawns: [
      () => {
        throw new Error("no helper on this platform");
      },
    ],
  });
  context.controller.setEnabled(true);

  context.controller.setExchangeActive(true);
  context.controller.setExchangeActive(false);

  assert.deepEqual(context.commands, []);
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
