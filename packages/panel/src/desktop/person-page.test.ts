// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationScope,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { CODING_AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { TASK_STATUS, type TaskAgentLine, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge, refusedOnPort } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { restOn } from "../testing/hint-rest.js";
import { playListMotions } from "../testing/pane-motion.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { PersonPage } from "./person-page.js";

/**
 * A person's page lists what of theirs the listed workspace holds, and
 * nobody else's: their agents at work, the Inbox items their agents wait
 * on, the tasks assigned to them, the rest of the tasks they created, and
 * their other agents. It names them as the
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
  overrides: Partial<AutomationSummary> = {},
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
    ...overrides,
  };
}

const AUTOMATIONS = [
  automation(1, "Morning Sentry triage", "user-charles", AUTOMATION_SCOPE.WORKSPACE, {
    nextRunAt: NOW + 2 * MINUTE,
    lastRun: {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "unavailable",
      agent: null,
      firedAt: 2,
      settledAt: 3,
    },
  }),
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
  assignee?: typeof CHARLES,
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
    ...(assignee === undefined ? undefined : { assignee }),
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
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `e1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: title,
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes" }, { label: "No" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: NOW - ago,
      },
    ],
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
/** Whether the members read is refused, as a read that failed is. */
let membersRefused = false;
/** Whether the read of who left is refused, as a read that failed is. */
let formerRefused = false;
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
  membersRefused = false;
  formerRefused = false;
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  window.localStorage.clear();
  fakeAppBridge({});
  // The host pushes each task's inbox, and the sweep agent's, as it is followed, unless the test holds or refuses them.
  const host = followedInboxes(({ kind, id }) => {
    if (inboxHeld) return undefined;
    if (kind === INBOX_SCOPE_KIND.AGENT) return { items: [SWEEP_ITEM] };
    return inboxRefused
      ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
      : { items: INBOXES.get(id) ?? [] };
  });
  fakeActPort({
    ...host.procedures,
    [ACT_KIND.AUTOMATIONS_LIST]: () => {
      if (automationsHeld) return new Promise(() => undefined);
      if (automationsRefused) return Promise.reject(refusedOnPort("Not here."));
      return Promise.resolve({ automations: AUTOMATIONS });
    },
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => {
      if (membersHeld) {
        return new Promise((resolve) => {
          answerMembers = () => resolve(MEMBERS);
        });
      }
      return membersRefused ? Promise.reject(refusedOnPort("Not here.")) : Promise.resolve(MEMBERS);
    },
    // An agent read by its own id stands at rest, as its page reads it.
    [ACT_KIND.CODING_AGENTS_PAGE]: ({ agentId }: { agentId: string }) =>
      Promise.resolve({
        agent: {
          id: agentId,
          planId: CACHE.id,
          model: CACHE_KEYS.model,
          effort: CACHE_KEYS.effort,
          title: CACHE_KEYS.title,
          createdAt: 1,
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          automationId: null,
          workspaceId: ACME.id,
          repository: "acme/relay",
          startedBy: CHARLES,
        },
      }),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () =>
      formerRefused ? Promise.reject(refusedOnPort("Not here.")) : Promise.resolve(FORMER),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Every door the page opens, in order. */
interface Opened {
  readonly tasks: string[];
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
  away?: { label: string; onPress: () => void },
) {
  const opened: Opened = { tasks: [], agents: [], inbox: [], settings: [] };
  const control = (more: Partial<TasksControl>) =>
    tasksControl({
      me: DEAN.userId,
      workspace: { ...ACME, memberCount },
      tasks: TASKS,
      listed: { tasks: TASKS, ...HOLDING },
      ...HOLDING,
      onSelect: (taskId) => opened.tasks.push(taskId),
      onShowAgent: (taskId, agentId) => opened.agents.push([taskId, agentId]),
      inboxView: {
        open: false,
        chosen: undefined,
        onOpen: () => opened.inbox.push("inbox"),
        onClose: () => undefined,
        onChoose: (chosen) => opened.inbox.push(chosen),
        onOpenItem: (chosen) => opened.inbox.push(chosen),
        listed: false,
        onListed: () => undefined,
        pages: undefined,
        onTaskAgents: () => undefined,
      },
      ...overrides,
      ...more,
    });
  const registry = AtomRegistry.make();
  const draw = (tasks: TasksControl) =>
    act(() =>
      root?.render(
        onRegistry(
          registry,
          createElement(
            OpenSettingsProvider,
            { value: (link: SettingsLink) => opened.settings.push(link) },
            createElement(PersonPage, { tasks, userId, name, away }),
          ),
        ),
      ),
    );
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  draw(control({}));
  /** Draws the page again over the workspace with `more` on top of what it was mounted with. */
  const redraw = (more: Partial<TasksControl>) => draw(control(more));
  return { page: container, opened, redraw };
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
      [...section.querySelectorAll(".luke-list-row-title")].map((name) => name.textContent),
    ]),
  );
}

/** What an element says to a reader: its words without its marks, which are hidden from one. */
function said(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? "";
}

/** The page's header: its title, and the line under it. */
function head(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".luke-page-header-heading > *")].map(said);
}

/** The page's headings of the first level. */
function titles(page: HTMLElement): string[] {
  return [...page.querySelectorAll("h1")].map(said);
}

/** What each placeholder on the page says it is waiting on, in order. */
function waits(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="status"][aria-busy="true"]')].map(
    (region) => region.textContent ?? "",
  );
}

/** Opens the menu of the row named `name` by its ⋯, named for the row's `thing`, and answers its items' words. */
function openRowMenu(page: HTMLElement, name: string, thing: string): string[] {
  const more = button(page, name)
    .closest("li")
    ?.querySelector<HTMLButtonElement>(`button[aria-label="${thing} actions"]`);
  act(() => (more ?? assert.fail(`${name} offers its ⋯`)).click());
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
}

/** A page over the fixture workspace with its slug, standing in it, as a link opens it. */
function mountLinked(userId: string) {
  return mountWith(
    {
      workspaces: [{ ...ACME, slug: "acme" }],
      personView: { ...tasksControl().personView, userId, workspaceId: ACME.id },
    },
    userId,
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
    Automations: ["Morning Sentry triage"],
  });
});

test("the page names its person once: exactly one h1, their name, and no second heading saying it", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  assert.deepEqual(titles(page), ["Charles Pan"]);
  assert.equal(said(page).split("Charles Pan").length - 1, 1);
});

test("the reader's own page says You and what waits on them", async () => {
  const { page } = mount(DEAN.userId);
  await settle();

  assert.deepEqual(head(page), ["Dean Stratakos", "You Owner · dean@example.com"]);
  assert.deepEqual(sections(page), {
    "Working now": ["Limiter flag"],
    "Needs you": ["Ship the limiter at 10%?"],
    "Created by you": ["Edge cache keys"],
    Automations: ["Weekly dependency bumps"],
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
  assert.deepEqual(opened.inbox, [{ taskId: RETRIES.id, itemId: RETRY_429.id }]);
  assert.deepEqual(opened.tasks, [DASHBOARD.id]);
});

test("a waiting item is the Inbox's own row: its task named on a line of its own over its preview, its time at the end, and its card hung beside it, which names the agent its row leaves out", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  const row = button(page, "Retry 429s too?");
  assert.equal(row.querySelector(".home-row-context"), null, "no task name at the row's end");
  const lead = row.querySelector('.luke-list-row-lead[data-at="line"]');
  assert.equal(lead?.textContent, RETRIES.name);
  assert.equal(
    lead?.closest(".luke-list-row-description"),
    null,
    "the task stands on its own line",
  );
  assert.equal(row.querySelector('.actor-mark[data-kind="agent"]'), null, "no agent's tile leads");
  assert.ok(row.querySelector(".home-row-meta time"), "its time stands at its end");

  restOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-inbox-row-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, RETRY_429.title);
});

test("an agent's row says its failure at its end and hangs the agent's card while rested on, as the sidebar's row does", async () => {
  const broken = agent(9, "Flaky retry", CHARLES, CODING_AGENT_STATUS.FAILED, 5 * MINUTE);
  const failing = task(9, "Retry flake hunt", CHARLES, 5 * MINUTE, [broken]);
  const { page } = mountWith(
    { tasks: [...TASKS, failing], listed: { tasks: [...TASKS, failing], ...HOLDING } },
    CHARLES.userId,
  );
  await settle();

  const row = button(page, "Flaky retry");
  assert.ok(row.querySelector(".failed-mark"));
  assert.equal(button(page, "Jittered backoff").querySelector(".failed-mark"), null);

  restOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Flaky retry");
});

test("an Inbox that could not be read says so and offers Retry, and never passes for an empty page", async () => {
  inboxRefused = true;
  const { page } = mount("user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Some inbox items could not be read\./u);
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

  assert.deepEqual(sections(page)["Needs you"], ["Ship the limiter at 10%?"]);
});

/** The sidebar's views as this Mac keeps them, by workspace. */
function keptViews(): Record<string, { createdBy?: string; assignedTo?: string }> {
  return JSON.parse(window.localStorage.getItem("luke.sidebarTaskViews") ?? "{}");
}

test("Show their tasks in the sidebar lists every task assigned to them, letting go of a filter by creator", async () => {
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({
      [ACME.id]: { grouping: "repository", order: "updated", createdBy: DEAN.userId },
    }),
  );
  const { page } = mount(CHARLES.userId);
  await settle();

  button(page, "Show their tasks in the sidebar").click();
  const kept = keptViews()[ACME.id];
  assert.deepEqual([kept?.assignedTo, kept?.createdBy], [CHARLES.userId, undefined]);
});

test("a person's tasks assigned to them stand above those they created, a task both listed once as assigned, and its foot counts the two it leaves out and lists every one assigned in the sidebar", async () => {
  // Six tasks Dean created for Charles, one more than the page draws, and one Charles made for himself.
  const handed = [5, 6, 7, 8, 9, 10].map((n) =>
    task(n, `Handed over ${n}`, DEAN, n * MINUTE, [], CHARLES),
  );
  const own = task(11, "Charles's own retries", CHARLES, 60 * MINUTE, [], CHARLES);
  const listed = [...TASKS, ...handed, own];
  const { page } = mountWith(
    { tasks: listed, listed: { tasks: listed, ...HOLDING } },
    CHARLES.userId,
  );
  await settle();

  const drawn = sections(page);
  assert.deepEqual(Object.keys(drawn).slice(2, 4), ["Assigned", "Created"]);
  assert.deepEqual(
    drawn.Assigned,
    [5, 6, 7, 8, 9].map((n) => `Handed over ${n}`),
  );
  assert.deepEqual(drawn.Created, ["Relay retries on 502", "Retry budget dashboard"]);
  // Each section wears no face, the page's head saying whose they are.
  assert.equal(page.querySelector('section[aria-label="Assigned"] .actor-mark'), null);

  button(page, "Show 2 more").click();
  assert.equal(keptViews()[ACME.id]?.assignedTo, CHARLES.userId);
});

test("a person's task leads with its glyph as its sidebar row does, keeps its repository as context, and hangs its card where its time raises no pill", async () => {
  const started = { ...DASHBOARD, status: TASK_STATUS.IN_PROGRESS };
  const listed = [RETRIES, CACHE, started, SHIM];
  const { page } = mountWith(
    { tasks: listed, listed: { tasks: listed, ...HOLDING } },
    CHARLES.userId,
  );
  await settle();
  const row = (name: string) =>
    [...page.querySelectorAll('section[aria-label="Created"] li')].find((each) =>
      each.querySelector(".luke-list-row-title")?.textContent?.includes(name),
    ) ?? assert.fail(`${name} is listed`);
  const lead = (name: string) => row(name).querySelector(".luke-list-row-leading > svg");

  assert.equal(lead(started.name)?.getAttribute("data-status"), TASK_STATUS.IN_PROGRESS);
  assert.equal(lead(RETRIES.name)?.getAttribute("class"), "icon-button-glyph");
  assert.equal(row(RETRIES.name).querySelector(".home-row-context")?.textContent, "acme/relay");

  restOn(row(RETRIES.name).querySelector("time") ?? assert.fail("the row says its time"));
  const card = document.querySelector(".luke-tooltip-card [data-task-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, RETRIES.name);
  assert.equal(document.querySelector(".luke-tooltip:not(.luke-tooltip-card)"), null);
});

test("a workspace of one offers no sidebar filter, since its sidebar filters by nobody", async () => {
  const { page } = mount(DEAN.userId, undefined, 1);
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /tasks in the sidebar/u);
});

test("the reader's own page offers nothing to edit: its header lists their tasks in the sidebar and ⋯ alone", async () => {
  const { page } = mount(DEAN.userId);
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".luke-page-header-actions button")].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    ["Show my tasks in the sidebar", "Person actions"],
  );
  // Note that a filter act is quiet: only a page's one primary act is filled.
  assert.equal(
    page.querySelector(".luke-page-header-actions button")?.getAttribute("data-variant"),
    "quiet",
  );
});

test("Person actions offers their page's link and a member's email to copy and, to an owner, the workspace's members in Settings", async () => {
  const { page, opened } = mount(CHARLES.userId);
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Person actions"]')?.click());
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

test("someone who left offers only their page's link in Person actions: no email to copy, and no row in Settings to manage", async () => {
  const { page } = mount(PRIYA.userId);
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Person actions"]')?.click());
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

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Person actions"]')?.click());
  act(() => button(document.body, "Copy link").click());
  await settle();

  assert.deepEqual(copied, ["https://tryluke.dev/acme/person/user-charles"]);
});

test("a page whose workspace is not known offers no Copy link, rather than a link naming no workspace", async () => {
  const { page } = mountWith({ workspace: undefined, workspaces: [] }, CHARLES.userId);
  await settle();

  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Person actions"]')?.click());
  assert.doesNotMatch(document.body.textContent ?? "", /Copy link/u);
});

test("a page for someone neither the members nor those who left name, as a link from outside the workspace opens, says it is not found", async () => {
  const { page } = mount("user-stranger");
  await settle();

  assert.match(page.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('button[aria-label="Person actions"]'), null);
});

test("someone who left heads their page with their own picture", async () => {
  const { page } = mount(PRIYA.userId);
  await settle();

  const face = page.querySelector<HTMLElement>(".luke-page-header .actor-mark");
  assert.equal(face?.querySelector("img")?.getAttribute("src"), PRIYA_PICTURE);
});

test("a person's page lists the workspace's automations they made, never their own personal ones", async () => {
  handState({});
  const { page } = mount(CHARLES.userId);
  await settle();

  assert.deepEqual(sections(page).Automations, ["Morning Sentry triage"]);
});

test("an automation's row leads with its clock tile, ends with its failure and when it runs next, and hangs its card", async () => {
  handState({});
  const { page } = mount(CHARLES.userId);
  await settle();

  const row = page.querySelector<HTMLElement>('section[aria-label="Automations"] li');
  assert.ok(row?.querySelector(".failed-mark"), "a failed newest run is marked at the end");
  assert.match(row?.textContent ?? "", /Next /u);
  restOn(row?.querySelector("button") ?? assert.fail("no press"));
  const card = document.querySelector('.luke-tooltip-card [data-actor-card="automation"]');
  assert.match(card?.textContent ?? "", /Morning Sentry triage/u);
});

test("automations that could not be read say so and offer Retry, never passing for an empty page, and Retry reads them again", async () => {
  handState({});
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
  handState({});
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
  handState({});
  inboxHeld = true;
  automationsHeld = true;
  const { page } = mount("user-sam");
  await settle();

  assert.deepEqual(waits(page), ["Reading your inbox…", "Reading their automations…"]);
  assert.equal(page.querySelector(".luke-spinner"), null);
  assert.doesNotMatch(page.textContent ?? "", /Nothing of theirs here yet/u);
});

test("while the Inbox is read, its placeholder stands where the section waiting on them lands, right after Working now", async () => {
  handState({});
  inboxHeld = true;
  const { page } = mount(CHARLES.userId);
  await settle();

  const order = [...page.querySelectorAll("section.home-section")].map(
    (section) =>
      section.getAttribute("aria-label") ??
      section.querySelector('[role="status"]')?.textContent ??
      "",
  );
  assert.deepEqual(order.slice(0, 3), ["Working now", "Reading your inbox…", "Created"]);
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

test("a members read that was refused says so and offers Retry in the head's place, and Retry names them", async () => {
  membersRefused = true;
  const { page } = mount("user-sam");
  await settle();

  assert.match(page.textContent ?? "", /Their profile could not be read\./u);
  assert.deepEqual(waits(page), []);
  assert.deepEqual(titles(page), ["Profile"]);
  assert.doesNotMatch(page.textContent ?? "", /Someone|Not in this workspace|Nothing of theirs/u);

  membersRefused = false;
  act(() => button(page, "Retry").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
  assert.deepEqual(head(page), ["Sam Ortiz", "Member · sam@example.com"]);
  assert.deepEqual(titles(page), ["Sam Ortiz"]);
});

test("a read of who left that was refused says so and offers Retry, and Retry names them as a former member", async () => {
  formerRefused = true;
  const { page } = mount(OLA.userId);
  await settle();

  assert.match(page.textContent ?? "", /Their profile could not be read\./u);
  assert.deepEqual(waits(page), []);
  assert.doesNotMatch(page.textContent ?? "", /Not found/u);

  formerRefused = false;
  act(() => button(page, "Retry").click());
  await settle();

  assert.deepEqual(head(page), [OLA.name, "Former member"]);
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

test("on a phone the page is headed by its way back's glyph, their name centred, and one ⋯ holding the sidebar's filter beside the page's own actions", async () => {
  const left: string[] = [];
  const { page } = mountWith({}, CHARLES.userId, undefined, MEMBERS.length, {
    label: "Chat",
    onPress: () => left.push("away"),
  });
  await settle();
  const head = page.querySelector<HTMLElement>(".person-page-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Chat", "Person actions"],
    "one control a corner",
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Person actions"]')?.click());
  assert.ok(
    [...document.querySelectorAll('[role="menuitem"]')].some(
      (each) => each.textContent === "Show their tasks in the sidebar",
    ),
    "the filter is in the ⋯",
  );
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(left, ["away"]);
});

test("on a phone a page for someone nobody names still leads with its way back", async () => {
  const left: string[] = [];
  const { page } = mountWith({}, "user-stranger", undefined, MEMBERS.length, {
    label: "Chat",
    onPress: () => left.push("away"),
  });
  await settle();
  assert.match(page.textContent ?? "", /Not found/u);
  const back = [...page.querySelectorAll<HTMLButtonElement>(".person-page-head button")].find(
    (each) => each.textContent?.trim() === "Chat",
  );
  assert.ok(back, "the way back stands");
  act(() => back.click());
  assert.deepEqual(left, ["away"]);
});

test("a task's row offers the sidebar's acts from its ⋯, and Rename makes its name the field", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  const items = openRowMenu(page, "Retry budget dashboard", "Task");
  for (const act of ["Copy link", "Rename", "Permanently delete"]) {
    assert.ok(
      items.some((item) => item.startsWith(act)),
      `${act} is offered`,
    );
  }
  act(() => button(document.body, "Rename").click());
  await settle();

  const field = page.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
  assert.equal(field?.value, DASHBOARD.name);
});

test("an agent's row offers Copy link and Archive, and Copy link copies its link under the page's workspace", async () => {
  const { page } = mountLinked(CHARLES.userId);
  await settle();

  const items = openRowMenu(page, "Tenant cache keys", "Agent");
  assert.ok(
    items.includes("Copy link") && items.includes("Archive"),
    "Copy link and Archive stand",
  );
  act(() => button(document.body, "Copy link").click());
  await settle();

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${CACHE.id}/agent/${CACHE_KEYS.id}`]);
});

test("an automation's row offers Copy link, copying its link under the page's workspace", async () => {
  const { page } = mountLinked(CHARLES.userId);
  await settle();

  assert.ok(openRowMenu(page, "Morning Sentry triage", "Automation").includes("Copy link"));
  act(() => button(document.body, "Copy link").click());
  await settle();

  assert.deepEqual(copied, [`https://tryluke.dev/acme/automation/${AUTOMATIONS[0]?.id}`]);
});

test("a waiting item's row offers Copy link, written under the page's workspace", async () => {
  const { page } = mountLinked(CHARLES.userId);
  await settle();

  assert.ok(openRowMenu(page, "Retry 429s too?", "Inbox item").includes("Copy link"));
});

test("a task no longer theirs slides out of its section, drawn on out of reach until its exit has played", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const { page, redraw } = mount(CHARLES.userId);
  await settle();

  const left = TASKS.filter((each) => each.id !== DASHBOARD.id);
  redraw({ tasks: left, listed: { tasks: left, ...HOLDING } });
  const leaving = page.querySelector(`[data-motion-key="${DASHBOARD.id}"]`);
  assert.equal(leaving?.hasAttribute("data-leaving"), true, "drawn on while it goes");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach");
  assert.ok(
    motions.played.some((motion) => motion.element === leaving),
    "its exit plays",
  );

  act(() => {
    for (const each of motions.played.splice(0)) each.finish();
  });
  assert.deepEqual(sections(page).Created, ["Relay retries on 502"]);
});

test("a teammate's agent at rest is archived from its row at once, read again by its own id though no task is open", async () => {
  const archived: string[] = [];
  const { page } = mountWith(
    {
      agents: {
        ...tasksControl().agents,
        me: DEAN.userId,
        onArchive: (agentId) => {
          archived.push(agentId);
          return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
        },
      },
    },
    CHARLES.userId,
  );
  await settle();

  openRowMenu(page, "Tenant cache keys", "Agent");
  act(() => button(document.body, "Archive").click());
  await settle();

  assert.deepEqual(archived, [CACHE_KEYS.id]);
  assert.equal(
    document.querySelector('[role="alertdialog"], [role="dialog"]'),
    null,
    "nothing asked",
  );
});

test("a task marked unread from its row stands unread, and its menu then offers Mark as read", async () => {
  const { page } = mount(CHARLES.userId);
  await settle();

  openRowMenu(page, "Retry budget dashboard", "Task");
  act(() => button(document.body, "Mark as unread").click());
  await settle();

  assert.ok(openRowMenu(page, "Retry budget dashboard", "Task").includes("Mark as read"));
});
