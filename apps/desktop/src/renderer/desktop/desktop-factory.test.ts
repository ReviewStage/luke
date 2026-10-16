// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT, type Experiment } from "@luke/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { OpenFeedbackProvider } from "../open-feedback";
import type { InboxChoice, PlansControl } from "../planning/use-plans-tab";
import { DesktopFactory } from "./desktop-factory";

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const AGENT_ID = "a0000000-0000-4000-8000-000000000001";

function plan(n: number, name: string, ago: number, patch: Partial<TaskSummary> = {}): TaskSummary {
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
  document.head.innerHTML = "";
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
function mount(listed: readonly TaskSummary[], overrides: Partial<PlansControl> = {}) {
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
  /** The same page drawn again with some of its control changed, as a newer read hands it. */
  const redraw = (patch: Partial<PlansControl>) => draw({ ...plans, ...patch });
  /** The same page drawn again over another read of the plan list. */
  const rerender = (next: readonly TaskSummary[]) =>
    draw({ ...plans, plans: next, listed: { ...plans.listed, plans: next } });
  return { page: container, opened, redraw, rerender };
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

test("the stations' rows fade under the Factory bar as they scroll up beneath it, rather than being sliced at its hairline", () => {
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES]);
  const sheets = layFades();
  try {
    const scroller = page.querySelector(".factory-scroll") ?? assert.fail("the page scrolls");
    assert.deepEqual(fadedEdges(scroller), { top: true, bottom: false });
  } finally {
    sheets.remove();
  }
});

test("each plan stands in its station, and what waits on the developer leads the station it holds up, each row naming its task", () => {
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES], {
    inbox: [
      {
        taskId: BILLING.id,
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
    callTaskId: DRAFT.id,
    inbox: [
      {
        taskId: BILLING.id,
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
  const call = mount([old], { callTaskId: old.id });
  assert.deepEqual(rows(call.page, "talk"), ["Factory tab · On a call with Luke"]);
  act(() => root?.unmount());

  const { page } = mount([old]);
  assert.equal(page.querySelector(".empty-state p")?.textContent, "No agents at work");
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

test("what merged in the last day stands in Ship, every one of it and the latest first, and is counted in the summary", () => {
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
    "#2605 merged · Shipped 5",
  ]);
  assert.equal(page.querySelector(".factory-more"), null);
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
    { me: dean.userId, callTaskId: DRAFT.id },
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
        taskId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  act(() => {
    row(page, QUESTION).dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, QUESTION);
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("a question a teammate's agent asks, which main does not count as the reader's, waits in Build as Home lists it", async () => {
  const asked: InboxItem = {
    id: "b0000000-0000-4000-8000-000000000001",
    agentId: AGENT_ID,
    key: "1",
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: QUESTION,
    blocks: [],
    response: {
      type: INBOX_RESPONSE.CHOICE,
      options: [{ label: "Operating" }, { label: "Payroll" }],
    },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
  };
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: Act) => {
        if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        const value: CodingAgentInboxAnswerView = {
          items: request.payload.taskId === BILLING.id ? [asked] : [],
          cursor: "1",
        };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      },
    },
  });
  const { page } = mount([SEARCH, BILLING], {
    // Main's own count holds nothing: the agent is a teammate's.
    inbox: [],
    listed: {
      plans: [SEARCH, BILLING],
      archived: [],
      inbox: [],
      inboxPlans: [{ taskId: BILLING.id, items: 1, updatedAt: NOW - HOUR }],
    },
  });
  await settle();
  assert.deepEqual(rows(page, "build"), [
    `${QUESTION} · Mercury payouts (waits)`,
    "Plan index · Search across plans",
  ]);
});

/** The bridge answering a plan's Inbox read as `answer` says, counting the reads. */
function answerInbox(answer: (planId: string) => readonly InboxItem[] | undefined) {
  const counted = { reads: 0 };
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: Act) => {
        if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        counted.reads += 1;
        const items = answer(request.payload.taskId);
        if (items === undefined) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "No service." });
        }
        const value: CodingAgentInboxAnswerView = { items, cursor: "1" };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      },
    },
  });
  return counted;
}

test("a question answered since main last counted it leaves Build once the Inbox's read says so", async () => {
  answerInbox(() => []);
  const { page } = mount([SEARCH, BILLING], {
    inbox: [
      {
        taskId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
    listed: {
      plans: [SEARCH, BILLING],
      archived: [],
      inbox: [],
      inboxPlans: [{ taskId: BILLING.id, items: 1, updatedAt: NOW - HOUR }],
    },
  });
  await settle();
  assert.deepEqual(rows(page, "build"), ["Plan index · Search across plans"]);
});

test("questions that could not be read say so with Retry, and the reader's own still stand meanwhile", async () => {
  const counted = answerInbox(() => undefined);
  const { page } = mount([SEARCH, BILLING], {
    inbox: [
      {
        taskId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
    listed: {
      plans: [SEARCH, BILLING],
      archived: [],
      inbox: [],
      inboxPlans: [{ taskId: BILLING.id, items: 1, updatedAt: NOW - HOUR }],
    },
  });
  await settle();
  assert.equal(rows(page, "build")[0], `${QUESTION} · Mercury payouts (waits)`);
  const alert = page.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /Some questions could not be read\./u);
  const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry);
  const before = counted.reads;
  act(() => retry.click());
  await settle();
  assert.ok(counted.reads > before);
});

test("one plan's failed Inbox read keeps main's count for that plan alone: a question another plan's read shows answered stays gone", async () => {
  const counted = answerInbox((planId) => (planId === BILLING.id ? [] : undefined));
  const other = plan(7, "Invites", HOUR);
  const { page } = mount([SEARCH, BILLING, other], {
    inbox: [
      {
        taskId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
    listed: {
      plans: [SEARCH, BILLING, other],
      archived: [],
      inbox: [],
      inboxPlans: [
        { taskId: BILLING.id, items: 1, updatedAt: NOW - HOUR },
        { taskId: other.id, items: 1, updatedAt: NOW - HOUR },
      ],
    },
  });
  await settle();
  assert.ok(counted.reads >= 2);
  assert.deepEqual(rows(page, "build"), ["Plan index · Search across plans"]);
  assert.match(
    page.querySelector('[role="alert"]')?.textContent ?? "",
    /Some questions could not be read\./u,
  );
});

test("a question read that fails says so even while a refresh of the task list has failed over rows read before", async () => {
  answerInbox(() => undefined);
  const { page } = mount([SEARCH, BILLING], {
    listFailed: true,
    listRead: false,
    listed: {
      plans: [SEARCH, BILLING],
      archived: [],
      inbox: [],
      inboxPlans: [{ taskId: BILLING.id, items: 1, updatedAt: NOW - HOUR }],
    },
  });
  await settle();
  const alerts = [...page.querySelectorAll('[role="alert"]')].map((each) => each.textContent ?? "");
  assert.ok(alerts.some((each) => /Some questions could not be read\./u.test(each)));
  assert.ok(alerts.some((each) => /Your tasks could not be read\./u.test(each)));
});

test("a question main counts after a plan's last read stands while that plan's reread is out or failed", async () => {
  let fail = false;
  answerInbox(() => (fail ? undefined : []));
  const listed = (updatedAt: number) => ({
    plans: [SEARCH, BILLING],
    archived: [],
    inbox: [],
    inboxPlans: [{ taskId: BILLING.id, items: 1, updatedAt }],
  });
  const asked = {
    taskId: BILLING.id,
    items: [{ id: "i9", agentId: AGENT_ID, title: QUESTION, postedAt: NOW }],
  };
  const { page, redraw } = mount([SEARCH, BILLING], { listed: listed(NOW - HOUR) });
  await settle();
  assert.deepEqual(rows(page, "build"), ["Plan index · Search across plans"]);
  // Main counts a new question on the plan; its reread fails.
  fail = true;
  redraw({ listed: listed(NOW), inbox: [asked] });
  await settle();
  assert.equal(rows(page, "build")[0], `${QUESTION} · Mercury payouts (waits)`);
});

test("↓ from the window reaches the first row and moves on through the stations, and ↑ from the window the last", () => {
  const { page } = mount([DRAFT, SEARCH, INVITES], { callTaskId: DRAFT.id });
  const press = (key: string) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  const focused = () =>
    document.activeElement?.querySelector(".sidebar-plan-name")?.textContent ?? null;
  press("ArrowDown");
  assert.equal(focused(), "Usage alerts");
  press("ArrowDown");
  assert.equal(focused(), "Plan index");
  press("ArrowDown");
  assert.equal(focused(), "#2505 ready to merge");
  const reached = document.activeElement;
  assert.ok(reached instanceof HTMLElement);
  act(() => reached.blur());
  press("ArrowUp");
  assert.equal(focused(), "#2505 ready to merge");
  assert.ok(page.contains(document.activeElement));
});

test("an agent that fails while its row holds the keyboard keeps it, its row now leading Build", () => {
  const { page, rerender } = mount([SEARCH]);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  const name = () => document.activeElement?.querySelector(".sidebar-plan-name")?.textContent;
  assert.equal(name(), "Plan index");
  const working = SEARCH.agents;
  assert.ok(working);
  const failed: TaskSummary = {
    ...SEARCH,
    agents: {
      ...working,
      working: 0,
      agents: working.agents.map((each) => ({ ...each, status: CODING_AGENT_STATUS.FAILED })),
    },
  };
  rerender([failed]);
  assert.equal(name(), "Plan index failed");
  assert.ok(page.contains(document.activeElement));
});

test("a row's right-click offers Copy link, copying what a press on it opens: its task's link, its question's, its agent's, or its pull request's page", async () => {
  const copied: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
    },
  });
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES], {
    callTaskId: DRAFT.id,
    workspace: {
      id: "workspace-personal",
      slug: "acme",
      name: "Acme",
      role: "owner",
      github: null,
    },
    inbox: [
      {
        taskId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  const copyFrom = async (words: string) => {
    act(() => {
      row(page, words).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    assert.deepEqual(
      items.map((each) => each.textContent),
      ["Copy link"],
    );
    await act(async () => items[0]?.click());
  };
  await copyFrom("Usage alerts");
  await copyFrom(QUESTION);
  await copyFrom("Plan index");
  await copyFrom("#2505 ready to merge");
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DRAFT.id}`,
    `https://tryluke.dev/acme/plan/${BILLING.id}/inbox/i1`,
    `https://tryluke.dev/acme/plan/${SEARCH.id}/agent/${AGENT_ID}`,
    "https://github.com/acme/relay/pull/2505",
  ]);
});

test("an agent with no task stands in Build by its automation, opens its own page, and copies its own link", async () => {
  const sweep: TasklessAgent = {
    id: "c0000000-0000-4000-8000-000000000001",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Flake sweep",
    createdAt: NOW - 3 * MINUTE,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
    automationId: null,
    automationName: "Nightly flake sweep",
    workspaceId: "workspace-personal",
    repository: "acme/relay",
    activityAt: NOW - 3 * MINUTE,
  };
  const failed: TasklessAgent = {
    ...sweep,
    id: "c0000000-0000-4000-8000-000000000002",
    title: "Bump deps",
    automationName: "Dependency bumps",
    status: CODING_AGENT_STATUS.FAILED,
    activityAt: NOW - HOUR,
  };
  const pages: string[] = [];
  const copied: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
    },
  });
  const { page } = mount([SEARCH], {
    workspace: {
      id: "workspace-personal",
      slug: "acme",
      name: "Acme",
      role: "owner",
      github: null,
    },
    listedAgents: { standing: [sweep, failed], archived: [] },
    agentView: {
      agentId: undefined,
      onOpen: (agentId) => pages.push(agentId),
      onClose: () => undefined,
    },
  });
  assert.deepEqual(rows(page, "build"), [
    "Bump deps failed · Dependency bumps (waits)",
    "Plan index · Search across plans",
    "Flake sweep · Nightly flake sweep",
  ]);
  assert.equal(
    page.querySelector(".factory-summary")?.textContent?.includes("2 agents working"),
    true,
  );
  act(() => row(page, "Flake sweep").click());
  act(() => row(page, "Bump deps failed").click());
  assert.deepEqual(pages, [sweep.id, failed.id]);
  act(() => {
    row(page, "Flake sweep").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(copy);
  await act(async () => copy.click());
  assert.deepEqual(copied, [`https://tryluke.dev/acme/agent/${sweep.id}`]);
});

/** The line's width inside the scroller where the window leaves Factory this wide, less its insets. */
const LINE = {
  /** The window at its least width, 760, the sidebar folded. */
  NARROWEST: 720,
  /** A 1160 window beside the sidebar at its least, 200. */
  BESIDE_SIDEBAR: 920,
  /** A 1400 window beside the sidebar at its default, 264. */
  WIDE: 1096,
} as const;

/** How the line stands at a width: its stations across or down, which of them share the room the others leave, and which draw on one line. */
function lineAt(page: HTMLElement, width: number) {
  const style = layContainersAt({ factory: width });
  const line = page.querySelector(".factory-line-up") ?? assert.fail("the line stands");
  const stations = [...line.querySelectorAll<HTMLElement>("section[data-step]")];
  const named = (pick: (station: CSSStyleDeclaration) => boolean) =>
    stations.filter((station) => pick(getComputedStyle(station))).map((each) => each.dataset.step);
  const drawn = {
    stations: getComputedStyle(line).flexDirection === "column" ? "stacked" : "across",
    sharing: named((station) => station.flexGrow !== "0"),
    oneLine: named((station) => station.flexDirection === "row"),
  };
  style.remove();
  return drawn;
}

test("where three stations side by side could not each hold a readable row they stack, the idle Talk station one line over the rest; wide, they stand across, the idle one keeping to its words and the busy ones sharing the rest", () => {
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES]);
  assert.ok(page.querySelector('section[data-step="talk"] .factory-idle'), "Talk is idle");
  const stacked = { stations: "stacked", sharing: [], oneLine: ["talk"] };
  assert.deepEqual(lineAt(page, LINE.NARROWEST), stacked);
  assert.deepEqual(lineAt(page, LINE.BESIDE_SIDEBAR), stacked);
  assert.deepEqual(lineAt(page, LINE.WIDE), {
    stations: "across",
    sharing: ["build", "ship"],
    oneLine: [],
  });
});

test("a row's time ends the row whether or not it names a task beside its words, so the times stand in one column", () => {
  const { page } = mount([DRAFT, SEARCH, BILLING, INVITES]);
  const style = layContainersAt({});
  const times = [...page.querySelectorAll<HTMLElement>(".factory-row .sidebar-plan-time")];
  assert.ok(times.length > 0);
  for (const time of times) assert.equal(getComputedStyle(time).marginLeft, "auto");
  style.remove();
});
