// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { handState } from "#testing/app-state";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl, waitingOf } from "#testing/plans-control";
import type { InboxChoice, PlansControl } from "../planning/use-plans-tab";
import { commandKeyshortcuts } from "../tooltip";
import { DesktopHome } from "./desktop-home";
import { ListedAutomations } from "./listed-automations";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const DAY = 86_400_000;
const NOW = Date.now();

/** A plan of the personal workspace, saved `ago` before now. */
function plan(n: number, name: string, ago: number, repository: string | null): PlanSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - DAY,
    updatedAt: NOW - ago,
    repository,
  };
}

const INVITES = plan(1, "Teammate invitations", 4 * 60_000, "acme/relay");
const BILLING = plan(2, "Billing export", 2 * 3_600_000, "acme/ledger");
const PLANS: readonly PlanSummary[] = [
  plan(3, "Usage alerts", 5 * DAY, "acme/relay"),
  INVITES,
  plan(4, "Onboarding checklist", 12 * DAY, null),
  BILLING,
  plan(5, "Search across plans", 19 * DAY, "acme/relay"),
  plan(6, "Schema output", 3 * DAY, "acme/schema"),
  plan(7, "Nightly bump", 6 * 3_600_000, "acme/relay"),
  plan(8, "Old dashboard", 40 * DAY, "acme/relay"),
];

/** An item of the agent's asking a choice, open unless `status` says otherwise. */
function item(
  n: number,
  title: string,
  updatedAt: number,
  status: InboxItem["status"] = INBOX_STATUS.OPEN,
): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
    agentId: AGENT_ID,
    key: String(n),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.CHOICE, options: [{ label: "Yes" }, { label: "No" }] },
    needsReply: true,
    status,
    postedAt: updatedAt,
    updatedAt,
  };
}

const EMAIL = item(1, "Email the invitee when an invite is withdrawn?", NOW - 6 * 60_000);
const SETTLED = item(2, "Expire after 7 days?", NOW - 60_000, INBOX_STATUS.ANSWERED);
const ACCOUNT = item(3, "Which billing account does the export read?", NOW - 2 * 3_600_000);

/** Each plan's inbox as the service answers a read of it. */
const INBOXES = new Map<string, readonly InboxItem[]>([
  [INVITES.id, [EMAIL, SETTLED]],
  [BILLING.id, [ACCOUNT]],
]);

/** An agent with no plan an automation started, and the question it waits on. */
const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const QUARANTINE: InboxItem = {
  ...item(9, "Quarantine the flaky test?", NOW - 60_000),
  agentId: SWEEP_AGENT,
};

/** The automation that started the agent with no plan, as its workspace's list reads it. */
const SWEEP: AutomationSummary = {
  id: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  planId: null,
  planName: null,
  workspaceId: "workspace-personal",
  name: "Nightly flake sweep",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 3 * * *", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Sweep the flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

/** Each agent with no plan's inbox as the service answers a read of it. */
const AGENT_INBOXES = new Map<string, readonly InboxItem[]>([[SWEEP_AGENT, [QUARANTINE]]]);

/** The plans holding items, and those of them with an item waiting, as main reads the account. */
const HOLDING: Pick<PlansControl, "inbox" | "inboxPlans"> = {
  inbox: [
    { planId: INVITES.id, items: [waitingOf(EMAIL)] },
    { planId: BILLING.id, items: [waitingOf(ACCOUNT)] },
  ],
  inboxPlans: [
    { planId: INVITES.id, items: 2, updatedAt: EMAIL.updatedAt },
    { planId: BILLING.id, items: 1, updatedAt: ACCOUNT.updatedAt },
  ],
};

/** The teammate who started Invitations' agent, and the workspace's members as a read of them answers. */
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const CHARLES_PICTURE = "https://lh3.googleusercontent.com/a/photo-1";
const MEMBERS: readonly WorkspaceMember[] = [
  {
    userId: "user-dean",
    name: "Dean Stratakos",
    email: "dean@example.com",
    role: WORKSPACE_ROLE.OWNER,
  },
  {
    ...CHARLES,
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: CHARLES_PICTURE,
  },
];

let root: Root | undefined;
/** Every workspace whose automations were read, in order. */
let automationReads: string[] = [];

beforeEach(() => {
  automationReads = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.CODING_AGENTS_AGENT_INBOX) {
          const value: CodingAgentInboxAnswerView = {
            items: AGENT_INBOXES.get(request.payload.agentId) ?? [],
            cursor: "1",
          };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
          automationReads.push(request.payload.workspaceId ?? "");
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { automations: [SWEEP] },
          });
        }
        if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
        }
        if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        const value: CodingAgentInboxAnswerView = {
          items: INBOXES.get(request.payload.planId) ?? [],
          cursor: "1",
        };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Every door the page opens, in order. */
interface Opened {
  readonly plans: string[];
  readonly inbox: (InboxChoice | "inbox")[];
  newPlans: number;
}

/** The home page over `overrides`, every door it opens recorded. */
function mount(overrides: Partial<PlansControl> = {}, accountName = "Dean Stratakos") {
  const opened: Opened = { plans: [], inbox: [], newPlans: 0 };
  const plans = plansControl({
    plans: PLANS,
    listed: { plans: PLANS, archived: [], ...HOLDING },
    ...HOLDING,
    onSelect: (planId) => opened.plans.push(planId),
    onNewPlan: () => {
      opened.newPlans += 1;
    },
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: () => opened.inbox.push("inbox"),
      onClose: () => undefined,
      onChoose: (chosen) => opened.inbox.push(chosen),
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopHome, { plans, accountName })),
    ),
  );
  return { page: container, opened };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** A section's rows as a reader scans them: each row's name, then its context. */
function rows(page: HTMLElement, section: string): string[] {
  const region = page.querySelector(`section[aria-labelledby="${section}"]`);
  assert.ok(region, `${section} stands`);
  return [...region.querySelectorAll(".sidebar-plan")].map(
    (row) =>
      `${row.querySelector(".sidebar-plan-name")?.textContent} · ${row.querySelector(".home-row-context")?.textContent}`,
  );
}

function button(page: HTMLElement, text: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith(text),
  );
  assert.ok(found, `${text} stands`);
  return found;
}

test("the home page greets the account, lists what needs it with each item's plan, and the plans saved latest with their repositories", async () => {
  const { page } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(button(page, "New task"));
  assert.deepEqual(rows(page, "home-inbox"), [
    "Email the invitee when an invite is withdrawn? · Teammate invitations",
    "Which billing account does the export read? · Billing export",
  ]);
  assert.deepEqual(rows(page, "home-recent"), [
    "Teammate invitations · acme/relay",
    "Billing export · acme/ledger",
    "Nightly bump · acme/relay",
    "Schema output · acme/schema",
    "Usage alerts · acme/relay",
    "Onboarding checklist · No repository",
  ]);
});

test("Home offers no line to search every task, though Recent lists fewer than the workspace holds", async () => {
  const { page } = mount();
  await settle();

  assert.equal(rows(page, "home-recent").length, 6);
  assert.doesNotMatch(page.textContent ?? "", /Search all/u);
  const palette = commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE);
  assert.equal(page.querySelector(`[aria-keyshortcuts="${palette}"]`), null);
});

test("a waiting item's row opens the Inbox on its item, a recent plan opens the plan, and New plan asks for one", async () => {
  const { page, opened } = mount();
  await settle();

  button(page, "Email the invitee").click();
  button(page, "Usage alerts").click();
  button(page, "New task").click();

  assert.deepEqual(opened.inbox, ["inbox", { planId: INVITES.id, itemId: EMAIL.id }]);
  assert.deepEqual(opened.plans, [PLANS[0]?.id]);
  assert.equal(opened.newPlans, 1);
});

test("the waiting items stand under the Inbox's name, the place a press on one opens", async () => {
  const { page } = mount();
  await settle();

  const heading = page.querySelector("#home-inbox");
  assert.equal(heading?.closest("section")?.getAttribute("aria-labelledby"), "home-inbox");
  // The heading's count follows the name in a span of its own.
  assert.equal(heading?.firstChild?.textContent, "Inbox");
});

test("with nothing waiting, the home's Inbox says so in the Inbox's own words, as a line with no glyph", async () => {
  const { page } = mount({ listed: { plans: PLANS, archived: [], inbox: [], inboxPlans: [] } });
  await settle();

  const section = page.querySelector('section[aria-labelledby="home-inbox"]');
  const note = section?.querySelector(".sidebar-note");
  assert.equal(note?.textContent, "Nothing needs you");
  assert.equal(section?.querySelector("svg"), null);
});

test("an account with no plan yet is welcomed with New plan, and nothing the page says names the sidebar", () => {
  const { page } = mount({
    plans: [],
    listed: { plans: [], archived: [], inbox: [], inboxPlans: [] },
    inbox: [],
    inboxPlans: [],
  });

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
  assert.ok(button(page, "New task"));
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
});

test("↑ and ↓ move the focus through the rows from the window, and leave a key pressed elsewhere alone", async () => {
  mount();
  await settle();
  const field = document.createElement("input");
  document.body.append(field);
  const press = (key: string) =>
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  const focused = () => document.activeElement?.textContent ?? "";

  press("ArrowDown");
  assert.match(focused(), /^Email the invitee/u);
  press("ArrowDown");
  press("ArrowDown");
  assert.match(focused(), /^Teammate invitations/u);
  press("ArrowUp");
  assert.match(focused(), /^Which billing account/u);

  field.focus();
  press("ArrowDown");
  assert.ok(document.activeElement === field, "the field keeps the focus");

  field.blur();
  press("ArrowUp");
  assert.match(focused(), /^Onboarding checklist/u);
});

test("a workspace with no plan of its own, in an account with plans elsewhere, welcomes the account back rather than as new, and lists none of the others' Inbox", async () => {
  const { page } = mount({ listed: { plans: [], archived: [], inbox: [], inboxPlans: [] } });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.equal(rows(page, "home-inbox").length, 0);
  assert.equal(page.querySelector('section[aria-labelledby="home-recent"]'), null);
});

test("↑ and ↓ pressed on New plan leave the focus on it", async () => {
  const { page } = mount();
  await settle();
  const newPlan = button(page, "New task");
  newPlan.focus();
  act(() => {
    newPlan.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  assert.ok(document.activeElement === newPlan, "New plan keeps the focus");
});

test("Home lists every open item of the listed plans, a teammate's agent's included, though main counts only the account's own as waiting on it", async () => {
  // Billing's question is a teammate's agent's: main's account read holds the plan, but waits the account on Invitations' alone.
  const { page } = mount({
    listed: {
      plans: PLANS,
      archived: [],
      inbox: [{ planId: INVITES.id, items: [waitingOf(EMAIL)] }],
      inboxPlans: HOLDING.inboxPlans,
    },
  });
  await settle();

  assert.deepEqual(rows(page, "home-inbox"), [
    "Email the invitee when an invite is withdrawn? · Teammate invitations",
    "Which billing account does the export read? · Billing export",
  ]);
});

test("Home lists an item an automation's agent with no plan waits on, by its automation, and opens the Inbox on it by its agent", async () => {
  const { page, opened } = mount({
    inboxPlanless: [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        agentTitle: null,
        agentModel: "anthropic/claude-opus-5.5",
        automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
        automationName: "Nightly flake sweep",
        repository: "acme/relay",
      },
    ],
  });
  await settle();

  assert.ok(
    rows(page, "home-inbox").includes("Quarantine the flaky test? · Nightly flake sweep"),
    rows(page, "home-inbox").join(" | "),
  );
  button(page, "Quarantine the flaky test?").click();

  assert.deepEqual(opened.inbox, ["inbox", { agentId: SWEEP_AGENT, itemId: QUARANTINE.id }]);
});

test("an account with no plan yet but an automation's question waiting on it is shown the question rather than welcomed as new", async () => {
  const { page } = mount({
    plans: [],
    listed: { plans: [], archived: [], inbox: [], inboxPlans: [] },
    inbox: [],
    inboxPlans: [],
    inboxPlanless: [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        agentTitle: null,
        agentModel: "anthropic/claude-opus-5.5",
        automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
        automationName: "Nightly flake sweep",
        repository: "acme/relay",
      },
    ],
  });
  await settle();

  assert.equal(page.querySelector("[aria-label='Welcome']") === null, true, "no welcome stands");
  assert.deepEqual(rows(page, "home-inbox"), ["Quarantine the flaky test? · Nightly flake sweep"]);
});

test("a waiting row wears its agent's tile, whose card names the teammate who started it by their face, read against the listed workspace's members", async () => {
  const agents = {
    total: 1,
    working: 1,
    agents: [
      {
        id: AGENT_ID,
        title: "Invite emails",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
        startedBy: CHARLES,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  };
  const plans = PLANS.map((each) => (each.id === INVITES.id ? { ...each, agents } : each));
  const { page } = mount({
    me: "user-dean",
    workspace: {
      id: "workspace-personal",
      name: "Personal",
      role: WORKSPACE_ROLE.OWNER,
      github: null,
      memberCount: 2,
    },
    plans,
    listed: { plans, archived: [], ...HOLDING },
  });
  await settle();

  const row = button(page, "Email the invitee when an invite is withdrawn?");
  const mark = row.querySelector("[data-agent-ref]");
  assert.ok(mark, "the row's mark hangs its agent's card");
  assert.ok(mark.querySelector('.actor-mark[data-kind="agent"]'), "the mark is the agent's tile");
  act(() => {
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.match(card?.textContent ?? "", /Started by.*Charles Pan/u);
  const face = card?.querySelector<HTMLImageElement>('.actor-mark[data-kind="person"] img');
  assert.equal(
    face?.getAttribute("src"),
    CHARLES_PICTURE,
    "the starter wears their member picture",
  );
});

test("a waiting row of an agent with no plan names the automation that started it on its card, the window reading the automations for it alone", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const workspace = {
    id: "workspace-personal",
    name: "Personal",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  const plans = plansControl({
    plans: [],
    listed: { plans: [], archived: [], inbox: [], inboxPlans: [] },
    inbox: [],
    inboxPlans: [],
    workspace,
    inboxPlanless: [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        agentTitle: "Sweep the flaky tests",
        agentModel: "anthropic/claude-opus-5.5",
        automationId: SWEEP.id,
        automationName: SWEEP.name,
        repository: "acme/relay",
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ListedAutomations, {
          plans,
          on: true,
          children: createElement(DesktopHome, { plans, accountName: "Dean Stratakos" }),
        }),
      ),
    ),
  );
  await settle();

  const mark = button(container, "Quarantine the flaky test?").querySelector("[data-agent-ref]");
  assert.ok(mark, "the row's mark hangs its agent's card");
  act(() => {
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.match(card?.textContent ?? "", /Sweep the flaky tests.*Started by.*Nightly flake sweep/u);
});

test("a question of another workspace's automation, which Home does not list, reads none of the listed workspace's automations", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const plans = plansControl({
    plans: [],
    listed: { plans: [], archived: [], inbox: [], inboxPlans: [] },
    inbox: [],
    inboxPlans: [],
    workspace: {
      id: "workspace-personal",
      name: "Personal",
      role: WORKSPACE_ROLE.OWNER,
      github: null,
    },
    inboxPlanless: [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        agentTitle: "Sweep the flaky tests",
        agentModel: "anthropic/claude-opus-5.5",
        automationId: SWEEP.id,
        automationName: SWEEP.name,
        repository: "acme/relay",
        workspaceId: "workspace-acme",
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ListedAutomations, {
          plans,
          on: true,
          children: createElement(DesktopHome, { plans, accountName: "Dean Stratakos" }),
        }),
      ),
    ),
  );
  await settle();

  assert.deepEqual(automationReads, []);
});

test("a recent task a teammate created wears their face before its time, and the reader's own wears none", async () => {
  const plans = PLANS.map((each) =>
    each.id === INVITES.id
      ? { ...each, ownerId: CHARLES.userId, createdBy: CHARLES }
      : {
          ...each,
          ownerId: "user-dean",
          createdBy: { userId: "user-dean", name: "Dean Stratakos" },
        },
  );
  const { page } = mount({
    me: "user-dean",
    workspace: {
      id: "workspace-personal",
      name: "Personal",
      role: WORKSPACE_ROLE.OWNER,
      github: null,
      memberCount: 2,
    },
    plans,
    listed: { plans, archived: [], ...HOLDING },
  });
  await settle();

  const region = page.querySelector('section[aria-labelledby="home-recent"]');
  const faces = [...(region?.querySelectorAll(".sidebar-plan") ?? [])].flatMap((row) => {
    const face = row.querySelector<HTMLImageElement>(".sidebar-plan-time .actor-mark img");
    return face === null ? [] : [[row.querySelector(".sidebar-plan-name")?.textContent, face.src]];
  });
  assert.deepEqual(faces, [[INVITES.name, CHARLES_PICTURE]]);
});

test("a row whose title runs long keeps the task or repository it is about in sight: the title gives way, and what it is about keeps a floor", async () => {
  const { page } = mount();
  await settle();
  const style = layContainersAt({});
  const abouts = [...page.querySelectorAll(".home-row-context")];
  assert.equal(abouts.length, 8, "both sections' rows say what they are about");
  for (const about of abouts) {
    const title =
      about.parentElement?.querySelector(".sidebar-plan-name") ?? assert.fail("a title");
    assert.notEqual(getComputedStyle(title).flexShrink, "0", "the title gives way");
    assert.notEqual(getComputedStyle(about).minWidth, "0px", "what it is about keeps a floor");
  }
  style.remove();
});
