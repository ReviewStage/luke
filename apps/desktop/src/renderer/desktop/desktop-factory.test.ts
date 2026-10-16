// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { EXPERIMENT, type Experiment } from "@luke/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { OpenFeedbackProvider } from "../open-feedback";
import type { InboxChoice, PlansControl } from "../planning/use-plans-tab";
import { DesktopFactory } from "./desktop-factory";

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const AGENT_ID = "a0000000-0000-4000-8000-000000000001";

function plan(n: number, name: string, ago: number, patch: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - HOUR,
    updatedAt: NOW - ago,
    repository: "acme/relay",
    ...patch,
  };
}

const DRAFT = plan(1, "Usage alerts", 2 * HOUR);
const SEARCH = plan(2, "Search across plans", 5 * HOUR, {
  agents: {
    total: 1,
    working: 1,
    agents: [
      {
        id: AGENT_ID,
        title: "Plan index",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
        at: NOW - 2 * MINUTE,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
});
const BILLING = plan(3, "Mercury payouts", 2 * HOUR, {
  agents: {
    total: 1,
    working: 0,
    agents: [
      {
        id: "a0000000-0000-4000-8000-000000000002",
        title: "Payouts endpoint",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
});
const INVITES = plan(4, "Workspace invites", HOUR, {
  agents: {
    total: 1,
    working: 0,
    agents: [],
    pullRequestTotal: 1,
    pullRequests: [
      {
        number: 2505,
        title: "invites from the Mac",
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.PASSING,
        additions: 120,
        deletions: 8,
        url: "https://github.com/acme/relay/pull/2505",
      },
    ],
  },
});
const QUESTION = "Which Mercury account should payouts draw from: Operating or Payroll?";

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { onMenuCommand: () => () => undefined, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Every door the page opens, in order. */
interface Opened {
  readonly plans: string[];
  readonly inbox: (InboxChoice | "inbox")[];
  readonly github: string[];
  readonly agents: string[];
  readonly feedback: Experiment[];
}

/** Factory over `listed`, what waits, and the call, every door it opens recorded. */
function mount(listed: readonly PlanSummary[], overrides: Partial<PlansControl> = {}) {
  const opened: Opened = { plans: [], inbox: [], github: [], agents: [], feedback: [] };
  const base = plansControl();
  const plans = plansControl({
    plans: listed,
    listed: { plans: listed, archived: [], inbox: [], inboxPlans: [] },
    onSelect: (planId) => opened.plans.push(planId),
    onShowAgent: (_planId, agentId) => opened.agents.push(agentId),
    repositories: { ...base.repositories, openGitHub: (url) => opened.github.push(url) },
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: () => opened.inbox.push("inbox"),
      onClose: () => undefined,
      onChoose: (chosen) => opened.inbox.push(chosen),
    },
    factoryView: { open: true, onOpen: () => undefined, onClose: () => undefined },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const draw = (drawn: PlansControl) =>
    act(() =>
      root?.render(
        onRegistry(
          registry,
          createElement(
            OpenFeedbackProvider,
            { value: (about: Experiment) => opened.feedback.push(about) },
            createElement(DesktopFactory, { plans: drawn }),
          ),
        ),
      ),
    );
  draw(plans);
  return { page: container, opened };
}

/** A station's rows as a reader scans them: each row's words and task, and whether it waits on the developer. */
function rows(page: HTMLElement, step: string): string[] {
  const region = page.querySelector(`section[data-step="${step}"]`);
  assert.ok(region, `${step} stands`);
  return [...region.querySelectorAll(".sidebar-plan")].map((row) => {
    const words = row.querySelector(".sidebar-plan-name")?.textContent;
    const context = row.querySelector(".home-row-context")?.textContent;
    const waits = row.getAttribute("data-unread") === "true" ? " (waits)" : "";
    return `${words}${context === undefined ? "" : ` · ${context}`}${waits}`;
  });
}

function row(page: HTMLElement, words: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>(".sidebar-plan")].find(
    (each) => each.querySelector(".sidebar-plan-name")?.textContent === words,
  );
  assert.ok(found, `${words} stands`);
  return found;
}

test("each plan stands in its station, and what waits on the developer leads the station it holds up, each row naming its task", () => {
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES], {
    inbox: [
      {
        planId: BILLING.id,
        items: [
          {
            id: "i1",
            agentId: "a0000000-0000-4000-8000-000000000002",
            title: QUESTION,
            postedAt: NOW - 2 * HOUR,
          },
        ],
      },
    ],
  });
  assert.equal(
    page.querySelector(".factory-summary")?.textContent,
    "2 need you·1 agent working·0 shipped today",
  );
  // A draft with no agents stands nowhere; Talk holds only the task on a call.
  assert.deepEqual(rows(page, "talk"), []);
  assert.equal(
    page.querySelector('section[data-step="talk"] .factory-idle')?.textContent,
    "No task on a call",
  );
  assert.deepEqual(rows(page, "build"), [
    `${QUESTION} · Mercury payouts (waits)`,
    "Plan index · Search across plans",
  ]);
  assert.deepEqual(rows(page, "ship"), ["#2505 ready to merge · Workspace invites (waits)"]);
  // What waits stands in a list of its own, ahead of the work.
  const build = page.querySelector('section[data-step="build"]');
  assert.equal(build?.querySelector("[data-needs] .sidebar-plan-name")?.textContent, QUESTION);
  // The working agent wears the working mark; the stalled one its own mark at rest.
  const working = '.state-glyph[data-state="working"]';
  assert.ok(row(page, "Plan index").querySelector(working));
  assert.equal(row(page, QUESTION).querySelector(working), null);
  // A row that opens GitHub says so after its words.
  assert.match(row(page, "#2505 ready to merge").textContent ?? "", /\(opens on GitHub\)/u);
});

test("a question opens the Inbox on its item, an agent its page, a pull request ready to merge opens on GitHub, a plan opens itself, and Send feedback is about Factory", () => {
  const { page, opened } = mount([DRAFT, SEARCH, BILLING, INVITES], {
    callPlanId: DRAFT.id,
    inbox: [
      {
        planId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  act(() => row(page, QUESTION).click());
  act(() => row(page, "#2505 ready to merge").click());
  act(() => row(page, "Usage alerts").click());
  act(() => row(page, "Plan index").click());
  const feedback = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Send feedback",
  );
  assert.ok(feedback);
  act(() => feedback.click());
  assert.deepEqual(opened.feedback, [EXPERIMENT.FACTORY]);
  assert.deepEqual(opened.inbox, ["inbox", { planId: BILLING.id, itemId: "i1" }]);
  assert.deepEqual(opened.github, ["https://github.com/acme/relay/pull/2505"]);
  assert.deepEqual(opened.plans, [DRAFT.id]);
  assert.deepEqual(opened.agents, [AGENT_ID]);
});

test("the task on the call stands in Talk however old, and with nothing standing anywhere the page is the empty state, offering nothing to press", () => {
  const old = plan(5, "Factory tab", 10 * 24 * HOUR);
  const call = mount([old], { callPlanId: old.id });
  assert.deepEqual(rows(call.page, "talk"), ["Factory tab · On a call with Luke"]);
  act(() => root?.unmount());

  const { page } = mount([old]);
  assert.equal(page.querySelector(".empty-state h3")?.textContent, "No agents at work");
  assert.equal(page.querySelector("section[data-step]"), null);
  assert.equal(page.querySelector(".factory-scroll button"), null);
});

test("until the plan list is read nothing stands, not even the empty state", () => {
  const { page } = mount([], { listRead: false });
  assert.equal(page.querySelector(".factory-scroll")?.childElementCount, 0);
});

test("a plan list that could not be read says so, and Retry reads it again", () => {
  let retries = 0;
  const { page } = mount([], {
    listFailed: true,
    listRead: false,
    onRetryList: () => {
      retries += 1;
    },
  });
  const alert = page.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /Your tasks could not be read\./u);
  assert.equal(page.querySelector(".empty-state"), null);
  const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry);
  act(() => retry.click());
  assert.equal(retries, 1);
});

test("an agent whose turn failed waits first in Build wearing the failed mark and opens its page, and failing checks wait first in Ship and open on GitHub", () => {
  const failedAgent = "a0000000-0000-4000-8000-000000000009";
  const pooling = plan(6, "Connection pooling", HOUR, {
    agents: {
      total: 1,
      working: 0,
      agents: [
        {
          id: failedAgent,
          title: "PgBouncer pool",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          status: CODING_AGENT_STATUS.FAILED,
          at: NOW - HOUR,
        },
      ],
      pullRequestTotal: 1,
      pullRequests: [
        {
          number: 2507,
          title: "Retry deliveries",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.FAILING,
          additions: 10,
          deletions: 2,
          url: "https://github.com/acme/relay/pull/2507",
        },
      ],
    },
  });
  const { page, opened } = mount([SEARCH, pooling, INVITES]);
  assert.deepEqual(rows(page, "build"), [
    "PgBouncer pool failed · Connection pooling (waits)",
    "Plan index · Search across plans",
  ]);
  assert.deepEqual(rows(page, "ship"), [
    "#2507 checks failing · Connection pooling (waits)",
    "#2505 ready to merge · Workspace invites (waits)",
  ]);
  assert.ok(row(page, "PgBouncer pool failed").querySelector(".failed-mark"));
  assert.ok(row(page, "#2507 checks failing").querySelector(".failed-mark"));
  assert.equal(
    page.querySelector(".factory-summary")?.textContent,
    "3 need you·1 agent working·0 shipped today",
  );
  act(() => row(page, "PgBouncer pool failed").click());
  act(() => row(page, "#2507 checks failing").click());
  assert.deepEqual(opened.agents, [failedAgent]);
  assert.deepEqual(opened.github, ["https://github.com/acme/relay/pull/2507"]);
});

test("what merged in the last day stands in Ship, the latest first, counted in the summary, and more than Ship lists is counted after its rows", () => {
  const shipped = (n: number, name: string, ago: number) =>
    plan(10 + n, name, ago, {
      agents: {
        total: 0,
        working: 0,
        agents: [],
        pullRequestTotal: 1,
        pullRequests: [
          {
            number: 2600 + n,
            title: `PR ${n}`,
            state: PULL_REQUEST_STATE.MERGED,
            checks: CHECK_SUMMARY.PASSING,
            additions: 1,
            deletions: 1,
            url: `https://github.com/acme/relay/pull/${2600 + n}`,
          },
        ],
      },
    });
  const merged = [1, 2, 3, 4, 5].map((n) => shipped(n, `Shipped ${n}`, n * HOUR));
  const old = shipped(9, "Last week", 7 * 24 * HOUR);
  const { page } = mount([...merged, old]);
  assert.deepEqual(rows(page, "ship"), [
    "#2601 merged · Shipped 1",
    "#2602 merged · Shipped 2",
    "#2603 merged · Shipped 3",
    "#2604 merged · Shipped 4",
  ]);
  assert.equal(
    page.querySelector('section[data-step="ship"] .factory-more')?.textContent,
    "1 more",
  );
  assert.equal(
    page.querySelector(".factory-summary")?.textContent,
    "Nothing needs you·0 agents working·5 shipped today",
  );
});

test("a row wears a teammate's face before its time, whoever started its agent, else whoever created its task, and the reader's own wears none", () => {
  const charles = { userId: "user-charles", name: "Charles Pan" };
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const started = SEARCH.agents?.agents[0];
  assert.ok(started);
  const { page } = mount(
    [
      { ...DRAFT, ownerId: charles.userId, createdBy: charles },
      {
        ...SEARCH,
        ownerId: dean.userId,
        createdBy: dean,
        agents: {
          total: 2,
          working: 2,
          agents: [
            { ...started, startedBy: dean },
            {
              ...started,
              id: "a0000000-0000-4000-8000-000000000003",
              title: "Plan UI",
              startedBy: charles,
            },
          ],
          pullRequestTotal: 0,
          pullRequests: [],
        },
      },
    ],
    { me: dean.userId, callPlanId: DRAFT.id },
  );

  const face = (words: string) =>
    row(page, words).querySelector(".sidebar-plan-time .actor-mark")?.textContent ?? null;
  assert.equal(face(DRAFT.name), "C");
  assert.equal(face("Plan index"), null);
  assert.equal(face("Plan UI"), "C");
  assert.match(row(page, DRAFT.name).textContent ?? "", /\(created by Charles Pan\)/u);
});

test("a refresh that fails over a list read before keeps the line standing, and says so above it with Retry", () => {
  let retries = 0;
  const { page } = mount([SEARCH], {
    listFailed: true,
    onRetryList: () => {
      retries += 1;
    },
  });
  // The agent at work on the task read before still stands in Build.
  assert.ok(page.querySelector('section[data-step="build"] .sidebar-plan'));
  const alert = page.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /Your tasks could not be read\./u);
  const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry);
  act(() => retry.click());
  assert.equal(retries, 1);
});

test("a question's hover says it whole, which its one line cuts short", () => {
  const { page } = mount([BILLING], {
    inbox: [
      {
        planId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  act(() => {
    row(page, QUESTION).dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, QUESTION);
});
