// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppStateDelivery, AppStateSnapshot } from "@luke/host/app-state";
import { TRANSCRIPT_SPEAKER } from "@luke/live";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { deliveryOf, stateWith } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { useAppState } from "./use-app-state.js";

/**
 * use-app-state.test.ts -- what a window's readers hold across deliveries of
 * the document: each delivery is a new tree, as it is after crossing into the
 * window, and what a reader holds of a slice the delivery did not move is the
 * object it already held.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/**
 * A window reading the document through `useAppState`, first answered
 * `first`; what it answers is each snapshot the reader drew, a door to
 * deliver the next one whole, and one to push a delivery of what moved as
 * main's stream would, a new tree each time.
 */
async function window(first: AppStateSnapshot): Promise<{
  drawn: AppStateSnapshot[];
  deliver: (snapshot: AppStateSnapshot) => Promise<void>;
  push: (delivery: AppStateDelivery) => Promise<void>;
}> {
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  fakeAppBridge({
    requestAppState: () => Promise.resolve(structuredClone(first)),
    onAppState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const drawn: AppStateSnapshot[] = [];
  function Reader(): null {
    const state = useAppState();
    if (state) drawn.push(state);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Reader))));
  await settle();
  return {
    drawn,
    deliver: async (snapshot) => {
      act(() => {
        for (const listener of listeners) listener(structuredClone(deliveryOf(snapshot)));
      });
      await settle();
    },
    push: async (delivery) => {
      act(() => {
        for (const listener of listeners) listener(structuredClone(delivery));
      });
      await settle();
    },
  };
}

test("a delivery that moves only the settings leaves every other slice the object the window already held", async () => {
  const first = stateWith({}, {});
  const { drawn, deliver } = await window(first);
  const held = drawn.at(-1);

  const moved = stateWith(experimentsOn(EXPERIMENT.CODE_REVIEW), { version: 2 });
  await deliver(moved);
  const now = drawn.at(-1);

  assert.ok(held && now);
  assert.notEqual(now, held, "the window draws the delivery");
  assert.deepEqual(now, moved);
  assert.notEqual(now.settings, held.settings);
  assert.equal(now.tasks, held.tasks);
  assert.equal(now.inbox, held.inbox);
  assert.equal(now.run, held.run);
  assert.equal(
    now.settings?.status,
    held.settings?.status,
    "inside the settings, too, what did not move is what was held",
  );
});

test("a delivery naming one slice replaces that slice alone, and every slice it does not name is the object the window already held", async () => {
  const first = stateWith({}, {});
  const { drawn, push } = await window(first);
  const held = drawn.at(-1);

  await push({ version: 2, entries: { network: { online: false } } });
  const now = drawn.at(-1);

  assert.ok(held && now);
  assert.deepEqual(now, { ...first, version: 2, network: { online: false } });
  assert.equal(now.settings, held.settings);
  assert.equal(now.tasks, held.tasks);
  assert.equal(now.voice, held.voice);
  assert.equal(now.inbox, held.inbox);
  assert.equal(now.window, held.window);
});

test("a call's transcript is laid over the lines held, its lines before the change the objects the window held", async () => {
  const line = (rowId: string, words: string) => ({
    rowId,
    speaker: TRANSCRIPT_SPEAKER.USER,
    words,
    startMs: 0,
    endMs: 100,
  });
  const first = stateWith(
    {},
    {
      callTranscript: { voiceSessionId: "session-1", lines: [line("row-1", "Invite")] },
    },
  );
  const { drawn, push } = await window(first);
  const held = drawn.at(-1);

  await push({
    version: 2,
    entries: {},
    callTranscript: { voiceSessionId: "session-1", from: 1, lines: [line("row-2", "by email")] },
  });
  const now = drawn.at(-1);

  assert.ok(held && now);
  assert.deepEqual(now.callTranscript, {
    voiceSessionId: "session-1",
    lines: [line("row-1", "Invite"), line("row-2", "by email")],
  });
  assert.equal(now.callTranscript?.lines[0], held.callTranscript?.lines[0]);
  assert.equal(now.tasks, held.tasks);
});

test("a delivery older than the document held is dropped", async () => {
  const first = stateWith({}, { version: 3 });
  const { drawn, push } = await window(first);
  const held = drawn.at(-1);

  await push({ version: 2, entries: { network: { online: false } } });
  assert.equal(drawn.at(-1), held);
});
