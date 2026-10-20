import assert from "node:assert/strict";
import { it } from "vitest";
import type { AppStateSnapshot } from "../app-state.js";
import { initialAppState } from "../client/app-state-store.js";
import { PUSH, type PushEvent } from "../contract/index.js";
import { runModeFor } from "../run-mode.js";
import { WindowPushes } from "./push-procedures.js";

/**
 * What a window's push stream sends: every event in the order main pushed
 * it, and the document latest-wins, so a reader that falls behind reads the
 * newest document next and never one older than an event it already heard.
 */

const WINDOW = Symbol("window");

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

function documentAt(version: number): AppStateSnapshot {
  return { ...initialAppState(RUN, true, []), version, window: { fullScreen: false } };
}

/** What one read of a stream carried, a document by its version. */
function heard(read: IteratorResult<PushEvent>): number | string | undefined {
  if (read.done) return undefined;
  return read.value.push === PUSH.APP_STATE ? read.value.payload.version : read.value.push;
}

it("three documents pushed before a slow reader reads are one delivery, the third", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  for (const version of [1, 2, 3]) pushes.push(WINDOW, PUSH.APP_STATE, documentAt(version));
  pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-1" });

  assert.equal(heard(await stream.next()), 3);
  // Nothing else was held for it: the next read is the event pushed after.
  assert.equal(heard(await stream.next()), PUSH.SHOW_TASK);
});

it("every event is sent in order, each after a document at least as new as the one pushed before it", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  pushes.push(WINDOW, PUSH.APP_STATE, documentAt(1));
  pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-1" });
  pushes.push(WINDOW, PUSH.APP_STATE, documentAt(2));
  pushes.push(WINDOW, PUSH.MENU_COMMAND, "settings");
  const reads = [await stream.next(), await stream.next(), await stream.next()].map(heard);
  pushes.push(WINDOW, PUSH.APP_STATE, documentAt(3));

  assert.deepEqual(reads, [2, PUSH.SHOW_TASK, PUSH.MENU_COMMAND]);
  // A document pushed once the last was sent is sent in its own turn.
  assert.equal(heard(await stream.next()), 3);
});

it("each stream of a reloading window keeps its own unsent document", async () => {
  const pushes = new WindowPushes();
  const before = pushes.stream(WINDOW, undefined);
  pushes.push(WINDOW, PUSH.APP_STATE, documentAt(1));
  assert.equal(heard(await before.next()), 1);
  const after = pushes.stream(WINDOW, undefined);
  pushes.push(WINDOW, PUSH.APP_STATE, documentAt(2));

  assert.equal(heard(await after.next()), 2);
  assert.equal(heard(await before.next()), 2);
  await before.return?.(undefined);
  await after.return?.(undefined);
  assert.equal(pushes.listening(WINDOW), false);
});
