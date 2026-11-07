// @vitest-environment jsdom

import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { AGENT_STATUS, type AgentPage } from "@repo/features/agent-wire";
import { LINK_PLACE, type ReadLink, readLink } from "@repo/features/link-grammar";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { PUSH_METHOD } from "@repo/host/contract";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { createMemoryHistory } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
// Note that the Admin place is loaded as the window loads it, on first use
// (`admin-route.lazy.tsx`), so the module is read here first and its load settles
// within the test's own ticks rather than on a clock a busy machine outruns.
import "./desktop/admin-route.lazy.js";
import "./desktop/automations-route.lazy.js";
import "./desktop/board-route.lazy.js";
import "./desktop/person-route.lazy.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, stateWith } from "./testing/app-state.js";
import { onRegistry, settleQueries } from "./testing/copy-feedback.js";
import { type TestWindowRouter, windowRouter } from "./testing/window-router.js";

/**
 * app-admin-link.test.ts -- a link to the Admin place the system hands the
 * window, as a reload on an Admin address does, opens the place while the
 * account's access is still being read, the place waiting on that read, and
 * stands it once the account is an admin; the place gives the window back
 * once the read says it is not, and a link opened for an account known to be
 * no admin opens nothing. A person's page loaded under a workspace the
 * reader is not in, as a reload of another's address is, opens the same
 * person under the workspace listed, as a link to them does, and a link
 * to the Automations page, the Board, the Inbox, or an agent's page already
 * standing leaves it standing. An agent's link pressed in an Inbox item lands
 * in one step from it. A link to an Inbox item, however it was written, opens the item
 * at its own address.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** Main's document for a signed-in account in Acme, its access not yet read. */
const FIRST: AppStateSnapshot = stateWith(
  {},
  { tasks: { ...IDLE_TASKS_VIEW, workspaces: [ACME] }, access: { admin: false, pending: true } },
);

const ADMIN_LINK: ReadLink = {
  workspace: "acme",
  place: { kind: LINK_PLACE.ADMIN, section: "cost" },
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let listeners = new Set<(snapshot: AppStateSnapshot) => void>();
let showLink: ((link: ReadLink) => void) | undefined;
/** Main's document as the window first reads it. */
let first: AppStateSnapshot = FIRST;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  listeners = new Set();
  showLink = undefined;
  first = FIRST;
  fakeAppPlatform({
    ...QUIET_PANEL,
    applySessionReplay: () => undefined,
    adminDashboard: () => ({ href: "https://app.test/admin" }),
  });
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(first)),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onShowLink: (listener: (link: ReadLink) => void) => {
      showLink = listener;
      return () => {
        showLink = undefined;
      };
    },
  } satisfies Partial<AppBridge>);
  // Every act is refused, as a service that answers nothing would: the place stands all the same.
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
  });
  // Note that the window reads the account's access through Query, which tells its readers on its own queue.
  await settleQueries();
}

async function drawWindow(at?: string): Promise<TestWindowRouter> {
  const router = windowRouter(
    at === undefined ? undefined : createMemoryHistory({ initialEntries: [at] }),
  );
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(onRegistry(AtomRegistry.make(), router.drawn())));
  await settle();
  return router;
}

/** Delivers `snapshot` as main would, and lets the window draw what it draws. */
async function deliver(snapshot: AppStateSnapshot): Promise<void> {
  act(() => {
    for (const listener of listeners) listener(structuredClone(snapshot));
  });
  await settle();
}

/** Whether the Admin place stands, drawn or its loading frame, by the bar of its sections. */
function adminOpen(): boolean {
  return document.querySelector('[role="radiogroup"][aria-label="Admin sections"]') !== null;
}

/** Whether the Admin place stands drawn, its views under the recording's block, rather than its loading frame. */
function adminStands(): boolean {
  return document.querySelector(".desktop-main .ph-no-capture") !== null;
}

/** Whether the Admin place stands waiting on the account's access, its loading frame up. */
function adminWaits(): boolean {
  return adminOpen() && !adminStands();
}

test("an Admin link handed while the account's access is read opens the place waiting on it, which stands once the account is an admin", async () => {
  await drawWindow();
  act(() => showLink?.(ADMIN_LINK));
  await settle();
  assert.equal(adminWaits(), true, "the place waits on the read");

  await deliver({ ...FIRST, version: 2, access: { admin: true } });
  assert.equal(adminStands(), true, "the place stands once it is");
});

test("the place waiting on the read gives the window back once it says the account is no admin", async () => {
  await drawWindow();
  act(() => showLink?.(ADMIN_LINK));
  await settle();
  assert.equal(adminWaits(), true);

  await deliver({ ...FIRST, version: 2, access: { admin: false } });
  assert.equal(adminOpen(), false);
});

test("an Admin link handed to an account known to be no admin opens nothing", async () => {
  await drawWindow();
  await deliver({ ...FIRST, version: 2, access: { admin: false } });
  act(() => showLink?.(ADMIN_LINK));
  await settle();

  assert.equal(adminOpen(), false);
});

test("a person's page loaded under a workspace the reader is not in opens the same person under the workspace listed", async () => {
  const router = await drawWindow("/left/person/user-ada");
  await settle();

  assert.equal(router.history.location.pathname, "/acme/person/user-ada");
});

test.each([
  ["the Automations page", "/acme/automations", { kind: LINK_PLACE.AUTOMATIONS }],
  ["the Board", "/acme/tasks", { kind: LINK_PLACE.BOARD }],
  ["the Inbox", "/acme/inbox", { kind: LINK_PLACE.INBOX }],
  ["an Inbox item", "/acme/inbox/item-1", { kind: LINK_PLACE.INBOX_ITEM, itemId: "item-1" }],
  ["an agent's page", "/acme/agent/agent-9", { kind: LINK_PLACE.AGENT, agentId: "agent-9" }],
  [
    "a task's version",
    "/acme/task/7/version/3",
    { kind: LINK_PLACE.VERSION, planId: "7", revision: 3 },
  ],
] as const)(
  "a link to %s already standing leaves it standing, as pressing the place standing always has",
  async (_place, address, place) => {
    first = WITH_SEVEN;
    const router = await drawWindow(address);
    await settle();
    const steps = router.addresses().length;

    act(() => showLink?.({ workspace: "acme", place }));
    await settle();

    assert.equal(router.history.location.pathname, address);
    assert.equal(router.addresses().length, steps, "and writes no step");
  },
);

test.each([
  ["under the agent that posted it", "https://vespin.dev/acme/agent/agent-1/inbox/item-1"],
  ["under its task, as links once were", "https://vespin.dev/acme/task/42/inbox/item-1"],
  ["by its id alone", "https://vespin.dev/acme/inbox/item-1"],
] as const)(
  "a link to an Inbox item written %s opens the Inbox on it at the item's own address",
  async (_spelling, written) => {
    const router = await drawWindow();
    const link = readLink(written) ?? assert.fail("the link reads");

    act(() => showLink?.(link));
    await settle();

    assert.equal(router.history.location.pathname, "/acme/inbox/item-1");
  },
);

test("a link to the Inbox written before its channels were removed opens the Inbox's list", async () => {
  const router = await drawWindow();
  const link = readLink("https://vespin.dev/acme/channel/c1") ?? assert.fail("the link reads");

  act(() => showLink?.(link));
  await settle();

  assert.equal(router.history.location.pathname, "/acme/inbox");
});

/** Acme's task numbered 7, as the account's list carries it. */
const ACME_SEVEN = {
  id: "7a0b1c2d-0000-4000-8000-000000000007",
  workspaceId: ACME.id,
  number: 7,
  name: "Relay retries",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
};

/** Main's document listing Acme's task numbered 7, its access read and Descriptions on, whose version history stands. */
const WITH_SEVEN: AppStateSnapshot = stateWith(experimentsOn(EXPERIMENT.DESCRIPTIONS), {
  tasks: { ...IDLE_TASKS_VIEW, workspaces: [ACME], tasks: [ACME_SEVEN] },
  access: { admin: false },
});

/** Every act the window asks, by its kind and payload, each refused as a service answering nothing would. */
function actsAsked(): { readonly kind: string; readonly payload?: unknown }[] {
  const asked: { readonly kind: string; readonly payload?: unknown }[] = [];
  fakeActPortAnswering((request) => {
    asked.push(request);
    return Promise.reject(refusedOnPort("Not here."));
  });
  return asked;
}

test("a version history loaded under a workspace the reader is not in opens no task of theirs that has the same number", async () => {
  const asked = actsAsked();
  first = WITH_SEVEN;
  const router = await drawWindow("/someone-elses/task/7/versions");

  const selected = asked.filter((act) => act.kind === ACT_KIND.TASKS_SELECT);
  assert.ok(
    selected.every((act) => !isDeepStrictEqual(act.payload, { taskId: ACME_SEVEN.id })),
    `Acme's own task numbered 7 does not open: ${router.history.location.pathname}`,
  );
});

test("a version history loaded on a task number the service finds nothing for gives way to the task, opened as its link opens it", async () => {
  const asked = actsAsked();
  first = WITH_SEVEN;
  const router = await drawWindow("/acme/task/9999/versions");

  assert.ok(
    !router.history.location.pathname.endsWith("/versions"),
    `no history stands: ${router.history.location.pathname}`,
  );
  assert.deepEqual(
    asked.filter((act) => act.kind === ACT_KIND.TASKS_SELECT).map((act) => act.payload),
    [{ taskId: "9999" }],
  );
});

/** An agent of Acme's task numbered 7, which no list the window holds names, as the service reads its page. */
const SEVEN_AGENT: AgentPage = {
  id: "agent-of-seven",
  planId: ACME_SEVEN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Retry the relay",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: null,
  workspaceId: ACME.id,
  repository: null,
};

test("an agent's link pressed in an Inbox item, its task not open, lands on the agent's tab in one step from the item", async () => {
  fakeActPortAnswering((request) =>
    request.kind === ACT_KIND.AGENTS_PAGE
      ? Promise.resolve({ agent: SEVEN_AGENT })
      : request.kind === ACT_KIND.TASKS_SELECT
        ? Promise.resolve(true)
        : Promise.reject(refusedOnPort("Not here.")),
  );
  first = WITH_SEVEN;
  const router = await drawWindow("/acme/inbox/item-1");
  await settle();
  const before = router.addresses().slice(0, router.at() + 1);

  act(() =>
    showLink?.({ workspace: "acme", place: { kind: LINK_PLACE.AGENT, agentId: SEVEN_AGENT.id } }),
  );
  await settle();

  const after = router.addresses().slice(0, router.at() + 1);
  assert.deepEqual(after.slice(0, before.length), before, "the Inbox item stays the step behind");
  assert.equal(after.length, before.length + 1, `one step, not through Home: ${after.join(" → ")}`);
});

test("a tab landing on an agent's address, its link opened as it lands, stands the page in the one step it landed on", async () => {
  const router = await drawWindow("/acme");
  const steps = router.addresses().length;

  act(() => {
    router.history.push("/acme/agent/agent-9");
    showLink?.({ workspace: "acme", place: { kind: LINK_PLACE.AGENT, agentId: "agent-9" } });
  });
  await settle();

  assert.equal(router.history.location.pathname, "/acme/agent/agent-9");
  assert.equal(router.addresses().length, steps + 1, router.addresses().join(" → "));
});

/** Whether the page saying a workspace is not there for the reader stands. */
function unknownWorkspaceShown(): boolean {
  return document.body.textContent?.includes("This workspace doesn't exist") === true;
}

/** The not-found page's way out, Go home. */
function goHomeButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Go home",
  );
  return found ?? assert.fail("Go home stands");
}

test("a Home link to a workspace the reader is not in stands the not-found place at its own address, in the step's place, and Go home leaves it for Home", async () => {
  const router = await drawWindow("/acme");
  const steps = router.addresses().length;

  act(() => showLink?.({ workspace: "ghost", place: { kind: LINK_PLACE.HOME } }));
  await settle();
  const standing = [router.history.location.pathname, unknownWorkspaceShown()];
  const written = router.addresses().length;
  act(() => goHomeButton().click());
  await settle();

  assert.deepEqual(standing, ["/ghost", true]);
  assert.equal(written, steps, "and writes no step");
  assert.deepEqual([router.history.location.pathname, unknownWorkspaceShown()], ["/acme", false]);
});

test("Back from a link to a workspace the reader is not in, pressed over a place, goes to the step before that place, as the link wrote no step", async () => {
  const router = await drawWindow("/acme");
  act(() => showLink?.({ workspace: "acme", place: { kind: LINK_PLACE.BOARD } }));
  await settle();
  assert.equal(router.history.location.pathname, "/acme/tasks");

  act(() => showLink?.({ workspace: "ghost", place: { kind: LINK_PLACE.BOARD } }));
  await settle();
  act(() => router.history.back());
  await settle();

  assert.deepEqual([router.history.location.pathname, unknownWorkspaceShown()], ["/acme", false]);
});

test.each([
  ["an agent's page", { kind: LINK_PLACE.AGENT, agentId: "agent-9" }, "/acme/agent/agent-9"],
  ["the Inbox", { kind: LINK_PLACE.INBOX }, "/acme/inbox"],
] as const)(
  "%s opened over a workspace's address the reader is not in takes its place",
  async (_place, place, address) => {
    const router = await drawWindow("/ghost/tasks");
    assert.deepEqual([router.history.location.pathname, unknownWorkspaceShown()], ["/ghost", true]);

    act(() => showLink?.({ workspace: "acme", place }));
    await settle();

    assert.deepEqual([router.history.location.pathname, unknownWorkspaceShown()], [address, false]);
  },
);

test("a Home link to a workspace the reader is not in, pressed over an agent's page, stands the not-found place in its place", async () => {
  const router = await drawWindow("/acme/agent/agent-9");

  act(() => showLink?.({ workspace: "ghost", place: { kind: LINK_PLACE.HOME } }));
  await settle();

  assert.deepEqual([router.history.location.pathname, unknownWorkspaceShown()], ["/ghost", true]);
});
