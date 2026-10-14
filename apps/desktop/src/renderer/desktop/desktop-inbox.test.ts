// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerView,
  type CodingAgentListAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { DocumentIcon } from "@sidecar/panel";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import type { AppInboxPlanHolding } from "#shared/messages/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl, waitingOf } from "#testing/plans-control";
import { readSegmented, segment, segmentedGroup } from "#testing/segmented";
import type { InboxChoice } from "../planning/use-plans-tab";
import { DesktopInbox } from "./desktop-inbox";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Alerts",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
};

const BILLING: PlanSummary = {
  id: AGENT.planId,
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  // The sidebar's list names the plan's agent, as the service sums a plan's agents up.
  agents: {
    total: 1,
    working: 1,
    agents: [
      {
        id: AGENT.id,
        title: AGENT.title,
        model: AGENT.model,
        effort: AGENT.effort,
        status: AGENT.status,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};
const INVITES: PlanSummary = {
  id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  workspaceId: BILLING.workspaceId,
  name: "Invites",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** An item of the agent's, open and asking a choice, as the service answers one. */
function item(id: string, title: string, updatedAt: number): InboxItem {
  return {
    id,
    agentId: AGENT.id,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: {
      type: INBOX_RESPONSE.CHOICE,
      options: [
        { label: "Retry 3 times over an hour", detail: "Backs off 5, 15, then 40 minutes." },
        { label: "Retry once" },
      ],
      recommended: "Retry 3 times over an hour",
    },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt,
  };
}

const THRESHOLD = item("a1b2c3d4-0000-4000-8000-000000000001", "Alert at 80%?", 3_000);
const RETRY: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000002", "How is a failed email retried?", 5_000),
  status: INBOX_STATUS.ANSWERED,
  answer: {
    reply: INBOX_REPLY.CHOSE,
    choices: ["Retry 3 times over an hour"],
    note: "And page on-call if all three fail.",
  },
};
const EXPIRY = item("a1b2c3d4-0000-4000-8000-000000000003", "Expire after 7 days?", 4_000);

const HOLDING: readonly AppInboxPlanHolding[] = [
  { planId: BILLING.id, items: 2, updatedAt: 5_000 },
  { planId: INVITES.id, items: 1, updatedAt: 4_000 },
];

let root: Root | undefined;
/** The plan's agents as the service lists them, archived ones among them. */
let listedAgents: readonly CodingAgentSummary[] = [AGENT];
/** Each plan's inbox as the service answers a read of it from the start. */
let inboxes = new Map<string, readonly InboxItem[]>();
/** Moves main's list of the plans holding items, as its read of the account would. */
let setHolding: (holding: readonly AppInboxPlanHolding[]) => void = () => undefined;
/** Moves the account's list of plans, as an archive on another Mac would. */
let setPlans: (plans: readonly PlanSummary[]) => void = () => undefined;
/** A read of a plan's inbox as the act answers it: done, carrying the view the service answered. */
interface ReadOutcome {
  readonly status: typeof ACT_OUTCOME_STATUS.DONE;
  readonly value: CodingAgentInboxAnswerView;
}

/** How the next held read of a plan, one past the cursor, answers: held open while nothing changes unless a test says. */
let heldRead: (planId: string) => Promise<ReadOutcome> = () => new Promise(() => undefined);
/** How a read of a plan from the start answers, where a test holds it in its own hands. */
let startRead: ((planId: string) => Promise<ReadOutcome> | undefined) | undefined;

beforeEach(() => {
  window.localStorage.clear();
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  heldRead = () => new Promise(() => undefined);
  startRead = undefined;
  listedAgents = [AGENT];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        const done = (value: CodingAgentListAnswer | CodingAgentInboxAnswerView) =>
          Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        if (request.kind === ACT_KIND.CODING_AGENTS_LIST) return done({ agents: listedAgents });
        if (request.kind === ACT_KIND.CODING_AGENTS_INBOX) {
          const { planId, after } = request.payload;
          // A read past the cursor is held open while nothing changes, as the service holds it.
          if (after !== INBOX_CURSOR_START) return heldRead(planId);
          return startRead?.(planId) ?? done({ items: inboxes.get(planId) ?? [], cursor: "1" });
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

/** What the Inbox was asked to open, leaving it. */
interface Asked {
  readonly shownPlans: string[];
  readonly shownAgents: [string, string][];
}

/** The Inbox over the two plans, its own view real, as the plans tab holds it, and every press that leaves it recorded. */
function mount() {
  const asked: Asked = { shownPlans: [], shownAgents: [] };
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    const [holding, setHeld] = useState(HOLDING);
    const [listed, setListed] = useState<readonly PlanSummary[]>([BILLING, INVITES]);
    setHolding = setHeld;
    setPlans = setListed;
    return createElement(DesktopInbox, {
      plans: plansControl({
        plans: listed,
        inbox: [
          { planId: BILLING.id, items: [waitingOf(THRESHOLD)] },
          { planId: INVITES.id, items: [waitingOf(EXPIRY)] },
        ],
        inboxPlans: holding,
        inboxView: {
          open: true,
          chosen,
          onOpen: () => undefined,
          onClose: () => undefined,
          onChoose: setChosen,
        },
        onShowPlan: (planId) => asked.shownPlans.push(planId),
        onShowAgent: (planId, agentId) => asked.shownAgents.push([planId, agentId]),
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
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/**
 * What marks a row as needing the developer: `*` where it is drawn bold and
 * wears the dot read as "Needs you", nothing where it wears neither, and
 * `?` where it wears only one, so a half-drawn mark fails every listing.
 */
function needsYouMark(row: HTMLElement): string {
  const bold = row.dataset.unread === "true";
  const dot = row.querySelector(".inbox-row-dot")?.textContent === "Needs you";
  if (bold && dot) return "*";
  return bold || dot ? "?" : "";
}

/** The list as a reader hears it: each group's name, then its rows, `▸ ` where chosen and `*` where marked as needing the developer. */
function listed(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-plans");
  assert.ok(list, "the list is drawn");
  return [...list.querySelectorAll(".sidebar-repository-name, .sidebar-plan")].map((node) => {
    if (!(node instanceof HTMLElement) || !node.classList.contains("sidebar-plan")) {
      return `# ${node.textContent}`;
    }
    const name = node.querySelector(".sidebar-plan-name")?.textContent ?? "";
    return `${node.getAttribute("aria-current") === "page" ? "▸ " : ""}${needsYouMark(node)}${name}`;
  });
}

function rowNamed(page: HTMLElement, title: string): HTMLButtonElement {
  const row = [...page.querySelectorAll<HTMLButtonElement>(".inbox-plans .sidebar-plan")].find(
    (each) => each.querySelector(".sidebar-plan-name")?.textContent === title,
  );
  assert.ok(row, `no row for ${title}`);
  return row;
}

test("the list holds every plan's items under the sidebar's group header for each, the latest changed first and marked bold with a dot while it needs you, the first such item chosen; Newest first from the view's menu lists them in one run, and the choice outlives a relaunch", async () => {
  let { page } = mount();
  await settle();
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);

  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
  const newest = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
  ].find((each) => each.textContent?.includes("Newest first"));
  assert.equal(newest?.getAttribute("aria-checked"), "false");
  act(() => newest?.click());
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  // Relaunched, nothing is chosen, so the first waiting item of the one run stands chosen.
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "▸ *Expire after 7 days?",
    "*Alert at 80%?",
  ]);
});

test("a settled choice keeps every option its agent offered with the developer's pick marked, then their note as their own bubble, saying what they did and that it reached the agent", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  assert.deepEqual(
    [...pane.querySelectorAll<HTMLElement>("li.inbox-option")].map((option) => [
      option.dataset.picked,
      option.querySelector(".font-medium")?.textContent,
      option.querySelector(".inbox-picked")?.textContent ?? null,
    ]),
    [
      ["true", "Retry 3 times over an hour", "Your pick"],
      ["false", "Retry once", null],
    ],
  );
  assert.equal(pane.querySelector("textarea"), null, "a settled item takes no answer");
  const reply = pane.querySelector<HTMLElement>(".is-user");
  assert.ok(reply, "the developer's reply is their own bubble");
  assert.equal(reply.querySelector("p")?.textContent, "And page on-call if all three fail.");
  assert.match(
    reply.textContent ?? "",
    /You chose Retry 3 times over an hour · .+ · Sent to Alerts/u,
  );
});

test("a form's select fields are radio groups, an optional one's pick taken back by pressing it again and a required one's kept, and its yes-or-no field a switch", async () => {
  inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      response: {
        type: INBOX_RESPONSE.FORM,
        fields: [
          { type: INBOX_FIELD.SELECT, label: "Channel", options: ["Email", "Slack"] },
          { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
          { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        ],
      },
    },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const pane = page.querySelector<HTMLElement>(".inbox-view-items") ?? assert.fail("no pane");
  const channel = () => segmentedGroup(pane, "Channel");
  const severity = () => segmentedGroup(pane, "Severity");
  const onCall = () =>
    pane.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Page on-call"]') ??
    assert.fail("no Page on-call switch");
  const unpicked = readSegmented(channel());

  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  const picked = [readSegmented(channel()).checked, readSegmented(severity()).checked];
  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  act(() => onCall().click());

  assert.deepEqual(unpicked, { options: ["Email", "Slack"], checked: [], tabStops: ["Email"] });
  assert.deepEqual(picked, [["Slack"], ["High"]]);
  assert.deepEqual(readSegmented(channel()).checked, [], "the optional pick is taken back");
  assert.deepEqual(readSegmented(severity()).checked, ["High"], "the required pick stands");
  assert.equal(onCall().getAttribute("aria-checked"), "true");
});

test("the pane's crumbs lead with their tabs' glyphs, the plan's document and the agent's mark, and open the item's plan and its agent's tab, each leaving the Inbox, with no other way out in its bar", async () => {
  const { page, asked } = mount();
  await settle();
  const crumbs = [
    ...page.querySelectorAll<HTMLButtonElement>('.inbox-view-items nav[aria-label="Path"] button'),
  ];
  assert.deepEqual(
    crumbs.map((crumb) => crumb.textContent),
    ["Billing usage alerts", "Alerts"],
  );
  const [plan, agent] = crumbs;
  assert.equal(
    plan?.querySelector(".tab-icon")?.innerHTML,
    renderToStaticMarkup(createElement(DocumentIcon)),
    "the plan's crumb wears its tab's document glyph",
  );
  assert.ok(agent?.querySelector(".tab-icon .state-glyph"), "the agent's crumb wears its mark");
  assert.equal(page.querySelectorAll(".inbox-view-items .desktop-toolbar button").length, 2);
  act(() => crumbs[0]?.click());
  act(() => crumbs[1]?.click());
  assert.deepEqual(asked.shownPlans, [BILLING.id]);
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

/** The card standing in the window, as a reader hears it: the agent's name, then what its corner says, such as "Working…". */
function standingCard(): readonly [string | null | undefined, string | null | undefined] {
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.ok(card, "an agent's card is hung");
  return [
    card.querySelector(".card-name")?.textContent,
    card.querySelector(".card-corner")?.textContent,
  ];
}

/** Rests on a control as the keyboard reaches it, which hangs its card as a resting pointer does. */
function reach(control: HTMLElement): void {
  document.documentElement.dataset.keyboard = "true";
  act(() => control.focus());
}

/** The agent's references in the pane's thread, each as its words. */
function threadRefs(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>(".inbox-board button[data-agent-ref]")];
}

test("the thread names its agent as one button wherever it does, its byline and the line saying an answer was sent to it: each hangs the agent's tab's card and opens its tab, leaving the Inbox", async () => {
  const { page, asked } = mount();
  await settle();
  const [byline] = threadRefs(page);
  assert.ok(byline, "the byline names the agent");
  assert.equal(byline.textContent, "Alerts");
  reach(byline);
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  act(() => byline.click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);

  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = page.querySelector<HTMLButtonElement>("[data-inbox-answer] button[data-agent-ref]");
  assert.ok(sent, "the line saying the answer was sent names the agent");
  assert.equal(sent.textContent, "Alerts");
  reach(sent);
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  act(() => sent.click());
  assert.deepEqual(asked.shownAgents, [
    [BILLING.id, AGENT.id],
    [BILLING.id, AGENT.id],
  ]);
});

test("an archived agent is still named by its name, its card saying it was archived, and an agent the plan does not list goes by Coding agent, its card saying it is not found; each opens its tab, which shows the plan where its tab is gone", async () => {
  listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.CANCELLED, archivedAt: 4_000 }];
  let { page, asked } = mount();
  await settle();
  let [byline] = threadRefs(page);
  assert.ok(byline, "the byline names the archived agent");
  assert.equal(byline.textContent, "Alerts");
  reach(byline);
  const [name, corner] = standingCard();
  assert.equal(name, "Alerts");
  assert.match(corner ?? "", /^Archived · /u);
  const crumb = page.querySelectorAll<HTMLButtonElement>('nav[aria-label="Path"] button')[1];
  assert.ok(crumb, "the agent's crumb is drawn");
  reach(crumb);
  assert.equal(standingCard()[0], "Alerts", "the crumb hangs the archived agent's card too");

  act(() => root?.unmount());
  listedAgents = [];
  ({ page, asked } = mount());
  await settle();
  [byline] = threadRefs(page);
  assert.ok(byline, "the byline names an agent the plan does not list");
  assert.equal(byline.textContent, "Coding agent");
  reach(byline);
  assert.deepEqual(standingCard(), ["Coding agent", "Not found"]);
  act(() => byline.click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

test("an item's mark in the list hangs its agent's card where its plan's row names the agent, a press on the card choosing nothing, and a press on the mark chooses the item, as a press anywhere on its row does", async () => {
  const { page, asked } = mount();
  await settle();
  const row = rowNamed(page, "How is a failed email retried?");
  const mark = row.querySelector<HTMLElement>("[data-agent-ref]");
  assert.ok(mark, "the row's mark is the agent's reference");
  act(() => {
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  // A press on the card, as one selecting its words makes, leaves the row unchosen and the card standing.
  const card = document.querySelector<HTMLElement>(".tooltip-card [data-tab-card]");
  act(() => {
    card?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    card?.click();
  });
  assert.equal(row.getAttribute("aria-current"), null);
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  act(() => mark.click());
  assert.equal(row.getAttribute("aria-current"), "page");
  assert.deepEqual(asked.shownAgents, [], "the press stays in the Inbox");
  const other = rowNamed(page, "Expire after 7 days?");
  assert.equal(
    other.querySelector("[data-agent-ref]"),
    null,
    "a plan whose row names no agent leaves the mark bare",
  );
});

test("a plan main says changed is read again, so an item answered on another Mac lists as settled; Needs you then lists only what still needs you until pressed again, and outlives a relaunch", async () => {
  let { page } = mount();
  await settle();
  inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      status: INBOX_STATUS.ANSWERED,
      answer: { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] },
      updatedAt: 6_000,
    },
  ]);
  act(() =>
    setHolding([
      { planId: INVITES.id, items: 1, updatedAt: 6_000 },
      { planId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  const everything = [
    "# Invites",
    "Expire after 7 days?",
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
  ];
  assert.deepEqual(listed(page), everything);

  const waitingOnly = () => {
    const button = page.querySelector<HTMLButtonElement>('button[aria-label="Needs you"]');
    assert.ok(button, "the head offers Needs you");
    return button;
  };
  assert.equal(waitingOnly().getAttribute("aria-pressed"), "false");
  act(() => waitingOnly().click());
  assert.equal(waitingOnly().getAttribute("aria-pressed"), "true");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(waitingOnly().getAttribute("aria-pressed"), "true");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  act(() => waitingOnly().click());
  assert.equal(waitingOnly().getAttribute("aria-pressed"), "false");
  assert.deepEqual(listed(page), everything);
});

test("Needs you's glyph wears the rows' dot while anything needs you, the filter on or off, and none while nothing does; its pressed fill says the filter is on, and its tooltip what a press does", async () => {
  const answered = { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] };
  const settled = { ...EXPIRY, status: INBOX_STATUS.ANSWERED, answer: answered };
  inboxes.set(INVITES.id, [settled]);
  inboxes.set(BILLING.id, [RETRY]);
  const { page } = mount();
  await settle();
  const button = page.querySelector<HTMLButtonElement>('button[aria-label="Needs you"]');
  assert.ok(button, "the head offers Needs you");
  const worn = () => {
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    return {
      pressed: button.getAttribute("aria-pressed"),
      dot: button.querySelector(".inbox-needs-you-dot") !== null,
      tooltip: document.querySelector('[role="tooltip"]')?.textContent,
    };
  };
  assert.deepEqual(worn(), { pressed: "false", dot: false, tooltip: "Show only what needs you" });
  act(() => button.click());
  assert.deepEqual(worn(), { pressed: "true", dot: false, tooltip: "Show all" });

  // Another plan's agent asks again, as main says that plan changed.
  inboxes.set(INVITES.id, [{ ...EXPIRY, updatedAt: 6_000 }]);
  act(() =>
    setHolding([
      { planId: INVITES.id, items: 1, updatedAt: 6_000 },
      { planId: BILLING.id, items: 1, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(worn(), { pressed: "true", dot: true, tooltip: "Show all" });
  act(() => button.click());
  assert.deepEqual(worn(), { pressed: "false", dot: true, tooltip: "Show only what needs you" });
});

test("a folded plan counts what in it needs you, and one where nothing does counts nothing", async () => {
  const { page } = mount();
  await settle();
  inboxes.set(INVITES.id, [{ ...EXPIRY, status: INBOX_STATUS.CLOSED, updatedAt: 6_000 }]);
  act(() =>
    setHolding([
      { planId: INVITES.id, items: 1, updatedAt: 6_000 },
      { planId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  const headers = () => [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-plans .sidebar-repository-toggle"),
  ];
  for (const header of headers()) act(() => header.click());
  assert.deepEqual(
    headers().map((header) => [header.getAttribute("aria-expanded"), header.textContent]),
    [
      ["false", "Invites"],
      ["false", "Billing usage alerts1 needs you"],
    ],
  );
});

test("the list is resized from its edge between its bounds, and keeps its width across a relaunch", async () => {
  let { page } = mount();
  await settle();
  const edge = () => {
    const separator = page.querySelector<HTMLElement>('.inbox-plans [role="separator"]');
    assert.ok(separator, "the list has an edge to resize it by");
    return separator;
  };
  const width = () => Number(edge().getAttribute("aria-valuenow"));
  const press = (key: string) => {
    act(() => {
      edge().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };
  assert.equal(
    width(),
    360,
    "wide enough to centre the Inbox's name past the folded sidebar's buttons",
  );
  press("ArrowRight");
  assert.equal(width(), 376);
  press("End");
  assert.equal(width(), 520);
  press("ArrowRight");
  assert.equal(width(), 520, "no wider than its greatest width");

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(width(), 520);
  press("Home");
  assert.equal(width(), 300);
  press("ArrowLeft");
  assert.equal(width(), 300, "no narrower than its least width");
});

/** An answer the act gives the renderer, the view it carries settled now. */
function answered(value: CodingAgentInboxAnswerView): Promise<ReadOutcome> {
  return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
}

/** A read the test answers when it chooses. */
interface PendingRead {
  readonly promise: Promise<ReadOutcome>;
  readonly settle: (value: CodingAgentInboxAnswerView) => void;
}

/** A read held until the test settles it. */
function pending(): PendingRead {
  let settle: PendingRead["settle"] = () => undefined;
  const promise = new Promise<ReadOutcome>((resolve) => {
    settle = (value) => resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
  });
  return { promise, settle };
}

const UNANSWERED_READ: CodingAgentInboxAnswerView = {
  failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
};

test("a chosen item whose plan leaves the account's list, archived on another Mac, gives way to the first item still waiting", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(
    listed(page).filter((row) => row.startsWith("▸")),
    ["▸ *Alert at 80%?"],
  );
  act(() => {
    setPlans([INVITES]);
    setHolding([{ planId: INVITES.id, items: 1, updatedAt: 4_000 }]);
  });
  await settle();
  assert.deepEqual(listed(page), ["# Invites", "▸ *Expire after 7 days?"]);
  assert.equal(
    page.querySelector(".inbox-view-items [data-inbox-title]")?.textContent,
    "Expire after 7 days?",
  );
});

test("once the chosen plan's own held read fails, the list's read of that plan stands again, so an item posted since still lists", async () => {
  heldRead = () => answered(UNANSWERED_READ);
  const { page } = mount();
  await settle();
  const posted = item("a1b2c3d4-0000-4000-8000-000000000004", "Page on-call too?", 7_000);
  inboxes.set(BILLING.id, [THRESHOLD, RETRY, posted]);
  act(() =>
    setHolding([
      { planId: BILLING.id, items: 3, updatedAt: 7_000 },
      { planId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.ok(listed(page).includes("*Page on-call too?"), listed(page).join(" | "));
});

test("an answer to a plan's read that a newer one overtook moves nothing: the newer read's failure still says so with Try again", async () => {
  const first = pending();
  const second = pending();
  const reads = [first, second];
  startRead = (planId) => (planId === INVITES.id ? reads.shift()?.promise : undefined);
  const { page } = mount();
  await settle();
  act(() =>
    setHolding([
      { planId: BILLING.id, items: 2, updatedAt: 5_000 },
      { planId: INVITES.id, items: 1, updatedAt: 6_000 },
    ]),
  );
  await settle();
  second.settle(UNANSWERED_READ);
  await settle();
  first.settle({ items: [EXPIRY], cursor: "1" });
  await settle();
  const note = page.querySelector<HTMLElement>('.inbox-plans [role="alert"]');
  assert.match(note?.textContent ?? "", /Some items could not be read\./u);
  assert.equal(
    listed(page).includes("*Expire after 7 days?"),
    false,
    "the overtaken read lists nothing",
  );
});
