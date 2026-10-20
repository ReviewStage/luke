// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { stateWith } from "./testing/app-state.js";
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
 * `first`; what it answers is each snapshot the reader drew, and a door to
 * deliver the next one as main would, a new tree each time.
 */
async function window(first: AppStateSnapshot): Promise<{
  drawn: AppStateSnapshot[];
  deliver: (snapshot: AppStateSnapshot) => Promise<void>;
}> {
  const listeners = new Set<(snapshot: AppStateSnapshot) => void>();
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
        for (const listener of listeners) listener(structuredClone(snapshot));
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
