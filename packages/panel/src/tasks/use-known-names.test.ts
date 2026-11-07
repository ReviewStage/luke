// @vitest-environment jsdom

import { AGENT_STATUS } from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import type { KnownNames } from "@repo/features/place-chip-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { deliveryOf, stateWith } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { MentionedAgents } from "./mentioned-place.js";
import { useKnownNames, useWordTargets } from "./use-known-names.js";

/**
 * use-known-names.test.ts -- every chip of a window reads the one set of
 * names main's document holds: two readers of the same document are handed
 * the same names, a delivery that moves neither the tasks nor the Inbox
 * hands them those names again, and one that adds a task hands them new
 * names naming it; the tasks' keys, likewise, are handed again until a key
 * changes, whatever else about a task moves; and an untitled agent is named
 * by the catalog around the reader. Synthetic tasks.
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
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
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
      withQueryClient(
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
  await vi.waitFor(() =>
    expect(seen.get("one")?.tasks.get(INVITES.id)).toBe("Teammate invitations"),
  );
});

test("a task added hands every reader new names that name it", async () => {
  const { seen, deliver } = await twoReaders(holding([INVITES], 1));
  await deliver(holding([INVITES, BILLING], 2));
  await vi.waitFor(() => expect(seen.get("one")?.tasks.get(BILLING.id)).toBe("Usage billing"));
});

test("the tasks' keys are handed again for a delivery that moves no key, and anew for one that adds a numbered task", async () => {
  const acme = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: "owner",
    github: null,
  } as const;
  const numbered = (task: TaskSummary, number: number): TaskSummary => ({ ...task, number });
  const listing = (tasks: readonly TaskSummary[], version: number): AppStateSnapshot => ({
    ...stateWith({}, { tasks: { ...IDLE_TASKS_VIEW, workspaces: [acme], tasks: [...tasks] } }),
    version,
  });
  const listeners = new Set<(snapshot: AppStateSnapshot) => void>();
  fakeAppBridge({
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestAppState: () => Promise.resolve(listing([numbered(INVITES, 41)], 1)),
  });
  const seen: ReadonlyMap<string, string>[] = [];
  function Reader(): null {
    seen.push(useWordTargets());
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(withQueryClient(createElement(Reader))));
  await settle();
  const deliver = async (next: AppStateSnapshot) => {
    act(() => {
      for (const listener of listeners) listener(next);
    });
    await settle();
  };
  await vi.waitFor(() => expect([...(seen.at(-1)?.keys() ?? [])]).toEqual(["ACME-41"]));

  await deliver(listing([{ ...numbered(INVITES, 41), name: "Invites", updatedAt: AT + 1 }], 2));

  await deliver(listing([numbered(INVITES, 41), numbered(BILLING, 42)], 3));
  await vi.waitFor(() => expect([...(seen.at(-1)?.keys() ?? [])]).toEqual(["ACME-41", "ACME-42"]));
});

test("an untitled agent is named by the catalog around the reader, as its tab and its row in the @ list name it", async () => {
  const agentId = "5b2e7c1d-3a4f-4e6b-8c9d-0a1b2c3d4e5f";
  const model = "openai/gpt-6.1-sol";
  const task: TaskSummary = {
    ...INVITES,
    agents: { total: 1, working: 1, pullRequestTotal: 0 },
  };
  const held = holding([task], 1);
  // The task's agent, as the list followed live holds it.
  const followed = {
    id: agentId,
    planId: task.id,
    title: null,
    model,
    effort: "high",
    status: AGENT_STATUS.RUNNING,
    createdAt: AT,
    turnId: null,
    workspaceId: task.workspaceId,
    repository: task.repository,
  };
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () =>
      Promise.resolve({ ...held, tasks: { ...held.tasks, taskAgents: [followed] } }),
  });
  let seen: KnownNames | undefined;
  function Reader(): null {
    seen = useKnownNames();
    return null;
  }
  const models = [
    { id: model, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["high"] },
  ];
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      withQueryClient(
        createElement(MentionedAgents, {
          value: { models, me: undefined },
          children: createElement(Reader),
        }),
      ),
    ),
  );
  await vi.waitFor(() => expect(seen?.agents.get(agentId)).toBe("GPT-6.1 Sol"));
});
