// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { KnownNames } from "@luke/features/place-chip-model";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { useKnownNames } from "./use-known-names.js";

/**
 * use-known-names.test.ts -- every chip of a window reads the one set of
 * names main's document holds: two readers of the same document are handed
 * the same names, a delivery that moves neither the tasks nor the Inbox
 * hands them those names again, and one that adds a task hands them new
 * names naming it. Synthetic tasks.
 */

const AT = 1_792_000_000_000;

const INVITES: TaskSummary = {
  id: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

const BILLING: TaskSummary = {
  ...INVITES,
  id: "8a1d2c3b-4e5f-4a6b-9c7d-0e1f2a3b4c5d",
  name: "Usage billing",
};

/** Main's document holding `tasks`. */
function holding(tasks: readonly TaskSummary[], version: number): AppStateSnapshot {
  return { ...stateWith({}, { tasks: { ...IDLE_TASKS_VIEW, tasks: [...tasks] } }), version };
}

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
  document.body.innerHTML = "";
});

/** What each of two readers was last handed, and a way to deliver the window a new document. */
async function twoReaders(first: AppStateSnapshot): Promise<{
  readonly seen: Map<string, KnownNames>;
  readonly deliver: (next: AppStateSnapshot) => Promise<void>;
}> {
  const listeners = new Set<(snapshot: AppStateSnapshot) => void>();
  fakeAppBridge({
    onAppState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestAppState: () => Promise.resolve(first),
  });
  const seen = new Map<string, KnownNames>();
  function Reader({ name }: { name: string }): null {
    seen.set(name, useKnownNames());
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(Reader, { name: "one" }),
          createElement(Reader, { name: "two" }),
        ),
      ),
    ),
  );
  await settle();
  const deliver = async (next: AppStateSnapshot) => {
    act(() => {
      for (const listener of listeners) listener(next);
    });
    await settle();
  };
  return { seen, deliver };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("two readers of the same document are handed the same names", async () => {
  const { seen } = await twoReaders(holding([INVITES], 1));
  const one = seen.get("one");
  assert.equal(one?.tasks.get(INVITES.id), "Teammate invitations");
  assert.equal(seen.get("two"), one);
});

test("a delivery that keeps the tasks and the Inbox hands each reader the names it held", async () => {
  const first = holding([INVITES], 1);
  const { seen, deliver } = await twoReaders(first);
  const held = seen.get("one");
  await deliver({ ...first, version: 2, network: { online: false } });
  assert.equal(seen.get("one"), held);
  assert.equal(seen.get("two"), held);
});

test("a task added hands every reader new names that name it", async () => {
  const { seen, deliver } = await twoReaders(holding([INVITES], 1));
  const held = seen.get("one");
  await deliver(holding([INVITES, BILLING], 2));
  const one = seen.get("one");
  assert.notEqual(one, held);
  assert.equal(one?.tasks.get(BILLING.id), "Usage billing");
  assert.equal(seen.get("two"), one);
});
