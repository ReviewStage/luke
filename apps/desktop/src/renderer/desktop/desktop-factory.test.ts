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
  readonly feedback: Experiment[];
  newPlans: number;
}

/** Factory over `listed`, what waits, and the call, every door it opens recorded. */
function mount(listed: readonly PlanSummary[], overrides: Partial<PlansControl> = {}) {
  const opened: Opened = { plans: [], inbox: [], github: [], feedback: [], newPlans: 0 };
  const base = plansControl();
  const plans = plansControl({
    plans: listed,
    listed: { plans: listed, archived: [], inbox: [], inboxPlans: [] },
    onSelect: (planId) => opened.plans.push(planId),
    onNewPlan: () => {
      opened.newPlans += 1;
    },
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
  /** The same page drawn again over another read of the plan list. */
  const rerender = (next: readonly PlanSummary[]) =>
    draw({
      ...plans,
      plans: next,
      listed: { plans: next, archived: [], inbox: [], inboxPlans: [] },
    });
  return { page: container, opened, rerender };
}

/** A step's rows as a reader scans them: each row's words, and whether it waits on the developer. */
function rows(page: HTMLElement, step: string): string[] {
  const region = page.querySelector(`section[data-step="${step}"]`);
  assert.ok(region, `${step} stands`);
  return [...region.querySelectorAll(".sidebar-plan")].map(
    (row) =>
      `${row.querySelector(".sidebar-plan-name")?.textContent}${row.getAttribute("data-unread") === "true" ? " (waits)" : ""}`,
  );
}

function row(page: HTMLElement, words: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>(".sidebar-plan")].find(
    (each) => each.querySelector(".sidebar-plan-name")?.textContent === words,
  );
  assert.ok(found, `${words} stands`);
  return found;
}

test("each plan stands in its step, and what waits on the developer stands at the foot of the step it holds up, the question first and in full", () => {
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
    "1 question and 1 merge need you·1 agent working on 1 plan",
  );
  assert.deepEqual(rows(page, "plan"), ["Usage alerts"]);
  assert.deepEqual(rows(page, "build"), ["Search across plans", `${QUESTION} (waits)`]);
  assert.deepEqual(rows(page, "ship"), ["Workspace invites (waits)"]);
  const overs = [...page.querySelectorAll(".factory-over")].map((each) => each.textContent);
  assert.deepEqual(overs, ["Waiting for you · start here", "Waiting for you · then"]);
  // The stalled agent's row wears the question, where the working agent's wears the working mark.
  const working = '.state-glyph[data-state="working"]';
  assert.ok(row(page, "Search across plans").querySelector(working));
  const asking = row(page, QUESTION);
  assert.ok(asking.querySelector(".factory-asking"));
  assert.equal(asking.querySelector(working), null);
});

test("a question opens the Inbox on its item, a pull request ready to merge opens on GitHub, a plan opens itself, and Send feedback is about Factory", () => {
  const { page, opened } = mount([DRAFT, BILLING, INVITES], {
    inbox: [
      {
        planId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  act(() => row(page, QUESTION).click());
  act(() => row(page, "Workspace invites").click());
  act(() => row(page, "Usage alerts").click());
  const feedback = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Send feedback",
  );
  assert.ok(feedback);
  act(() => feedback.click());
  assert.deepEqual(opened.feedback, [EXPERIMENT.FACTORY]);
  assert.deepEqual(opened.inbox, ["inbox", { planId: BILLING.id, itemId: "i1" }]);
  assert.deepEqual(opened.github, ["https://github.com/acme/relay/pull/2505"]);
  assert.deepEqual(opened.plans, [DRAFT.id]);
});

test("the plan on the call stands in Plan however old, and with nothing standing anywhere the page says so and offers New plan", () => {
  const old = plan(5, "Factory tab", 10 * 24 * HOUR);
  const call = mount([old], { callPlanId: old.id });
  assert.deepEqual(rows(call.page, "plan"), ["Factory tab"]);
  act(() => root?.unmount());

  const { page, opened } = mount([old]);
  assert.equal(
    page.querySelector(".factory-summary")?.textContent,
    "Nothing is happening right now.",
  );
  const newPlan = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith("New plan"),
  );
  assert.ok(newPlan);
  act(() => newPlan.click());
  assert.equal(opened.newPlans, 1);
});

test("with only merges waiting, the summary opens the first one on GitHub; with a question waiting, it opens the Inbox", () => {
  const merges = mount([INVITES]);
  act(() => merges.page.querySelector<HTMLButtonElement>(".factory-needs")?.click());
  assert.deepEqual(merges.opened.github, ["https://github.com/acme/relay/pull/2505"]);
  assert.deepEqual(merges.opened.inbox, []);
  act(() => root?.unmount());

  const asked = mount([BILLING, INVITES], {
    inbox: [
      {
        planId: BILLING.id,
        items: [{ id: "i1", agentId: AGENT_ID, title: QUESTION, postedAt: NOW - HOUR }],
      },
    ],
  });
  act(() => asked.page.querySelector<HTMLButtonElement>(".factory-needs")?.click());
  assert.deepEqual(asked.opened.inbox, ["inbox"]);
  assert.deepEqual(asked.opened.github, []);
});

test("more pull requests shipping at once than Ship lists are counted after its rows", () => {
  const shipping = (state: (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE]) =>
    [1, 2, 3, 4, 5].map((n) =>
      plan(10 + n, `Shipped ${n}`, HOUR, {
        agents: {
          total: 0,
          working: 0,
          agents: [],
          pullRequestTotal: 1,
          pullRequests: [
            {
              number: 2600 + n,
              title: `PR ${n}`,
              state,
              checks: CHECK_SUMMARY.PASSING,
              additions: 1,
              deletions: 1,
              url: `https://github.com/acme/relay/pull/${2600 + n}`,
            },
          ],
        },
      }),
    );
  const { page, rerender } = mount(shipping(PULL_REQUEST_STATE.DRAFT));
  rerender(shipping(PULL_REQUEST_STATE.MERGED));
  assert.equal(rows(page, "ship").length, 4);
  assert.equal(
    page.querySelector('section[data-step="ship"] .factory-more')?.textContent,
    "1 more",
  );
});
