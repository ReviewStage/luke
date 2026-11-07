// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { useQuery } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { deliveryOf, signedInAs, stateWith } from "./testing/app-state.js";
import { readAppState, testQueryClientNow, withQueryClient } from "./testing/copy-feedback.js";
import { appStateQuery } from "./use-app-state.js";

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
  vi.restoreAllMocks();
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/**
 * A window reading the document through `useQuery(appStateQuery)`, first answered
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
    const state = useQuery(appStateQuery).data;
    if (state) drawn.push(state);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(withQueryClient(createElement(Reader))));
  await vi.waitFor(() => expect(drawn.length > 0).toBe(true));
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

  const moved = stateWith(experimentsOn(EXPERIMENT.SKILLS), { version: 2 });
  await deliver(moved);
  await vi.waitFor(() => expect(drawn.at(-1) === held).toBe(false));
  const now = drawn.at(-1);

  assert.ok(held && now);
  assert.notEqual(now, held, "the window draws the delivery");
  assert.deepEqual(now, moved);
  assert.notEqual(now.settings, held.settings);
  assert.equal(now.tasks, held.tasks);
  assert.equal(now.inbox, held.inbox);
  assert.equal(now.run, held.run);
  assert.equal(
    now.settings?.stored,
    held.settings?.stored,
    "inside the settings, too, what did not move is what was held",
  );
});

test("a delivery naming one slice replaces that slice alone, and every slice it does not name is the object the window already held", async () => {
  const first = stateWith({}, {});
  const { drawn, push } = await window(first);
  const held = drawn.at(-1);

  await push({ version: 2, entries: { network: { online: false, reachable: true } } });
  await vi.waitFor(() => expect(drawn.at(-1) === held).toBe(false));
  const now = drawn.at(-1);

  assert.ok(held && now);
  assert.deepEqual(now, { ...first, version: 2, network: { online: false, reachable: true } });
  assert.equal(now.settings, held.settings);
  assert.equal(now.tasks, held.tasks);
  assert.equal(now.audio, held.audio);
  assert.equal(now.inbox, held.inbox);
  assert.equal(now.window, held.window);
});

test("a delivery older than the document held is dropped", async () => {
  const first = stateWith({}, { version: 3 });
  const { drawn, push } = await window(first);
  const held = drawn.at(-1);

  await push({ version: 2, entries: { network: { online: false, reachable: true } } });
  assert.equal(drawn.at(-1), held);
});

test("a delivery heard after the window's second read is refused asks for the whole document again, rather than laying itself over the document an earlier read left", async () => {
  const before = signedInAs({ id: "user-ada", email: "ada@example.com", name: "Ada" });
  const after = {
    ...signedInAs({ id: "user-bo", email: "bo@example.com", name: "Bo" }),
    version: 3,
    network: { online: false, reachable: true },
  };
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  const answers = [
    () => Promise.resolve(before),
    () => Promise.reject(new Error("gone")),
    () => Promise.resolve(after),
  ];
  let reads = 0;
  fakeAppBridge({
    requestAppState: () => {
      reads += 1;
      return answers[reads - 1]?.() ?? Promise.resolve(after);
    },
    onAppState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await readAppState();
  root = createRoot(document.createElement("div"));
  act(() => root?.render(withQueryClient(createElement("div"))));
  await settle();

  // The account moved on main while the window could not read it, so this delivery was built on Bo's document, not Ada's.
  act(() => {
    for (const listener of listeners) {
      listener({ version: 3, entries: { network: { online: false, reachable: true } } });
    }
  });
  await settle();

  assert.equal(reads, 3, "the delivery asked for the whole document again");
  assert.deepEqual(testQueryClientNow().getQueryData(appStateQuery.queryKey), after);
});
