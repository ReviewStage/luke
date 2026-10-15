// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { PlanAgentLine, PlanSummary } from "@luke/features/plan-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl, waitingOf } from "#testing/plans-control";
import type { InboxChoice, PlansControl } from "../planning/use-plans-tab";
import { PersonPage } from "./person-page";

/**
 * A person's page lists what of theirs the listed workspace holds, and
 * nobody else's: their agents at work, the Inbox items their agents wait
 * on, the tasks they created, and their other agents. It names them as the
 * members read does, the reader as You, and someone who left as a former
 * member. Synthetic accounts.
 */

const NOW = Date.now();
const MINUTE = 60_000;
const ACME = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const PRIYA = { userId: "user-priya", name: "Priya Raman" };
const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
  { userId: "user-sam", name: "Sam Ortiz", email: "sam@example.com", role: WORKSPACE_ROLE.MEMBER },
];

function agent(
  n: number,
  title: string,
  startedBy: typeof CHARLES,
  status: PlanAgentLine["status"],
  ago: number,
): PlanAgentLine {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status,
    at: NOW - ago,
    startedBy,
  };
}

function task(
  n: number,
  name: string,
  createdBy: typeof CHARLES,
  ago: number,
  agents: readonly PlanAgentLine[] = [],
): PlanSummary {
  const plan: PlanSummary = {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: ACME.id,
    name,
    createdAt: NOW - ago - MINUTE,
    updatedAt: NOW - ago,
    repository: "acme/relay",
    ownerId: createdBy.userId,
    createdBy,
  };
  if (agents.length === 0) return plan;
  return {
    ...plan,
    agents: {
      total: agents.length,
      working: 0,
      agents,
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

const BACKOFF = agent(1, "Jittered backoff", CHARLES, CODING_AGENT_STATUS.RUNNING, 12 * MINUTE);
const CACHE_KEYS = agent(
  2,
  "Tenant cache keys",
  CHARLES,
  CODING_AGENT_STATUS.COMPLETED,
  3 * 60 * MINUTE,
);
const LIMITER = agent(3, "Limiter flag", DEAN, CODING_AGENT_STATUS.RUNNING, 30 * MINUTE);

const RETRIES = task(1, "Relay retries on 502", CHARLES, 12 * MINUTE, [BACKOFF, LIMITER]);
const CACHE = task(2, "Edge cache keys", DEAN, 3 * 60 * MINUTE, [CACHE_KEYS]);
const DASHBOARD = task(3, "Retry budget dashboard", CHARLES, 2 * 24 * 60 * MINUTE);
const SHIM = task(4, "Old auth shim removal", PRIYA, 9 * 24 * 60 * MINUTE);
const PLANS = [RETRIES, CACHE, DASHBOARD, SHIM];

function item(n: number, title: string, agentId: string, ago: number): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
    agentId,
    key: String(n),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.CHOICE, options: [{ label: "Yes" }, { label: "No" }] },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: NOW - ago,
    updatedAt: NOW - ago,
  };
}

const RETRY_429 = item(1, "Retry 429s too?", BACKOFF.id, 8 * MINUTE);
const ROLLOUT = item(2, "Ship the limiter at 10%?", LIMITER.id, 20 * MINUTE);
const INBOXES = new Map<string, readonly InboxItem[]>([[RETRIES.id, [RETRY_429, ROLLOUT]]]);

const HOLDING: Pick<PlansControl, "inbox" | "inboxPlans"> = {
  inbox: [{ planId: RETRIES.id, items: [waitingOf(RETRY_429), waitingOf(ROLLOUT)] }],
  inboxPlans: [{ planId: RETRIES.id, items: 2, updatedAt: RETRY_429.updatedAt }],
};

let root: Root | undefined;
/** Whether the Inbox's reads are refused, as a read that failed is. */
let inboxRefused = false;

beforeEach(() => {
  inboxRefused = false;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_INBOX && !inboxRefused) {
          const value: CodingAgentInboxAnswerView = {
            items: INBOXES.get(request.payload.planId) ?? [],
            cursor: "1",
          };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
      },
    },
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
  readonly agents: [string, string][];
  readonly inbox: (InboxChoice | "inbox")[];
}

/** `userId`'s page over the fixture workspace, read by Dean, opened knowing `name`, every door it opens recorded. */
function mount(userId: string, name?: string) {
  const opened: Opened = { plans: [], agents: [], inbox: [] };
  const plans = plansControl({
    me: DEAN.userId,
    workspace: { ...ACME, memberCount: MEMBERS.length },
    plans: PLANS,
    listed: { plans: PLANS, archived: [], ...HOLDING },
    ...HOLDING,
    onSelect: (planId) => opened.plans.push(planId),
    onShowAgent: (planId, agentId) => opened.agents.push([planId, agentId]),
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: () => opened.inbox.push("inbox"),
      onClose: () => undefined,
      onChoose: (chosen) => opened.inbox.push(chosen),
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), createElement(PersonPage, { plans, userId, name })),
    ),
  );
  return { page: container, opened };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Each section the page draws, by its name, with its rows' names. */
function sections(page: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    [...page.querySelectorAll("section.home-section")].map((section) => [
      section.getAttribute("aria-label"),
      [...section.querySelectorAll(".sidebar-plan-name")].map((name) => name.textContent),
    ]),
  );
}

function head(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".person-head p")].map((line) => line.textContent ?? "");
}

function button(page: HTMLElement, text: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith(text),
  );
  assert.ok(found, `${text} stands`);
  return found;
}

test("a teammate's page names them as the members read does and lists their work alone", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  assert.deepEqual(head(page), ["Charles Pan", "Member · charles@example.com"]);
  assert.deepEqual(sections(page), {
    "Working now": ["Jittered backoff"],
    "Waiting on their answer": ["Retry 429s too?"],
    Created: ["Relay retries on 502", "Retry budget dashboard"],
    Agents: ["Tenant cache keys"],
  });
});

test("the reader's own page says You and what waits on them", async () => {
  const { page } = mount(DEAN.userId);
  await settle();

  assert.deepEqual(head(page), ["Dean StratakosYou", "Owner · dean@example.com"]);
  assert.deepEqual(sections(page), {
    "Working now": ["Limiter flag"],
    "Waiting on you": ["Ship the limiter at 10%?"],
    "Created by you": ["Edge cache keys"],
  });
});

test("someone who left is named as a former member, with what of theirs the workspace still holds", async () => {
  const { page } = mount(PRIYA.userId);
  await settle();

  assert.deepEqual(head(page), ["Priya Raman", "Former member"]);
  assert.deepEqual(sections(page), { Created: ["Old auth shim removal"] });
});

test("a member with nothing here yet is named, and the page says there is nothing", async () => {
  const { page } = mount("user-sam");
  await settle();

  assert.deepEqual(head(page), ["Sam Ortiz", "Member · sam@example.com"]);
  assert.deepEqual(sections(page), {});
  assert.match(page.textContent ?? "", /Nothing of theirs here yet\./u);
});

test("each row opens what it names: an agent its tab, an item the Inbox on it, and a task the task", async () => {
  const { page, opened } = mount(CHARLES.userId);
  await settle();

  button(page, "Jittered backoff").click();
  button(page, "Retry 429s too?").click();
  button(page, "Retry budget dashboard").click();

  assert.deepEqual(opened.agents, [[RETRIES.id, BACKOFF.id]]);
  assert.deepEqual(opened.inbox, ["inbox", { planId: RETRIES.id, itemId: RETRY_429.id }]);
  assert.deepEqual(opened.plans, [DASHBOARD.id]);
});

test("a person's tasks wear no face of theirs, since the page's head already says whose they are", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  const created = page.querySelector('section[aria-label="Created"]');
  assert.equal(created?.querySelectorAll(".actor-mark").length, 0);
});

test("an Inbox that could not be read says so and offers Retry, and never passes for an empty page", async () => {
  inboxRefused = true;
  const { page } = mount("user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Some Inbox items could not be read\./u);
  assert.ok(button(page, "Retry"));
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("someone who left whom only the place that opened the page names keeps that name, as a former member", async () => {
  const { page } = mount("user-lee", "Lee Park");
  await settle();

  assert.deepEqual(head(page), ["Lee Park", "Former member"]);
});
