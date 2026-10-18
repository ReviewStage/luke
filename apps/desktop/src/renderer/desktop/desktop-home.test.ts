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
import type { ModelChoice } from "@luke/features/models-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { handState } from "#testing/app-state";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl, waitingOf } from "#testing/tasks-control";
import type { InboxChoice, NewTaskAgent, TasksControl } from "../tasks/use-tasks-tab";
import { commandKeyshortcuts } from "../tooltip";
import { DesktopHome } from "./desktop-home";
import { ListedAutomations } from "./listed-automations";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const DAY = 86_400_000;
const NOW = Date.now();

/** A task of the personal workspace, saved `ago` before now. */
function task(n: number, name: string, ago: number, repository: string | null): TaskSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - DAY,
    updatedAt: NOW - ago,
    repository,
  };
}

const INVITES = task(1, "Teammate invitations", 4 * 60_000, "acme/relay");
const BILLING = task(2, "Billing export", 2 * 3_600_000, "acme/ledger");
const TASKS: readonly TaskSummary[] = [
  task(3, "Usage alerts", 5 * DAY, "acme/relay"),
  INVITES,
  task(4, "Onboarding checklist", 12 * DAY, null),
  BILLING,
  task(5, "Search across plans", 19 * DAY, "acme/relay"),
  task(6, "Schema output", 3 * DAY, "acme/schema"),
  task(7, "Nightly bump", 6 * 3_600_000, "acme/relay"),
  task(8, "Old dashboard", 40 * DAY, "acme/relay"),
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

/** Each task's inbox as the service answers a read of it. */
const INBOXES = new Map<string, readonly InboxItem[]>([
  [INVITES.id, [EMAIL, SETTLED]],
  [BILLING.id, [ACCOUNT]],
]);

/** An agent with no task an automation started, and the question it waits on. */
const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const QUARANTINE: InboxItem = {
  ...item(9, "Quarantine the flaky test?", NOW - 60_000),
  agentId: SWEEP_AGENT,
};

/** The automation that started the agent with no task, as its workspace's list reads it. */
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

/** Each agent with no task's inbox as the service answers a read of it. */
const AGENT_INBOXES = new Map<string, readonly InboxItem[]>([[SWEEP_AGENT, [QUARANTINE]]]);

/** The tasks holding items, and those of them with an item waiting, as main reads the account. */
const HOLDING: Pick<TasksControl, "inbox" | "inboxTasks"> = {
  inbox: [
    { taskId: INVITES.id, items: [waitingOf(EMAIL)] },
    { taskId: BILLING.id, items: [waitingOf(ACCOUNT)] },
  ],
  inboxTasks: [
    { taskId: INVITES.id, items: 2, updatedAt: EMAIL.updatedAt },
    { taskId: BILLING.id, items: 1, updatedAt: ACCOUNT.updatedAt },
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

/** The workspace Home lists, which its composer starts a task in. */
const LISTED_WORKSPACE = "workspace-personal";

/** The account's default model, which the composer's chip starts on. */
const DEFAULT_CHOICE: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };

let root: Root | undefined;
/** Every workspace whose automations were read, in order. */
let automationReads: string[] = [];

// Landed before any page renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  automationReads = [];
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({
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
        items: INBOXES.get(request.payload.taskId) ?? [],
        cursor: "1",
      };
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  window.localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** A task the composer started: its name, repository, workspace, whether it plans, and the agent it asked for. */
interface Started {
  readonly name: string;
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly planning: boolean;
  readonly agent: NewTaskAgent | undefined;
}

/** Every door the page opens, in order. */
interface Opened {
  readonly tasks: string[];
  readonly inbox: (InboxChoice | "inbox")[];
  newTasks: number;
  readonly started: Started[];
}

/** The tab's New task control as Home's composer meets it, each start written to `started`. */
function newTaskControl(started: Started[]): TasksControl["newTask"] {
  const control = tasksControl().newTask;
  return {
    ...control,
    workspaceId: LISTED_WORKSPACE,
    repositoriesIn: () => ({ ...tasksControl().repositories, recent: ["acme/relay"] }),
    readDefault: () => Promise.resolve({ choice: DEFAULT_CHOICE }),
    start: (name, repository, workspaceId, planning, _from, agent) => {
      started.push({ name, repository, workspaceId, planning, agent });
      return Promise.resolve(undefined);
    },
  };
}

/** The home page over `overrides`, every door it opens recorded. */
function mount(overrides: Partial<TasksControl> = {}, accountName = "Dean Stratakos") {
  const opened: Opened = { tasks: [], inbox: [], newTasks: 0, started: [] };
  const tasks = tasksControl({
    tasks: TASKS,
    listed: { tasks: TASKS, archived: [], ...HOLDING },
    ...HOLDING,
    onSelect: (taskId) => opened.tasks.push(taskId),
    onNewTask: () => {
      opened.newTasks += 1;
    },
    newTask: newTaskControl(opened.started),
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
      onRegistry(AtomRegistry.make(), createElement(DesktopHome, { tasks, accountName })),
    ),
  );
  return { page: container, opened, tasks };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** A row's name: its `ListRow`'s title. */
const NAME = ".luke-list-row-title";

/** A section's rows as a reader scans them: each row's name, then its context. */
function rows(page: HTMLElement, section: string): string[] {
  const region = page.querySelector(`section[aria-labelledby="${section}"]`);
  assert.ok(region, `${section} stands`);
  return [...region.querySelectorAll("li")].map(
    (row) =>
      `${row.querySelector(NAME)?.textContent} · ${row.querySelector(".home-row-context")?.textContent}`,
  );
}

function button(page: HTMLElement, text: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith(text),
  );
  assert.ok(found, `${text} stands`);
  return found;
}

/** What each region still being read says to a reader, in the order they stand. */
function waits(page: HTMLElement): string[] {
  return [...page.querySelectorAll('[role="status"][aria-busy="true"]')].map(
    (region) => region.textContent ?? "",
  );
}

test("while the task list is unread, Home stands in its own shape: New task's composer, and placeholder rows under the Inbox and Recent, saying no greeting", () => {
  const { page } = mount({ listRead: false });

  assert.ok(composerEditor(page), "the composer stands, hanging on no list");
  assert.deepEqual(waits(page), ["Reading your inbox…", "Reading your tasks…"]);
  assert.ok(page.querySelectorAll(".luke-list-row .luke-skeleton").length > 0, "rows of blocks");
  assert.doesNotMatch(page.textContent ?? "", /Welcome back|Nothing needs you/u);
  assert.equal(page.querySelector("h1"), null);
});

test("an account whose task list is unread is neither welcomed as new nor greeted back until the list says which it is", () => {
  const { page } = mount({
    listRead: false,
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
  });

  assert.equal(page.querySelector("[aria-label='Welcome']"), null, "no welcome stands");
  assert.doesNotMatch(page.textContent ?? "", /Start your first task|Welcome back/u);
  assert.deepEqual(waits(page), ["Reading your inbox…", "Reading your tasks…"]);
});

test("once the task list lands, the page replaces its placeholder rows with the greeting, what waits, and the plans saved latest", async () => {
  const { page } = mount({ listRead: false });
  assert.equal(waits(page).length, 2, "the page stands in its own shape first");

  const tasks = tasksControl({ tasks: TASKS, listed: { tasks: TASKS, archived: [], ...HOLDING } });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopHome, { tasks, accountName: "Dean Stratakos" }),
      ),
    ),
  );
  await settle();

  assert.deepEqual(waits(page), []);
  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.equal(rows(page, "home-inbox").length, 2);
  assert.equal(rows(page, "home-recent").length, 6);
});

test("while what waits is read, Home's Inbox stands a few placeholder rows under its name, and no ring", () => {
  const { page } = mount();

  const section = page.querySelector<HTMLElement>('section[aria-labelledby="home-inbox"]');
  assert.ok(section, "Home's Inbox stands");
  assert.equal(section.querySelector("#home-inbox")?.textContent, "Inbox");
  assert.deepEqual(waits(section), ["Reading your inbox…"]);
  assert.equal(section.querySelectorAll("li").length, 3, "fewer rows than a whole Inbox's five");
  assert.equal(
    section.querySelector(".luke-spinner"),
    null,
    "no ring stands at the section's edge",
  );
});

test("the home page greets the account, lists what needs it with each item's plan, and the plans saved latest with their repositories", async () => {
  const { page } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(composerEditor(page), "New task's composer stands under the greeting");
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

test("a waiting item's row opens the Inbox on its item, and a recent plan opens the plan", async () => {
  const { page, opened } = mount();
  await settle();

  button(page, "Email the invitee").click();
  button(page, "Usage alerts").click();

  assert.deepEqual(opened.inbox, ["inbox", { taskId: INVITES.id, itemId: EMAIL.id }]);
  assert.deepEqual(opened.tasks, [TASKS[0]?.id]);
});

test("a waiting item's row on Home reads as the Inbox's own: what it asks under its title, its plan and the attention mark before its time, and no unread dot on an item read", async () => {
  const { page } = mount();
  await settle();

  const region = page.querySelector('section[aria-labelledby="home-inbox"]');
  assert.ok(region, "Home's Inbox stands");
  const row = [...region.querySelectorAll("li")].find(
    (each) => each.querySelector(NAME)?.textContent === EMAIL.title,
  );
  assert.ok(row, "the waiting item has a row");
  assert.equal(row.querySelector(".luke-list-row-description")?.textContent, "Choice · 2 options");
  const head = row.querySelector(".luke-list-row-head");
  assert.equal(head?.querySelector(".home-row-context")?.textContent, "Teammate invitations");
  assert.ok(head?.querySelector(".attention-mark"), "it needs the reader");
  assert.equal(row.querySelector(".inbox-row-unread"), null, "a read item wears no unread dot");
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
  const { page } = mount({ listed: { tasks: TASKS, archived: [], inbox: [], inboxTasks: [] } });
  await settle();

  const section = page.querySelector('section[aria-labelledby="home-inbox"]');
  const note = section?.querySelector("p");
  assert.equal(note?.textContent, "Nothing needs you");
  assert.equal(section?.querySelector("svg"), null);
});

test("a refused read of the task list says so under Recent, with Retry, which asks for the list again", async () => {
  let retries = 0;
  const { page } = mount({
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    listFailed: true,
    onRetryList: () => {
      retries += 1;
    },
  });
  await settle();

  const recent = page.querySelector('section[aria-labelledby="home-recent"]');
  const said = recent?.querySelector('[role="alert"]')?.textContent;
  act(() => button(page, "Retry").click());

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.doesNotMatch(page.textContent ?? "", /Nothing needs you/u, "the Inbox claims nothing");
  assert.match(said ?? "", /^Your tasks could not be read\./u);
  assert.equal(retries, 1);
});

test("an account with no plan yet is welcomed with New task's composer under Luke's line, and nothing the page says names the sidebar", async () => {
  const { page, opened } = mount({
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
  });

  await settle();
  typeInComposer(page, "Set up the repository");
  pressInComposer(page, "Enter");
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
  assert.ok(page.querySelector("[aria-label='Welcome']"), "the welcome stands");
  assert.deepEqual(
    opened.started.map((each) => each.agent?.prompt),
    ["Set up the repository"],
    "its composer starts the first task",
  );
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
});

test("an account with no plan yet whose only waiting question is a teammate's agent's with no plan is still welcomed, the question waiting on the teammate", async () => {
  const { page } = mount({
    me: "user-dean",
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    inboxTaskless: [
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
        startedBy: CHARLES.userId,
      },
    ],
  });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
});

test("↑ and ↓ move the focus through the rows from the window, once Escape lets go of the composer, and leave a key pressed elsewhere alone", async () => {
  const { page } = mount();
  await settle();
  pressInComposer(page, "Escape");
  assert.ok(document.activeElement === document.body, "Escape lets go of the composer's words");
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
  const { page } = mount({ listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] } });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.equal(rows(page, "home-inbox").length, 0);
  assert.equal(page.querySelector('section[aria-labelledby="home-recent"]'), null);
});

test("Home's composer takes the caret as the page shows, and ↑, ↓, and Return typed in it are the composer's, moving none of Home's rows", async () => {
  const { page, opened } = mount();
  await settle();
  const editor = composerEditor(page);
  assert.ok(document.activeElement === editor, "the words take the caret");

  typeInComposer(page, "Fix the refresh");
  const down = pressInComposer(page, "ArrowDown");
  const up = pressInComposer(page, "ArrowUp");

  assert.ok(document.activeElement === editor, "the caret stays in the words");
  assert.equal(down.defaultPrevented || up.defaultPrevented, false, "Home takes neither arrow");
  pressInComposer(page, "Enter");
  await settle();
  assert.deepEqual(opened.tasks, [], "Return opened no row");
  assert.equal(opened.started.length, 1, "Return started the composer's task");
});

test("Home's composer leaves the caret in a field the developer is typing in as the page shows", async () => {
  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  const { page } = mount();
  await settle();

  assert.ok(composerEditor(page));
  assert.ok(document.activeElement === field, "the field keeps the caret");
});

test("Agent mode: Return in Home's composer starts the task in the workspace Home lists, without planning, and an agent on the words with the chip's model", async () => {
  const { page, opened } = mount();
  await settle();
  typeInComposer(page, "Make the sidebar keep its folds.");
  pressInComposer(page, "Enter");
  await settle();

  assert.deepEqual(opened.started, [
    {
      name: "",
      repository: "acme/relay",
      workspaceId: LISTED_WORKSPACE,
      planning: false,
      agent: {
        prompt: "Make the sidebar keep its folds.",
        attachments: [],
        choice: DEFAULT_CHOICE,
      },
    },
  ]);
  assert.equal(opened.newTasks, 0, "no dialog is asked for");
});

test("Plan mode: Shift+Tab in Home's composer turns it on, and Return starts the plan and its call in the workspace Home lists, with no agent", async () => {
  const { page, opened } = mount();
  await settle();
  pressInComposer(page, "Tab", { shiftKey: true });
  typeInComposer(page, "Rethink automations");
  pressInComposer(page, "Enter");
  await settle();

  assert.deepEqual(opened.started, [
    {
      name: "Rethink automations",
      repository: "acme/relay",
      workspaceId: LISTED_WORKSPACE,
      planning: true,
      agent: undefined,
    },
  ]);
});

test("words typed in the composer while the task list is read are still there once it lands", async () => {
  const { page, opened, tasks } = mount({ listRead: false });
  await settle();
  typeInComposer(page, "Speed up the build");

  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopHome, { tasks: { ...tasks, listRead: true }, accountName: "Dean" }),
      ),
    ),
  );
  await settle();
  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  pressInComposer(page, "Enter");
  await settle();

  assert.deepEqual(
    opened.started.map((each) => each.agent?.prompt),
    ["Speed up the build"],
  );
});

test("Home lists every open item of the listed plans, a teammate's agent's included, though main counts only the account's own as waiting on it", async () => {
  // Billing's question is a teammate's agent's: main's account read holds the task, but waits the account on Invitations' alone.
  const { page } = mount({
    listed: {
      tasks: TASKS,
      archived: [],
      inbox: [{ taskId: INVITES.id, items: [waitingOf(EMAIL)] }],
      inboxTasks: HOLDING.inboxTasks,
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
    inboxTaskless: [
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
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    inboxTaskless: [
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
  const tasks = TASKS.map((each) => (each.id === INVITES.id ? { ...each, agents } : each));
  const { page } = mount({
    me: "user-dean",
    workspace: {
      id: "workspace-personal",
      name: "Personal",
      role: WORKSPACE_ROLE.OWNER,
      github: null,
      memberCount: 2,
    },
    tasks,
    listed: { tasks, archived: [], ...HOLDING },
  });
  await settle();

  const row = button(page, "Email the invitee when an invite is withdrawn?");
  const mark = row.querySelector("[data-agent-ref]");
  assert.ok(mark, "the row's mark hangs its agent's card");
  assert.ok(mark.querySelector('.actor-mark[data-kind="agent"]'), "the mark is the agent's tile");
  act(() => {
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
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
  const tasks = tasksControl({
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    workspace,
    inboxTaskless: [
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
          tasks,
          on: true,
          children: createElement(DesktopHome, { tasks, accountName: "Dean Stratakos" }),
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
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.match(card?.textContent ?? "", /Sweep the flaky tests.*Started by.*Nightly flake sweep/u);
});

test("a question of another workspace's automation, which Home does not list, reads none of the listed workspace's automations", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const tasks = tasksControl({
    tasks: [],
    listed: { tasks: [], archived: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    workspace: {
      id: "workspace-personal",
      name: "Personal",
      role: WORKSPACE_ROLE.OWNER,
      github: null,
    },
    inboxTaskless: [
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
          tasks,
          on: true,
          children: createElement(DesktopHome, { tasks, accountName: "Dean Stratakos" }),
        }),
      ),
    ),
  );
  await settle();

  assert.deepEqual(automationReads, []);
});

test("a recent task a teammate created wears their face before its time, and the reader's own wears none", async () => {
  const tasks = TASKS.map((each) =>
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
    tasks,
    listed: { tasks, archived: [], ...HOLDING },
  });
  await settle();

  const region = page.querySelector('section[aria-labelledby="home-recent"]');
  const faces = [...(region?.querySelectorAll("li") ?? [])].flatMap((row) => {
    const face = row.querySelector<HTMLImageElement>(".actor-mark img");
    return face === null ? [] : [[row.querySelector(NAME)?.textContent, face.src]];
  });
  assert.deepEqual(faces, [[INVITES.name, CHARLES_PICTURE]]);
});
