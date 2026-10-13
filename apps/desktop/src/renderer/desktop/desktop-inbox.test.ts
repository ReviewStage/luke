// @vitest-environment jsdom

import assert from "node:assert/strict";
import type {
  CodingAgentInboxAnswerView,
  CodingAgentListAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import type { AppInboxPlan, AppInboxPlanHolding } from "#shared/messages/app-state";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { runAppCommand } from "../app-commands";
import { PLAN_MARK, type PlanMark } from "../planning/planning-model";
import type { InboxViewControl, PlansControl } from "../planning/use-plans-tab";
import { DesktopInbox } from "./desktop-inbox";

const BILLING: PlanSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};
const INVITES: PlanSummary = {
  ...BILLING,
  id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  name: "Invites",
};
const AUDIT: PlanSummary = {
  ...BILLING,
  id: "1c3e5a7b-9d2f-4b6a-8c1e-3f5a7b9d2e4c",
  name: "Audit log",
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: BILLING.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Alerts",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
};

const ITEM_A = "a1b2c3d4-0000-4000-8000-000000000001";
const ITEM_B = "a1b2c3d4-0000-4000-8000-000000000002";
const ITEM_C = "a1b2c3d4-0000-4000-8000-000000000003";

/** An item of a plan's agent, open, as the service answers one. */
function item(id: string, title: string): InboxItem {
  return {
    id,
    agentId: AGENT.id,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.TEXT },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
  };
}

/** What waits on each plan, as main writes it, and every plan holding an item, the latest changed first. */
const WAITING: readonly AppInboxPlan[] = [
  { planId: BILLING.id, items: [ITEM_A, ITEM_B] },
  { planId: INVITES.id, items: [ITEM_C] },
];
const HOLDING: readonly AppInboxPlanHolding[] = [
  { planId: INVITES.id, items: 1, updatedAt: 9_000 },
  { planId: AUDIT.id, items: 4, updatedAt: 8_000 },
  { planId: BILLING.id, items: 2, updatedAt: 7_000 },
];

/** Each plan's inbox as the service answers its first read; every read after it held. */
const INBOXES = new Map<string, readonly InboxItem[]>([
  [BILLING.id, [item(ITEM_A, "Alert at 80%?"), item(ITEM_B, "Email or Slack?")]],
  [INVITES.id, [item(ITEM_C, "Expire after 7 days?")]],
  [AUDIT.id, []],
]);

let root: Root | undefined;
/** The plans whose inbox was first read, in order. */
let inboxReads: string[] = [];

beforeEach(() => {
  window.localStorage.clear();
  inboxReads = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        const done = (value: CodingAgentListAnswer | CodingAgentInboxAnswerView) =>
          Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        if (request.kind === ACT_KIND.CODING_AGENTS_LIST) return done({ agents: [AGENT] });
        if (request.kind === ACT_KIND.CODING_AGENTS_INBOX) {
          const { planId, after } = request.payload;
          if (after !== INBOX_CURSOR_START) return new Promise(() => undefined);
          inboxReads.push(planId);
          return done({ items: INBOXES.get(planId) ?? [], cursor: "1" });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** What the Inbox was asked to do beyond what it holds itself. */
interface Asked {
  readonly shownPlans: string[];
  readonly shownAgents: [string, string][];
  readonly marked: [string, PlanMark][];
  closes: number;
}

/**
 * The Inbox over the plans given, its own view real, as the plans tab holds
 * it, and every press that leaves it recorded.
 */
function mount(patch: Partial<PlansControl> = {}) {
  const asked: Asked = { shownPlans: [], shownAgents: [], marked: [], closes: 0 };
  function Page() {
    const [view, setView] = useState<Pick<InboxViewControl, "planId" | "waitingOnly">>({
      planId: undefined,
      waitingOnly: false,
    });
    const inboxView: InboxViewControl = {
      open: true,
      planId: view.planId,
      waitingOnly: view.waitingOnly,
      onOpen: () => undefined,
      onClose: () => {
        asked.closes += 1;
      },
      onChoose: (planId) => setView((held) => ({ ...held, planId })),
      onWaitingOnly: (waitingOnly) => setView((held) => ({ ...held, waitingOnly })),
    };
    return createElement(DesktopInbox, {
      plans: plansControl({
        plans: [BILLING, INVITES, AUDIT],
        inbox: WAITING,
        inboxPlans: HOLDING,
        inboxView,
        onShowPlan: (planId) => asked.shownPlans.push(planId),
        onMarkPlan: (planId, mark) => asked.marked.push([planId, mark]),
        onShowAgent: (planId, agentId) => asked.shownAgents.push([planId, agentId]),
        ...patch,
      }),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Page))));
  return { page: container, asked };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Each plan of the column as a reader hears it, `▸ ` where chosen and `*` where drawn bold: its name and how many items wait. */
function column(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLElement>(".inbox-plans .sidebar-plan")].map(
    (row) =>
      `${row.getAttribute("aria-current") === "page" ? "▸ " : ""}${row.dataset.unread === "true" ? "*" : ""}${row.textContent}`,
  );
}

function rowNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const row = [...page.querySelectorAll<HTMLButtonElement>(".inbox-plans .sidebar-plan")].find(
    (each) => each.querySelector(".sidebar-plan-name")?.textContent === name,
  );
  assert.ok(row, `no row for ${name}`);
  return row;
}

function buttonNamed(page: HTMLElement, words: string): HTMLButtonElement {
  const button = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent?.trim() === words,
  );
  assert.ok(button, `no ${words} button`);
  return button;
}

/** The item titles the chosen plan's board draws, in order. */
function titles(page: HTMLElement): string[] {
  return [...page.querySelectorAll("[data-inbox-title]")].map((title) => title.textContent ?? "");
}

test("the column lists every plan holding an item on the sidebar's own plan row, the latest changed first, bold with how many wait in the time's place while any does, and the first stands chosen with its items beside it", async () => {
  const { page } = mount();
  await settle();

  assert.deepEqual(column(page), [
    "▸ *Invites1 waiting",
    "Audit log",
    "*Billing usage alerts2 waiting",
  ]);
  assert.equal(
    rowNamed(page, "Billing usage alerts").querySelector(".sidebar-plan-time")?.textContent,
    "2 waiting",
  );
  assert.equal(
    page.querySelector(".inbox-plans .sidebar-plan-repository"),
    null,
    "no repository line",
  );
  assert.deepEqual(titles(page), ["Expire after 7 days?"]);
  assert.equal(page.querySelector(".inbox-view-items h1")?.textContent, "Invites");
  assert.deepEqual(inboxReads, [INVITES.id]);
  const chosenArchive = rowNamed(page, "Invites")
    .closest(".sidebar-plan-item")
    ?.querySelector('.sidebar-plan-marks [aria-label="Archive"]');
  assert.ok(chosenArchive);
  assert.equal(
    chosenArchive.getAttribute("aria-keyshortcuts"),
    null,
    "the open plan's page holds ⇧⌘A, not the Inbox",
  );
});

test("a row hangs the plan's card when rested on, offers Pin and Archive at its end, and its right-click offers Open plan ahead of the plan's own menu", async () => {
  const { page, asked } = mount();
  await settle();
  const billing = rowNamed(page, "Billing usage alerts");

  act(() => {
    billing.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.body.querySelector<HTMLElement>('[role="tooltip"]');
  assert.equal(card?.querySelector(".plan-card-name")?.textContent, "Billing usage alerts");

  const archive = billing
    .closest(".sidebar-plan-item")
    ?.querySelector<HTMLButtonElement>('.sidebar-plan-marks [aria-label="Archive"]');
  assert.ok(archive, "the row offers Archive at its end");
  act(() => archive.click());
  assert.deepEqual(asked.marked, [[BILLING.id, PLAN_MARK.ARCHIVE]]);

  act(() => {
    billing.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
  });
  const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map((each) => each.textContent),
    [
      "Open plan",
      "Rename",
      "Version history",
      "Pin",
      "Archive",
      "Change repository…",
      "Open on GitHub",
      "Permanently delete",
    ],
  );
  act(() => items[0]?.click());
  assert.deepEqual(asked.shownPlans, [BILLING.id]);
});

test("choosing a plan reads its items beside the column, and Waiting lists only the plans with an item waiting", async () => {
  const { page } = mount();
  await settle();
  act(() => buttonNamed(page, "Waiting").click());
  assert.deepEqual(column(page), ["▸ *Invites1 waiting", "*Billing usage alerts2 waiting"]);

  act(() => rowNamed(page, "Billing usage alerts").click());
  await settle();
  assert.deepEqual(titles(page), ["Alert at 80%?", "Email or Slack?"]);
  assert.deepEqual(column(page), ["*Invites1 waiting", "▸ *Billing usage alerts2 waiting"]);
  assert.deepEqual(inboxReads, [INVITES.id, BILLING.id]);

  act(() => buttonNamed(page, "All").click());
  assert.equal(column(page).length, 3);
});

test("Open plan and an item's agent leave the Inbox for the plan, and the window's Escape leaves it where it stood", async () => {
  const { page, asked } = mount();
  act(() => rowNamed(page, "Billing usage alerts").click());
  await settle();

  act(() => buttonNamed(page, "Open plan").click());
  assert.deepEqual(asked.shownPlans, [BILLING.id]);
  act(() => buttonNamed(page, "Alerts").click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);

  let ran = false;
  act(() => {
    ran = runAppCommand(APP_COMMAND.EXIT_INBOX);
  });
  assert.equal(ran, true);
  assert.equal(asked.closes, 1);
});

test("with no plan holding an item the Inbox says nothing is waiting under its glyph, and under Waiting the chosen plan stays listed though nothing waits on it", async () => {
  const empty = mount({ inboxPlans: [] });
  assert.match(
    empty.page.querySelector(".empty-state")?.textContent ?? "",
    /Nothing is waiting on you/u,
  );
  assert.ok(empty.page.querySelector(".empty-state-icon svg"));
  act(() => root?.unmount());

  const settled = mount({
    inbox: [],
    inboxPlans: [{ planId: AUDIT.id, items: 4, updatedAt: 8_000 }],
  });
  await settle();
  act(() => buttonNamed(settled.page, "Waiting").click());
  assert.deepEqual(column(settled.page), ["▸ Audit log"], "the chosen plan stays");
});
