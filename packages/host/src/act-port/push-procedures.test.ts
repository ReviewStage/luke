import assert from "node:assert/strict";
import { it } from "vitest";
import type { AppStateDelivery, AppStateSnapshot } from "../app-state.js";
import { initialAppState } from "../client/app-state-store.js";
import { PUSH, type PushEvent } from "../contract/index.js";
import { runModeFor } from "../run-mode.js";
import { WindowPushes } from "./push-procedures.js";

/**
 * What a window's push stream sends: every event in the order main pushed
 * it, and the document latest-wins, so a reader that falls behind reads the
 * newest document next and never one older than an event it already heard;
 * and of each document, only what moved since the one it last sent.
 */

const WINDOW = Symbol("window");

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

/** The document at `version`, whose coding agents' unseen dots move with it, so every version moves a slice. */
function documentAt(version: number): AppStateSnapshot {
  return {
    ...initialAppState(RUN, true, []),
    version,
    codingAgents: { unseen: [`agent-${version}`] },
    window: { fullScreen: false },
  };
}

/** What one read of a stream carried, a document by its version. */
function heard(read: IteratorResult<PushEvent>): number | string | undefined {
  if (read.done) return undefined;
  return read.value.push === PUSH.APP_STATE ? read.value.payload.version : read.value.push;
}

it("three documents pushed before a slow reader reads are one delivery, the third", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  for (const version of [1, 2, 3]) pushes.pushState(WINDOW, documentAt(version));
  pushes.push(WINDOW, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });

  assert.equal(heard(await stream.next()), 3);
  // Nothing else was held for it: the next read is the event pushed after.
  assert.equal(heard(await stream.next()), PUSH.SHOW_AGENT);
});

it("every event is sent in order, each after a document at least as new as the one pushed before it", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  pushes.pushState(WINDOW, documentAt(1));
  pushes.push(WINDOW, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });
  pushes.pushState(WINDOW, documentAt(2));
  pushes.push(WINDOW, PUSH.MENU_COMMAND, "settings");
  const reads = [await stream.next(), await stream.next(), await stream.next()].map(heard);
  pushes.pushState(WINDOW, documentAt(3));

  assert.deepEqual(reads, [2, PUSH.SHOW_AGENT, PUSH.MENU_COMMAND]);
  // A document pushed once the last was sent is sent in its own turn.
  assert.equal(heard(await stream.next()), 3);
});

it("each stream of a reloading window keeps its own unsent document", async () => {
  const pushes = new WindowPushes();
  const before = pushes.stream(WINDOW, undefined);
  pushes.pushState(WINDOW, documentAt(1));
  assert.equal(heard(await before.next()), 1);
  const after = pushes.stream(WINDOW, undefined);
  pushes.pushState(WINDOW, documentAt(2));

  assert.equal(heard(await after.next()), 2);
  assert.equal(heard(await before.next()), 2);
  await before.return?.(undefined);
  await after.return?.(undefined);
  assert.equal(pushes.listening(WINDOW), false);
});

it("a held window's reload stays held, and its release sends the newest document to the new page", async () => {
  const pushes = new WindowPushes();
  pushes.holdState(WINDOW, true);
  const page = pushes.stream(WINDOW, undefined);
  pushes.pushState(WINDOW, documentAt(1));
  pushes.pushState(WINDOW, documentAt(2));
  let read: number | string | undefined;
  const reading = page.next().then((result) => {
    read = heard(result);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read, undefined);

  pushes.holdState(WINDOW, false);
  await reading;
  assert.equal(read, 2);
  await page.return?.(undefined);
});

it("a document queued but unread as its window is held waits for the release, and goes out once", async () => {
  const pushes = new WindowPushes();
  const page = pushes.stream(WINDOW, undefined);
  pushes.push(WINDOW, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });
  pushes.pushState(WINDOW, documentAt(1));
  pushes.holdState(WINDOW, true);
  pushes.pushState(WINDOW, documentAt(2));
  assert.equal(heard(await page.next()), PUSH.SHOW_AGENT);
  let read: number | string | undefined;
  const reading = page.next().then((result) => {
    read = heard(result);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read, undefined);

  pushes.holdState(WINDOW, false);
  await reading;
  assert.equal(read, 2);
  pushes.push(WINDOW, PUSH.MENU_COMMAND, "settings");
  // Nothing else was queued for it: the next read is the event pushed after.
  assert.equal(heard(await page.next()), PUSH.MENU_COMMAND);
  await page.return?.(undefined);
});

it("an event pushed to a held window goes out behind the document held before it", async () => {
  const pushes = new WindowPushes();
  const page = pushes.stream(WINDOW, undefined);
  pushes.pushState(WINDOW, documentAt(1));
  pushes.holdState(WINDOW, true);
  pushes.pushState(WINDOW, documentAt(2));
  pushes.push(WINDOW, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });

  const reads = [await page.next(), await page.next()].map(heard);
  assert.deepEqual(reads, [2, PUSH.SHOW_AGENT]);
  await page.return?.(undefined);
});

/** What the next read of a stream carried, as the delivery of a document it must be. */
async function delivered(stream: AsyncIteratorObject<PushEvent>): Promise<AppStateDelivery> {
  const read = await stream.next();
  if (read.done || read.value.push !== PUSH.APP_STATE) throw new Error("no document was sent");
  return read.value.payload;
}

it("a stream's first document names every entry, and each after it names only the slices that moved", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  const first = documentAt(1);
  pushes.pushState(WINDOW, first);
  assert.deepEqual(
    Object.keys((await delivered(stream)).entries).sort(),
    Object.keys(first)
      .filter((entry) => entry !== "version")
      .sort(),
  );

  pushes.pushState(WINDOW, { ...first, version: 2, network: { online: false } });
  assert.deepEqual(await delivered(stream), {
    version: 2,
    entries: { network: { online: false } },
  });
});

it("a document replaced unsent takes nothing it moved with it: the one sent names both", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  const first = documentAt(1);
  pushes.pushState(WINDOW, first);
  await delivered(stream);

  const offline = { ...first, version: 2, network: { online: false } };
  pushes.pushState(WINDOW, offline);
  pushes.pushState(WINDOW, { ...offline, version: 3, codingAgents: { unseen: [] } });
  assert.deepEqual(await delivered(stream), {
    version: 3,
    entries: { network: { online: false }, codingAgents: { unseen: [] } },
  });
});

it("a document in which nothing the window is handed moved is not sent", async () => {
  const pushes = new WindowPushes();
  const stream = pushes.stream(WINDOW, undefined);
  const first = documentAt(1);
  pushes.pushState(WINDOW, first);
  await delivered(stream);

  pushes.pushState(WINDOW, { ...first, version: 2 });
  pushes.push(WINDOW, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });
  assert.equal(heard(await stream.next()), PUSH.SHOW_AGENT);
});
