// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationScope,
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
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { handState } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { tasksControl, waitingOf } from "#testing/tasks-control";
import { OpenSettingsProvider } from "../open-settings";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab";
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
/** An automation of the workspace's or of one member's own, made by `by`. */
function automation(
  n: number,
  name: string,
  by: string,
  scope: AutomationScope,
): AutomationSummary {
  return {
    id: `5a0c4d2e-0000-4c3a-9e7d-${String(n).padStart(12, "0")}`,
    planId: null,
    planName: null,
    workspaceId: "workspace-acme",
    name,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
    scope,
    creatorId: by,
  };
}

const AUTOMATIONS = [
  automation(1, "Morning Sentry triage", "user-charles", AUTOMATION_SCOPE.WORKSPACE),
  automation(2, "Charles's own reminders", "user-charles", AUTOMATION_SCOPE.PERSONAL),
  automation(3, "Weekly dependency bumps", "user-dean", AUTOMATION_SCOPE.WORKSPACE),
];

const PRIYA_PICTURE = "https://lh3.googleusercontent.com/a/photo-11";
/** Someone who left having only revised a task, whom no task or agent names. */
const OLA = { userId: "user-ola", name: "Ola Berg" };
const FORMER = [{ ...PRIYA, pictureUrl: PRIYA_PICTURE }, OLA];
const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
  { userId: "user-sam", name: "Sam Ortiz", email: "sam@example.com", role: WORKSPACE_ROLE.MEMBER },
];

function agent(
  n: number,
  title: string,
  startedBy: typeof CHARLES,
  status: TaskAgentLine["status"],
  ago: number,
): TaskAgentLine {
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
  agents: readonly TaskAgentLine[] = [],
): TaskSummary {
  const summary: TaskSummary = {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: ACME.id,
    name,
    createdAt: NOW - ago - MINUTE,
    updatedAt: NOW - ago,
    repository: "acme/relay",
    ownerId: createdBy.userId,
    createdBy,
  };
  if (agents.length === 0) return summary;
  return {
    ...summary,
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
const TASKS = [RETRIES, CACHE, DASHBOARD, SHIM];

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

/** An agent an automation started with no task, and the question it waits on in Acme. */
const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const SWEEP_ITEM: InboxItem = { ...item(9, "Quarantine the flaky test?", SWEEP_AGENT, MINUTE) };

const HOLDING: Pick<TasksControl, "inbox" | "inboxTasks"> = {
  inbox: [{ taskId: RETRIES.id, items: [waitingOf(RETRY_429), waitingOf(ROLLOUT)] }],
  inboxTasks: [{ taskId: RETRIES.id, items: 2, updatedAt: RETRY_429.updatedAt }],
};

let root: Root | undefined;
/** Whether the Inbox's reads are refused, as a read that failed is. */
let inboxRefused = false;
/** Whether the automations' reads are refused, as a read that failed is. */
let automationsRefused = false;
/** Whether the Inbox's reads are still out, answering nothing yet. */
let inboxHeld = false;
/** Whether the automations' reads are still out, answering nothing yet. */
let automationsHeld = false;
/** Whether the members read is held until the test answers it with `answerMembers`. */
let membersHeld = false;
/** Answers the held members read with the fixture's members. */
let answerMembers: () => void = () => undefined;
/** Every text the page asked the window to copy, in order. */
let copied: string[] = [];

beforeEach(() => {
  inboxRefused = false;
  automationsRefused = false;
  inboxHeld = false;
  automationsHeld = false;
  membersHeld = false;
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  window.localStorage.clear();
  fakeAppBridge({
    act: (request: Act) => {
      const inbox =
        request.kind === ACT_KIND.CODING_AGENTS_INBOX ||
        request.kind === ACT_KIND.CODING_AGENTS_AGENT_INBOX;
      if (inbox && inboxHeld) return new Promise(() => undefined);
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST && automationsHeld) {
        return new Promise(() => undefined);
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && membersHeld) {
        return new Promise((resolve) => {
          answerMembers = () => resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
        });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_AGENT_INBOX) {
        const value: CodingAgentInboxAnswerView = { items: [SWEEP_ITEM], cursor: "1" };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST && !automationsRefused) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { automations: AUTOMATIONS },
        });
      }
      if (request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: FORMER });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX && !inboxRefused) {
        const value: CodingAgentInboxAnswerView = {
          items: INBOXES.get(request.payload.taskId) ?? [],
          cursor: "1",
        };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
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
  readonly settings: SettingsLink[];
}

/** `userId`'s page over the fixture workspace, read by Dean, opened knowing `name`, every door it opens recorded. */
function mount(userId: string, name?: string, memberCount = MEMBERS.length) {
  return mountWith({}, userId, name, memberCount);
}

/** Dean's page by default, over the fixture workspace with `overrides`, every door it opens recorded. */
function mountWith(
  overrides: Partial<TasksControl>,
  userId = DEAN.userId,
  name?: string,
  memberCount = MEMBERS.length,
) {
  const opened: Opened = { plans: [], agents: [], inbox: [], settings: [] };
  const tasks = tasksControl({
    me: DEAN.userId,
    workspace: { ...ACME, memberCount },
    tasks: TASKS,
    listed: { tasks: TASKS, archived: [], ...HOLDING },
    ...HOLDING,
    onSelect: (taskId) => opened.plans.push(taskId),
    onShowAgent: (taskId, agentId) => opened.agents.push([taskId, agentId]),
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: () => opened.inbox.push("inbox"),
      onClose: () => undefined,
      onChoose: (chosen) => opened.inbox.push(chosen),
      pages: undefined,
      onRereadPages: () => undefined,
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.settings.push(link) },
          createElement(PersonPage, { tasks: tasks, userId, name }),
        ),
      ),
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
      [...section.querySelectorAll(".sidebar-task-name, .luke-list-row-title")].map(
        (name) => name.textContent,
      ),
    ]),
  );
}

function head(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".person-head p")].map((line) => line.textContent ?? "");
}

/** What each placeholder on the page says it is waiting on, in order. */
function waits(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="status"][aria-busy="true"]')].map(
    (region) => region.textContent ?? "",
  );
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
  assert.deepEqual(opened.inbox, ["inbox", { taskId: RETRIES.id, itemId: RETRY_429.id }]);
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

test("the reader's own page lists no question of an agent with no task, whose starter nobody names", async () => {
  const { page } = mountWith({
    inboxTaskless: [
      {
        id: SWEEP_ITEM.id,
        agentId: SWEEP_AGENT,
        title: SWEEP_ITEM.title,
        postedAt: SWEEP_ITEM.postedAt,
        agentTitle: "Flake sweep",
        agentModel: "anthropic/claude-opus-5.5",
        automationId: null,
        automationName: null,
        repository: "acme/relay",
        workspaceId: ACME.id,
      },
    ],
  });
  await settle();

  assert.deepEqual(sections(page)["Waiting on you"], ["Ship the limiter at 10%?"]);
});

/** The sidebar's views as this Mac keeps them, by workspace. */
function keptViews(): Record<string, { createdBy?: string }> {
  return JSON.parse(window.localStorage.getItem("luke.sidebarTaskViews") ?? "{}");
}

test("Their tasks in sidebar lists the sidebar's tasks by them", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  button(page, "Their tasks in sidebar").click();
  assert.equal(keptViews()[ACME.id]?.createdBy, CHARLES.userId);
});

test("a workspace of one offers no sidebar filter, since its sidebar filters by nobody", async () => {
  const { page } = mount(DEAN.userId, undefined, 1);
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /tasks in sidebar/u);
});

test("the reader's own page offers nothing to edit: its toolbar lists their tasks in the sidebar and ⋯ alone", async () => {
  const { page } = mount(DEAN.userId);
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".desktop-toolbar-actions button")].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    ["My tasks in sidebar", "More"],
  );
});

test("More offers their page's link and a member's email to copy and, to an owner, the workspace's members in Settings", async () => {
  const { page, opened } = mount(CHARLES.userId);
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click());
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Copy link", "Copy email", "Manage in workspace settings"],
  );
  act(() => items[2]?.click());
  assert.deepEqual(opened.settings, [
    { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id, section: SETTINGS_SECTION.MEMBERS },
  ]);
});

test("Their tasks in sidebar turns the sidebar back from its archived tasks to the tasks it lists", async () => {
  window.sessionStorage.setItem("luke.sidebarArchivedIn", ACME.id);
  const { page } = mount(CHARLES.userId);
  await settle();

  button(page, "Their tasks in sidebar").click();

  assert.equal(window.sessionStorage.getItem("luke.sidebarArchivedIn"), null);
  assert.equal(keptViews()[ACME.id]?.createdBy, CHARLES.userId);
});

test("someone who left offers only their page's link in More: no email to copy, and no row in Settings to manage", async () => {
  const { page } = mount(PRIYA.userId);
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click());
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ["Copy link"],
  );
});

test("Copy link copies their page's link under the slug of the workspace it stands in, and says Link copied", async () => {
  const { page } = mountWith(
    {
      workspaces: [{ ...ACME, slug: "acme" }],
      personView: {
        ...tasksControl().personView,
        userId: CHARLES.userId,
        workspaceId: ACME.id,
      },
    },
    CHARLES.userId,
  );
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click());
  act(() => button(document.body, "Copy link").click());
  await settle();

  assert.deepEqual(copied, ["https://tryluke.dev/acme/person/user-charles"]);
});

test("a page for someone neither the members nor those who left name, as a link from outside the workspace opens, says it is not found", async () => {
  const { page } = mount("user-stranger");
  await settle();

  assert.match(page.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('button[aria-label="More"]'), null);
});

test("someone who left heads their page with their own picture", async () => {
  const { page } = mount(PRIYA.userId);
  await settle();

  const face = page.querySelector<HTMLElement>(".person-head .actor-mark");
  assert.equal(face?.querySelector("img")?.getAttribute("src"), PRIYA_PICTURE);
});

test("with Automations on, a person's page lists the workspace's automations they made, never their own personal ones", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const { page } = mount(CHARLES.userId);
  await settle();

  assert.deepEqual(sections(page).Automations, ["Morning Sentry triage"]);
});

test("with Automations off, a person's page reads no automations and lists none", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  assert.equal(sections(page).Automations, undefined);
});

test("automations that could not be read say so and offer Retry, never passing for an empty page, and Retry reads them again", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  automationsRefused = true;
  const { page } = mount("user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Their automations could not be read\./u);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);

  automationsRefused = false;
  act(() => button(page, "Retry").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
  assert.match(page.textContent ?? "", /Nothing of theirs here yet\./u);
});

test("automations that could not be read leave the Inbox still being read saying so, each read saying its own state", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  automationsRefused = true;
  inboxHeld = true;
  const { page } = mount("user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Their automations could not be read\./u);
  // The Inbox still being read stands as its own wait beside the automations' failure.
  assert.deepEqual(waits(page), ["Reading your inbox…"]);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("while the Inbox and the automations are read, placeholder rows stand for each, never a spinner", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  inboxHeld = true;
  automationsHeld = true;
  const { page } = mount("user-sam");
  await settle();

  assert.deepEqual(waits(page), ["Reading your inbox…", "Reading their automations…"]);
  assert.equal(page.querySelector(".luke-spinner"), null);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("a page opened by a member's id alone stands a placeholder head while the members are read, never Someone not in this workspace nor an empty page", async () => {
  membersHeld = true;
  const { page } = mount("user-sam");
  await settle();

  assert.deepEqual(waits(page), ["Reading who they are…"]);
  assert.doesNotMatch(page.textContent ?? "", /Someone|Not in this workspace|Nothing of theirs/u);

  answerMembers();
  await settle();

  assert.deepEqual(waits(page), []);
  assert.deepEqual(head(page), ["Sam Ortiz", "Member · sam@example.com"]);
});

test("while the task list is read, placeholder rows stand for their tasks and the page is never called empty", async () => {
  const { page } = mountWith({ listRead: false }, "user-sam");
  await settle();

  assert.deepEqual(waits(page), ["Reading their tasks…"]);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("a task list that could not be read says so and offers Retry, never calling the page empty", async () => {
  const { page } = mountWith({ listRead: false, listFailed: true }, "user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Their tasks could not be read\./u);
  assert.ok(button(page, "Retry"));
  assert.deepEqual(waits(page), []);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("a link to someone who left whom only the former members read names opens their page, not Not found", async () => {
  const { page } = mount(OLA.userId);
  await settle();

  assert.deepEqual(head(page), [OLA.name, "Former member"]);
  assert.doesNotMatch(page.textContent ?? "", /Not found/u);
});
