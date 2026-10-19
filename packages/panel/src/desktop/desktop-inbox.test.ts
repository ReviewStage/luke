// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxMessageParams,
  type CodingAgentListAnswer,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import type { AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { DocumentIcon } from "@luke/ui";
import { TASK_MARK, type TaskMark } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand, useAppKeymap } from "../app-commands.js";
import { DRAFT_WORD } from "../draft-mark.js";
import { AUTOMATIONS_PAGE, type InboxChoice } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import {
  copyingInto,
  DESKTOP_LINKS,
  fakeAppPlatform,
  QUIET_PANEL,
} from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { readSegmented, segment, segmentedGroup } from "../testing/segmented.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { DesktopInbox } from "./desktop-inbox.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Where the window's Inbox keeps the tab it shows, and where its Needs you button kept its press before the tabs. */
const SHOW_KEY = "luke.inboxShow";
const EARLIER_SHOW_KEY = "luke.inboxWaitingOnly";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Alerts",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
};

const BILLING: TaskSummary = {
  id: TASK_ID,
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  // The sidebar's list names the task's agent, as the service sums a task's agents up.
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
const INVITES: TaskSummary = {
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
/** The account reading the Inbox, who answered the retry question themselves. */
const READER = { userId: "user-reader", name: "Dana Reyes" };

const RETRY: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000002", "How is a failed email retried?", 5_000),
  status: INBOX_STATUS.ANSWERED,
  settledAt: 5_000,
  answeredBy: READER,
  answer: {
    reply: INBOX_REPLY.CHOSE,
    choices: ["Retry 3 times over an hour"],
    note: "And page on-call if all three fail.",
  },
};
const EXPIRY = item("a1b2c3d4-0000-4000-8000-000000000003", "Expire after 7 days?", 4_000);

const HOLDING: readonly AppInboxTaskHolding[] = [
  { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
  { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
];

/** A page of the billing task's, as a read of its pages lists it. */
const FUNNEL = {
  id: "3c4d5e6f-0000-4000-8000-000000000001",
  title: "Invite funnel",
  version: 2,
  at: 1_000,
};

let root: Root | undefined;
/** Each task's pages as a read of them answers. */
let taskPages = new Map<string, readonly (typeof FUNNEL)[]>();
/** The task's agents as the service lists them, archived ones among them. */
let listedAgents: readonly CodingAgentSummary[] = [AGENT];
/** Each task's inbox as the service answers a read of it from the start. */
let inboxes = new Map<string, readonly InboxItem[]>();
/** Moves main's list of the tasks holding items, as its read of the account would. */
let setHolding: (holding: readonly AppInboxTaskHolding[]) => void = () => undefined;
/** Moves the account's list of tasks, as an archive on another Mac would. */
let setTasks: (tasks: readonly TaskSummary[]) => void = () => undefined;
/** Lands the account's first read of its task list, where a test mounted the Inbox before it. */
let setListRead: (read: boolean) => void = () => undefined;
/** Chooses an item from outside the list, as a notification's click does. */
let chooseFromOutside: (chosen: InboxChoice) => void = () => undefined;
/** Moves main's read of what waits on the agents with no task, as main does when an item opens or is answered. */
let setTaskless: (taskless: readonly AppInboxTasklessItem[]) => void = () => undefined;
/** Whether an agent's own inbox read answers that it could not be read. */
let agentReadFails = false;
/** Whether a read of a plan's agents is held open, never answering. */
let agentListHeld = false;
/** Holds the next agent read's answer, handing the test what lands it, where a test asks. */
let holdAgentRead: ((respond: () => void) => void) | undefined;
/** A read of a task's inbox as the act answers it: done, carrying the view the service answered. */
interface ReadOutcome {
  readonly status: typeof ACT_OUTCOME_STATUS.DONE;
  readonly value: CodingAgentInboxAnswerView;
}

/** How the next held read of a task, one past the cursor, answers: held open while nothing changes unless a test says. */
let heldRead: (taskId: string) => Promise<ReadOutcome> = () => new Promise(() => undefined);
/** How a read of a task from the start answers, where a test holds it in its own hands. */
let startRead: ((taskId: string) => Promise<ReadOutcome> | undefined) | undefined;
/** Each agent with no task's items, as its own inbox read answers them. */
let agentInboxes = new Map<string, readonly InboxItem[]>();
/** Every agent whose own inbox was read from the start, in order. */
let agentReads: string[] = [];
/** The workspace the Inbox lists, and its automations as a read of them answers. */
let listedWorkspace: Workspace | undefined;
let automations: readonly AutomationSummary[] = [];
/** What the window copied, in order. */
let copied: string[] = [];
/** Each agent with no plan as a read of its own page answers it. */
let pageAgents = new Map<string, CodingAgentSummary>();
/** The reads of an item's images, each held until the test lands it with a PNG's first bytes. */
let imageReads: (() => void)[] = [];
/** Every read mark the Inbox sent, in order: `read:<item>`, `unread:<item>`, or `all:<workspace>`. */
let readMarks: string[] = [];
/** Whether the service refuses a read mark, as one for an item it no longer holds. */
let readMarkRefused = false;
/** The listed workspace's members, as a read of them answers. */
let members: readonly WorkspaceMember[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  installEditorLayout();
  installScrollIntoView();
  window.localStorage.clear();
  // Note that the Inbox opens on Everything here, so the tests of what an item shows meet settled
  // items too; the tests of the tabs clear it to meet the Inbox as a fresh profile opens it.
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("all"));
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  heldRead = () => new Promise(() => undefined);
  startRead = undefined;
  taskPages = new Map([[BILLING.id, [FUNNEL]]]);
  listedAgents = [AGENT];
  agentInboxes = new Map();
  agentReads = [];
  agentReadFails = false;
  agentListHeld = false;
  holdAgentRead = undefined;
  listedWorkspace = undefined;
  automations = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), ...DESKTOP_LINKS, pageFrameUrl });
  pageAgents = new Map();
  imageReads = [];
  readMarks = [];
  readMarkRefused = false;
  members = [];
  fakeAppBridge({
    act: (request: Act) => {
      const done = (value: CodingAgentListAnswer | CodingAgentInboxAnswerView) =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
        return agentListHeld ? new Promise(() => undefined) : done({ agents: listedAgents });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        const agent = pageAgents.get(request.payload.agentId);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value:
            agent === undefined
              ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
              : {
                  agent: {
                    id: agent.id,
                    planId: null,
                    model: agent.model,
                    effort: agent.effort,
                    title: agent.title,
                    createdAt: agent.createdAt,
                    status: agent.status,
                    turnId: null,
                    automationId: null,
                    workspaceId: "workspace-acme",
                    repository: "acme/relay",
                  },
                },
        });
      }
      if (request.kind === ACT_KIND.TASKS_TREE) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: {
            folder: {
              path: "",
              repository: "acme/relay",
              branch: "main",
              entries: [{ name: "apps/web/rollout-store.ts", kind: TASK_TREE_ENTRY.FILE }],
              truncated: false,
            },
          },
        });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: members });
      }
      if (request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] });
      }
      if (request.kind === ACT_KIND.TASKS_PAGES) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { pages: taskPages.get(request.payload.taskId) ?? [] },
        });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { automations } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_STATE) {
        const { itemId, unread } = request.payload;
        readMarks.push(`${unread ? "unread" : "read"}:${itemId}`);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: readMarkRefused
            ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
            : { id: itemId, unread },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_ALL) {
        readMarks.push(`all:${request.payload.workspaceId ?? "every workspace"}`);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { marked: 2 } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) {
        return new Promise((resolve) =>
          imageReads.push(() =>
            resolve({
              status: ACT_OUTCOME_STATUS.DONE,
              value: { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
            }),
          ),
        );
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_AGENT_INBOX) {
        const { agentId, after } = request.payload;
        if (after !== INBOX_CURSOR_START) return new Promise(() => undefined);
        agentReads.push(agentId);
        if (agentReadFails) return done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
        const items = agentInboxes.get(agentId) ?? [];
        const hold = holdAgentRead;
        if (hold !== undefined) {
          return new Promise((resolve) =>
            hold(() => resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { items, cursor: "1" } })),
          );
        }
        return done({ items, cursor: "1" });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX) {
        const { taskId, after } = request.payload;
        // A read past the cursor is held open while nothing changes, as the service holds it.
        if (after !== INBOX_CURSOR_START) return heldRead(taskId);
        return startRead?.(taskId) ?? done({ items: inboxes.get(taskId) ?? [], cursor: "1" });
      }
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** What the Inbox was asked to open, leaving it. */
interface Asked {
  readonly shownTasks: string[];
  readonly shownAgents: [string, string][];
  /** The automations whose pages it was asked to open. */
  readonly shownAutomations: string[];
  /** How many times it was asked to close. */
  closed: number;
  /** Each task it was asked to mark, by the mark, in order. */
  readonly marks: [string, TaskMark][];
}

/** The Inbox over the two tasks, and the items of agents with no task given, its own view real, as the tasks tab holds it, and every press that leaves it recorded; or, `listUnread`, opened before the account's task list is first read; or over the tasks and archived tasks given. */
function mount(
  firstTaskless: readonly AppInboxTasklessItem[] = [],
  {
    listUnread = false,
    standing = [BILLING, INVITES],
    archived = [],
  }: {
    listUnread?: boolean;
    standing?: readonly TaskSummary[];
    archived?: readonly TaskSummary[];
  } = {},
) {
  const asked: Asked = {
    shownTasks: [],
    shownAgents: [],
    shownAutomations: [],
    closed: 0,
    marks: [],
  };
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    chooseFromOutside = setChosen;
    const [holding, setHeld] = useState(HOLDING);
    const [listed, setListed] = useState<readonly TaskSummary[]>(listUnread ? [] : standing);
    const [listRead, setRead] = useState(!listUnread);
    setListRead = setRead;
    setHolding = setHeld;
    const [taskless, setWaiting] = useState(firstTaskless);
    setTaskless = setWaiting;
    setTasks = setListed;
    return createElement(DesktopInbox, {
      tasks: tasksControl({
        me: READER.userId,
        workspace: listedWorkspace,
        tasks: listed,
        archived,
        listRead,
        inbox: [
          { taskId: BILLING.id, items: [waitingOf(THRESHOLD)] },
          { taskId: INVITES.id, items: [waitingOf(EXPIRY)] },
        ],
        inboxTasks: holding,
        inboxTaskless: taskless,
        inboxView: {
          open: true,
          chosen,
          onOpen: () => undefined,
          onClose: () => {
            asked.closed += 1;
          },
          onChoose: setChosen,
          pages: undefined,
          onRereadPages: () => undefined,
          onTaskAgents: () => undefined,
        },
        onShowTask: (taskId) => asked.shownTasks.push(taskId),
        onMarkTask: (taskId, mark) => asked.marks.push([taskId, mark]),
        onShowAgent: (taskId, agentId) => asked.shownAgents.push([taskId, agentId]),
        automationsView: {
          open: false,
          place: { kind: AUTOMATIONS_PAGE.LIST },
          onOpen: (place) => {
            if (place?.kind === AUTOMATIONS_PAGE.EDIT)
              asked.shownAutomations.push(place.automationId);
          },
          onClose: () => undefined,
        },
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

/** A row's title, as its ListRow draws it. */
const ROW_TITLE = ".luke-list-row-title";

/**
 * What marks a row as needing the developer: `*` where it wears the
 * attention mark and says "Needs you" beside it, nothing where it does
 * neither, and `?` where it does one alone, so a half-drawn mark fails
 * every listing.
 */
function needsYouMark(row: HTMLElement): string {
  const mark = row.querySelector(".luke-list-row-meta .attention-mark") !== null;
  const said = [...row.querySelectorAll(".luke-list-row-meta .visually-hidden")].some(
    (each) => each.textContent === "Needs you",
  );
  if (mark && said) return "*";
  return mark || said ? "?" : "";
}

/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");
  return heard?.textContent ?? "";
}

/** The list as a reader hears it: each group's name, then its rows, `▸ ` where chosen and `*` where marked as needing the developer. */
function listed(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  const fold = ".sidebar-repository-header button[aria-expanded]:not([aria-haspopup])";
  return [...list.querySelectorAll(`${fold}, li button.luke-list-row-main`)].map((node) => {
    if (node.matches(fold) || !(node instanceof HTMLButtonElement)) return `# ${heardName(node)}`;
    const name = node.querySelector(ROW_TITLE)?.textContent ?? "";
    return `${node.getAttribute("aria-current") === "page" ? "▸ " : ""}${needsYouMark(node)}${name}`;
  });
}

/** What an element says to a reader, the discs beside the names in it left out; nothing for no element. */
function wordsOf(element: Element | null | undefined): string | null {
  if (element === null || element === undefined) return null;
  const copy = element.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const disc of copy.querySelectorAll(".actor-mark")) disc.remove();
  return copy.textContent;
}

function rowNamed(page: HTMLElement, title: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main"),
  ].find((each) => each.querySelector(ROW_TITLE)?.textContent === title);
  assert.ok(row, `no row for ${title}`);
  return row;
}

/** The tab under the Inbox's title whose name starts with `name`. */
function showTab(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>('.inbox-tasks [role="tab"]')].find(
    (each) => each.querySelector(".luke-choice-bar-label")?.textContent === name,
  );
  assert.ok(found, `the list offers the ${name} tab`);
  return found;
}

/** The tabs under the Inbox's title as a reader sees them: each name and count, the one shown in brackets. */
function showTabs(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLButtonElement>('.inbox-tasks [role="tab"]')].map((each) => {
    const words = `${each.querySelector(".luke-choice-bar-label")?.textContent} ${each.querySelector(".luke-choice-bar-count")?.textContent}`;
    return each.getAttribute("aria-selected") === "true" ? `[${words}]` : words;
  });
}

/** Chooses `choice` under `submenu` in the list's View options. */
function chooseView(page: HTMLElement, submenu: string, choice: string): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
  act(() => viewItem(submenu).click());
  act(() => viewItem(choice).click());
}

/** The item of the menus open now whose words end in `label`, a choice or a submenu, after any face's initial. */
function viewItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].findLast((each) =>
    each.textContent?.endsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

test("the list holds every plan's items under the sidebar's group header for each, the latest changed first and wearing the attention mark while it needs you, the first such item chosen; Group by None from the view's menu lists them in one run, and the choice outlives a relaunch", async () => {
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
  act(() => viewItem("Group by").click());
  assert.deepEqual(
    ["Task", "Person", "None"].map((each) => viewItem(each).getAttribute("aria-checked")),
    ["true", "false", "false"],
  );
  act(() => viewItem("None").click());
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

/** Presses Media previews in the view's menu, handing back whether it stood checked before. */
function toggleMediaPreviews(page: HTMLElement): string | null {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent?.includes("Media previews"),
  );
  assert.ok(item, "the view's menu offers Media previews");
  const checked = item.getAttribute("aria-checked");
  act(() => item.click());
  return checked;
}

test("rows show no media until Media previews is checked in the view's menu, then the pictures and pages each item carries under its preview, and the choice outlives a relaunch", async () => {
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c70",
    alt: "The chart",
  };
  const funnel = linkOf({ kind: LINK_PLACE.PAGE, planId: BILLING.id, pageId: FUNNEL.id }, "acme");
  const words = { type: INBOX_BLOCK.MARKDOWN, text: `Compare [@Invite funnel](${funnel}).` };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, blocks: [words, shot] }, RETRY]);
  const mediaOf = (page: HTMLElement, title: string) => {
    const strip = rowNamed(page, title).querySelector(".luke-list-row-attachments");
    if (strip === null) return null;
    return [...strip.children].map(
      (tile) =>
        tile.querySelector("img")?.getAttribute("src") ??
        tile.querySelector("iframe")?.getAttribute("src") ??
        "",
    );
  };
  const landImages = async () => {
    await settle();
    for (const land of imageReads.splice(0)) land();
    await settle();
  };
  let { page } = mount();
  await landImages();
  assert.equal(mediaOf(page, "Alert at 80%?"), null, "no media stand until asked for");

  assert.equal(toggleMediaPreviews(page), "false");
  await landImages();
  assert.deepEqual(mediaOf(page, "Alert at 80%?"), [
    pageFrameUrl({ taskId: BILLING.id, pageId: FUNNEL.id, version: FUNNEL.version }),
    "data:image/png;base64,iVBORw0KGgo=",
  ]);
  assert.equal(mediaOf(page, "Expire after 7 days?"), null, "an item carrying none shows none");
  assert.equal(
    rowNamed(page, "Alert at 80%?").querySelector(".luke-list-row-description")?.textContent,
    "Choice · 2 options, one recommended",
    "the preview's words stand over the media",
  );

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await landImages();
  assert.equal(mediaOf(page, "Alert at 80%?")?.length, 2);
  assert.equal(toggleMediaPreviews(page), "true");
  assert.equal(mediaOf(page, "Alert at 80%?"), null);
});

test("a row's page is drawn at its newest version, read again once its item changes, as when its agent shows the page anew, holding its place until each version loads", async () => {
  const funnel = linkOf({ kind: LINK_PLACE.PAGE, planId: INVITES.id, pageId: FUNNEL.id }, "acme");
  const words = { type: INBOX_BLOCK.MARKDOWN, text: `See [the funnel](${funnel}).` };
  inboxes.set(INVITES.id, [{ ...EXPIRY, blocks: [words] }]);
  taskPages.set(INVITES.id, [FUNNEL]);
  const frame = (page: HTMLElement) =>
    rowNamed(page, "Expire after 7 days?").querySelector("iframe")?.getAttribute("src");
  const { page } = mount();
  await settle();
  toggleMediaPreviews(page);
  await settle();
  assert.equal(
    frame(page),
    pageFrameUrl({ taskId: INVITES.id, pageId: FUNNEL.id, version: FUNNEL.version }),
  );
  const tile = () =>
    rowNamed(page, "Expire after 7 days?").querySelector("iframe")?.parentElement?.dataset.loaded;
  const loads = () =>
    act(() => {
      rowNamed(page, "Expire after 7 days?")
        .querySelector("iframe")
        ?.dispatchEvent(new Event("load", { bubbles: false }));
    });
  loads();
  assert.equal(tile(), "true");

  taskPages.set(INVITES.id, [{ ...FUNNEL, version: 3 }]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, blocks: [words], updatedAt: 6_000 }]);
  act(() =>
    setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.equal(frame(page), pageFrameUrl({ taskId: INVITES.id, pageId: FUNNEL.id, version: 3 }));
  assert.equal(tile(), "false", "the new version holds its place until it loads");
  loads();
  assert.equal(tile(), "true");
});

test("a row's picture is let go once its item is reposted carrying no media, so the picture shown again is read anew and holds its place until it lands", async () => {
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c73",
    alt: "The chart",
  };
  const picture = (page: HTMLElement) =>
    rowNamed(page, "Expire after 7 days?")
      .querySelector(".luke-list-row-attachments img")
      ?.getAttribute("src");
  const repost = async (blocks: InboxItem["blocks"], revision: number, updatedAt: number) => {
    inboxes.set(INVITES.id, [{ ...EXPIRY, blocks, revision, updatedAt }]);
    act(() =>
      setHolding([
        { taskId: INVITES.id, items: 1, updatedAt },
        { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
      ]),
    );
    await settle();
  };
  const land = async () => {
    for (const each of imageReads.splice(0)) each();
    await settle();
  };
  inboxes.set(INVITES.id, [{ ...EXPIRY, blocks: [shot] }]);
  const { page } = mount();
  await settle();
  toggleMediaPreviews(page);
  await settle();
  await land();
  assert.equal(picture(page), "data:image/png;base64,iVBORw0KGgo=");

  await repost([], 2, 6_000);
  assert.equal(picture(page), undefined, "the reposted item carries no media");
  await repost([shot], 3, 7_000);
  assert.equal(
    picture(page),
    undefined,
    "the picture let go holds its place until it is read anew",
  );
  await land();
  assert.equal(picture(page), "data:image/png;base64,iVBORw0KGgo=");
});

/** The line heading the developer's answer in the shown item's thread, as a reader hears it: who answered, when, and where it went. */
function answerHead(page: HTMLElement): string | null {
  return wordsOf(
    page.querySelector(
      '.inbox-view-items:not([hidden]) [data-inbox-comment="answered"] .inbox-comment-head',
    ),
  );
}

/** The picks the shown item's answer carries, as its comment draws them. */
function answeredPicks(page: HTMLElement): (string | null)[] {
  return [
    ...page.querySelectorAll(
      '.inbox-view-items:not([hidden]) [data-inbox-comment="answered"] [data-inbox-pick]',
    ),
  ].map((pick) => pick.textContent);
}

/** Opens the fold holding what a settled item offered, by pressing its line. */
function openOffered(within: ParentNode): void {
  const line =
    within.querySelector<HTMLElement>("[data-inbox-offered] > summary") ??
    assert.fail("what was offered is folded");
  act(() => line.click());
}

test("a settled choice folds what its agent offered to one line saying who picked which, which still holds every option with the pick marked, then the developer's answer as their comment: their pick as a chip over their note, under a line saying when and that it reached the agent", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  const offered =
    pane.querySelector<HTMLDetailsElement>("details[data-inbox-offered]") ??
    assert.fail("what was offered is folded");
  assert.equal(offered.open, false, "the fold stands closed");
  assert.equal(
    offered.querySelector("summary")?.textContent,
    "2 options · you picked Retry 3 times over an hour",
  );
  act(() => offered.querySelector("summary")?.click());
  assert.deepEqual(
    [...offered.querySelectorAll<HTMLElement>("li")].map((option) => wordsOf(option)),
    [
      "Retry 3 times over an hourYour pickRecommendedBacks off 5, 15, then 40 minutes.",
      "Retry once",
    ],
  );
  assert.equal(
    pane.querySelector(".composer-editor")?.getAttribute("aria-label"),
    "Message Alerts…",
    "a settled item takes no answer, only a message on its thread",
  );
  const reply = pane.querySelector<HTMLElement>('[data-inbox-comment="answered"]');
  assert.ok(reply, "the developer's answer is their own comment");
  assert.equal(reply.querySelector("[data-inbox-pick]")?.textContent, "Retry 3 times over an hour");
  assert.equal(reply.querySelector("p")?.textContent, "And page on-call if all three fail.");
  assert.match(answerHead(page) ?? "", /^You.+ · Sent to Alerts$/u);
  assert.equal(
    reply.querySelector<HTMLElement>(".inbox-comment-face .actor-mark")?.dataset.kind,
    "person",
    "the answerer's face leads their comment",
  );
  assert.ok(
    reply.querySelector("[data-actor-ref][data-kind='person']"),
    "the answerer by their name",
  );
});

/** An item's options as a reader meets them: each row's words, its label, its Recommended badge where it wears one, and its detail; `settled` reads what a settled item offered rather than what a waiting one asks. */
function optionHeads(page: HTMLElement, settled = false): (string | null)[] {
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  const rows = settled
    ? '[aria-label="What the agent offered"] li'
    : '[role="radio"], [role="checkbox"]';
  return [...pane.querySelectorAll<HTMLElement>(rows)].map((each) => wordsOf(each));
}

/** The shown item's subject as a reader meets it: its title, and where its line says it stands, with whether it wears the attention mark. */
function subjectOf(page: HTMLElement): (string | boolean | null | undefined)[] {
  const subject =
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-subject") ??
    assert.fail("the thread leads with its subject");
  const standing = subject.querySelector(".inbox-standing");
  return [
    subject.querySelector("h2[data-inbox-title]")?.textContent,
    wordsOf(standing),
    standing?.querySelector(".attention-mark") !== null,
  ];
}

test("a thread leads with its item's title as its subject, and a line saying where it stands: a waiting item needs you by the attention mark, an answered one is answered, and one its agent took back is withdrawn, its agent's comment saying why", async () => {
  const WITHDRAWN: InboxItem = {
    ...EXPIRY,
    status: INBOX_STATUS.CLOSED,
    closedReason: "The plan now says 7 days.",
  };
  inboxes.set(INVITES.id, [WITHDRAWN]);
  const { page } = mount();
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?", "Needs you", true]);
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?", "Answered", false]);
  const fold = () =>
    page.querySelector<HTMLDetailsElement>(
      ".inbox-view-items:not([hidden]) details[data-inbox-offered]",
    ) ?? assert.fail("what was offered is folded");
  act(() => {
    fold().open = true;
  });
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?", "Withdrawn", false]);
  assert.equal(fold().open, false, "the fold opened on one item stands closed on the next");
  assert.equal(fold().querySelector("summary")?.textContent, "2 options offered");
  const withdrawn =
    page.querySelector('[data-inbox-comment="withdrawn"]') ??
    assert.fail("the agent's taking it back is a comment");
  assert.match(
    wordsOf(withdrawn.querySelector(".inbox-comment-head")) ?? "",
    /^Alertswithdrew this /u,
  );
  assert.equal(withdrawn.querySelector("p")?.textContent, "The plan now says 7 days.");
});

test("a teammate's open item does not need you: its subject's line says it waits on them, by their face and name, with no attention mark, and its box still takes your answer", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: CHARLES }, RETRY]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?", "Waiting on Charles Pan", false]);
  const standing =
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-standing") ??
    assert.fail("the subject says where the item stands");
  assert.equal(
    standing.querySelector<HTMLElement>(".actor-mark")?.dataset.kind,
    "person",
    "the teammate is named by their face",
  );
  assert.ok(
    page.querySelector(".inbox-view-items:not([hidden]) .composer-editor"),
    "any member may answer",
  );
});

test("a waiting choice wears a Recommended badge at the head of the option its agent recommends and of no other, and a choice recommending nothing wears none", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(optionHeads(page), [
    "Retry 3 times over an hourRecommended1Backs off 5, 15, then 40 minutes.",
    "Retry once2",
  ]);

  act(() => root?.unmount());
  root = undefined;
  const response = {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Retry 3 times over an hour" }, { label: "Retry once" }],
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, response }, RETRY]);
  const again = mount();
  await settle();
  assert.deepEqual(optionHeads(again.page), ["Retry 3 times over an hour1", "Retry once2"]);
});

/** The open item's options, a choice's radios or checkboxes, in order. */
function openOptions(pane: HTMLElement): HTMLButtonElement[] {
  return [...pane.querySelectorAll<HTMLButtonElement>('[role="radio"], [role="checkbox"]')];
}

/** The labels of the open item's options that stand checked. */
function checkedOptions(pane: HTMLElement): (string | null | undefined)[] {
  return openOptions(pane)
    .filter((option) => option.getAttribute("aria-checked") === "true")
    .map((option) => option.querySelector(".luke-choice-label")?.textContent);
}

/** The open item's Send, at its box's foot. */
function answerSend(pane: HTMLElement): HTMLButtonElement {
  return (
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("no Send")
  );
}

/** What the box's quiet line says, or nothing where it says nothing. */
function quietWords(pane: HTMLElement): string | null {
  return pane.querySelector("[data-inbox-quiet]")?.textContent ?? null;
}

/**
 * A key pressed on an element as the browser presses it: a button's Enter
 * and Space press the button unless a handler held the key back, which
 * jsdom does not do of itself.
 */
function keyOn(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    const presses = key === "Enter" || key === " ";
    if (presses && !event.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  });
}

test("a waiting choice of one is a radio list, each option led by its radio and numbered at its right: a number key picks its option from the list's row and takes the keyboard there, Space picks the focused one, a number typed in the box picks nothing, and J still steps the list", async () => {
  const keys = standKeymap();
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  assert.deepEqual(
    openOptions(pane).map((option) => [
      option.getAttribute("role"),
      option.querySelector(".luke-choice-control")?.getAttribute("data-shape"),
      option.getAttribute("aria-keyshortcuts"),
    ]),
    [
      ["radio", "radio", "1"],
      ["radio", "radio", "2"],
    ],
  );

  const row = rowNamed(page, "Alert at 80%?");
  act(() => row.focus());
  pressKey("2", row);
  assert.deepEqual(checkedOptions(pane), ["Retry once"]);
  assert.equal(document.activeElement, openOptions(pane)[1], "the keyboard follows the pick");

  const first = openOptions(pane)[0] ?? assert.fail("no first option");
  act(() => first.focus());
  keyOn(first, " ");
  assert.deepEqual(checkedOptions(pane), ["Retry 3 times over an hour"]);

  composerEditor(pane).focus();
  pressKey("2", composerEditor(pane));
  assert.deepEqual(
    checkedOptions(pane),
    ["Retry 3 times over an hour"],
    "typing a number picks none",
  );

  act(() => first.focus());
  pressKey("j", first);
  assert.equal(readTitle(page), "Expire after 7 days?");
  act(() => keys.unmount());
});

test("Enter on a focused option sends the answer and never presses the option; with nothing picked, Enter there or in the box sends nothing, takes the keyboard to the options, and says on the box's foot what is missing until an option is picked", async () => {
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.equal(document.activeElement, openOptions(pane)[0], "the keyboard goes to the options");
  assert.equal(quietWords(pane), "Pick an option");
  keyOn(openOptions(pane)[0] ?? assert.fail("no option"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "an answer lacking its pick goes nowhere");
  assert.deepEqual(checkedOptions(pane), [], "and Enter picked nothing");

  const once = openOptions(pane)[1] ?? assert.fail("no second option");
  act(() => once.click());
  assert.equal(quietWords(pane), null, "the line goes once the pick is made");
  keyOn(once, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, choices }) => ({ reply, choices })),
    [{ reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] }],
  );
  // The answer stands at once, as sent: the pick Enter was on, never pressed off.
  assert.deepEqual(answeredPicks(page), ["Retry once"], "Enter left the pick standing");
});

test("a waiting choice of several is a checkbox list whose box counts the picks on its foot: the arrows move along it picking nothing, a number key toggles its option, and Enter on a picked option sends every pick and lets none go", async () => {
  inboxes.set(BILLING.id, [
    {
      ...THRESHOLD,
      response: {
        type: INBOX_RESPONSE.CHOICE,
        multiple: true,
        options: [{ label: "Email" }, { label: "Slack" }, { label: "Pager" }],
      },
    },
    RETRY,
  ]);
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  const boxes = () => openOptions(pane);
  assert.deepEqual(
    boxes().map((box) => box.querySelector(".luke-choice-control")?.getAttribute("data-shape")),
    ["box", "box", "box"],
  );
  assert.equal(quietWords(pane), "Pick any that apply");
  assert.equal(pane.textContent?.includes("Pick any that apply."), false, "no line under the list");

  const email = boxes()[0] ?? assert.fail("no Email");
  act(() => email.focus());
  keyOn(email, "ArrowDown");
  assert.equal(document.activeElement, boxes()[1]);
  keyOn(boxes()[1] ?? assert.fail("no Slack"), "ArrowUp");
  keyOn(email, "ArrowUp");
  assert.equal(document.activeElement, boxes()[2], "the arrows wrap");
  assert.deepEqual(checkedOptions(pane), [], "and pick nothing");

  pressKey("3", document.activeElement ?? document.body);
  pressKey("1", document.activeElement ?? document.body);
  pressKey("2", document.activeElement ?? document.body);
  pressKey("2", document.activeElement ?? document.body);
  assert.deepEqual(checkedOptions(pane), ["Email", "Pager"]);
  assert.equal(quietWords(pane), "2 picked");

  keyOn(email, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, choices }) => ({ reply, choices })),
    [{ reply: INBOX_REPLY.CHOSE, choices: ["Pager", "Email"] }],
  );
  // The answer stands at once, as sent: every pick, Enter's own among them.
  assert.deepEqual(answeredPicks(page), ["Email, Pager"], "Enter let no pick go");
});

test("Enter anywhere in a form, in a short number field or its text field's composer, sends it once its required fields are filled, and before that takes the keyboard to the first one left empty, the box's foot naming it; Shift+Enter in a text field is a new line, and an @ there picks a mention written in as its link", async () => {
  inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      response: {
        type: INBOX_RESPONSE.FORM,
        fields: [
          { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
          { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
          { type: INBOX_FIELD.NUMBER, label: "Retries" },
          { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        ],
      },
    },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  const field = (label: string) =>
    [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
      (each) => each.dataset.inboxFieldLabel === label,
    ) ?? assert.fail(`no ${label} field`);
  const retries = field("Retries").querySelector("input") ?? assert.fail("no Retries input");

  act(() => retries.focus());
  keyOn(retries, "Enter");
  await settle();
  assert.deepEqual(sent, []);
  assert.equal(document.activeElement, segment(segmentedGroup(pane, "Severity"), "Low"));
  assert.equal(quietWords(pane), "Fill in Severity");

  act(() => segment(segmentedGroup(pane, "Severity"), "High").click());
  keyOn(segment(segmentedGroup(pane, "Severity"), "High"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "Enter on the pill sends nothing yet");
  assert.equal(document.activeElement, composerEditor(field("Reason")));
  assert.equal(quietWords(pane), "Fill in Reason");
  assert.equal(
    segment(segmentedGroup(pane, "Severity"), "High").getAttribute("aria-checked"),
    "true",
  );

  typeInComposer(field("Reason"), "Spiked twice\nSee @roll");
  await settle();
  pressInComposer(field("Reason"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "the first Enter picks the mention");
  pressInComposer(field("Reason"), "Enter");
  await settle();
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  assert.deepEqual(
    sent.map(({ reply, values }) => ({ reply, values })),
    [
      {
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Severity", value: "High" },
          { label: "Reason", value: `Spiked twice\nSee ${file}` },
          { label: "Page on-call", value: false },
        ],
      },
    ],
  );
});

/** The open item's only item in the Inbox: an item of the agent's asking `response`, the rest of the list as it stands. */
function onlyAsking(response: InboxItem["response"], extra: Partial<InboxItem> = {}): InboxItem {
  const asking = { ...THRESHOLD, response, ...extra };
  inboxes.set(BILLING.id, [asking, RETRY]);
  return asking;
}

/** The words of every button at the open item's box's foot, the Send among them. */
function footPresses(pane: HTMLElement): (string | null)[] {
  return [...pane.querySelectorAll<HTMLButtonElement>(".inbox-answer-actions button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
}

test("an approval is decided in its question, Approve and Decline two cards picked as a choice of two, each numbered, its mark green or red once picked; its box ends in the one Send, Enter going to the cards until one is picked and then sending it", async () => {
  onlyAsking({ type: INBOX_RESPONSE.APPROVAL });
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  assert.deepEqual(
    openOptions(pane).map((card) => [
      card.querySelector(".luke-choice-label")?.textContent,
      card.getAttribute("aria-keyshortcuts"),
      card.dataset.tone,
    ]),
    [
      ["Approve", "1", "complete"],
      ["Decline", "2", "danger"],
    ],
  );
  assert.deepEqual(
    footPresses(pane),
    ["Dictate", "Send to agent"],
    "Decline and Approve left the foot",
  );

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(sent, []);
  assert.equal(document.activeElement, openOptions(pane)[0]);
  assert.equal(quietWords(pane), "Approve or decline");

  pressKey("2", document.activeElement ?? document.body);
  assert.deepEqual(checkedOptions(pane), ["Decline"]);
  assert.equal(quietWords(pane), null);
  keyOn(openOptions(pane)[1] ?? assert.fail("no Decline"), "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply }) => reply),
    [INBOX_REPLY.DECLINED],
  );
  // The answer stands at once, as sent: the pick Enter was on, never pressed off.
  assert.deepEqual(answeredPicks(page), ["Decline"], "Enter left the pick standing");
});

test("a to-do is a card of two picks in its question: its step, the item's title, over a Couldn't do it, picked as a choice of two by a press, the arrows, or its number, and sent by the box's one Send", async () => {
  onlyAsking({ type: INBOX_RESPONSE.TODO }, { title: "Add POSTMARK_SERVER_TOKEN to Vercel" });
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  const [step, pill] = openOptions(pane);
  assert.ok(step && pill, "the card holds two picks");
  assert.equal(step.textContent, "Add POSTMARK_SERVER_TOKEN to Vercel1");
  assert.equal(pill.textContent, "Couldn't do it2");
  assert.deepEqual([step.tabIndex, pill.tabIndex], [0, -1], "Tab lands on the step");
  assert.deepEqual(footPresses(pane), ["Dictate", "Send to agent"], "Done left the foot");

  act(() => step.click());
  assert.equal(step.getAttribute("aria-checked"), "true");
  act(() => step.focus());
  keyOn(step, "ArrowDown");
  assert.equal(pill.getAttribute("aria-checked"), "true", "the arrow picks as it moves");
  assert.equal(document.activeElement, pill);
  pressKey("1", pill);
  assert.equal(step.getAttribute("aria-checked"), "true");
  assert.equal(document.activeElement, step);
  act(() => step.click());
  assert.equal(step.getAttribute("aria-checked"), "false", "a press on the pick takes it back");
  keyOn(step, "Enter");
  assert.equal(quietWords(pane), "Tick it, or say you couldn't");
  assert.equal(step.getAttribute("aria-checked"), "false", "Enter ticks nothing");

  act(() => step.click());
  typeInComposer(pane, "Added it under Production.");
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, note }) => ({ reply, note })),
    [{ reply: INBOX_REPLY.DONE, note: "Added it under Production." }],
  );
});

test("a note's Send says Got it while its box is empty and Send once a word is written, and Enter in its box sends the nod, with no Got it at the foot beside it", async () => {
  onlyAsking({ type: INBOX_RESPONSE.NONE });
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  assert.deepEqual(footPresses(pane), ["Dictate", "Got it"]);
  assert.equal(answerSend(pane).textContent, "Got it");
  typeInComposer(pane, "Looks right");
  assert.equal(answerSend(pane).textContent, "Send");
  act(() => composerEditor(pane).editor?.commands.clearContent(true));
  assert.equal(answerSend(pane).textContent, "Got it");

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, note }) => ({ reply, note })),
    [{ reply: INBOX_REPLY.ACKNOWLEDGED, note: undefined }],
  );
});

test("a settled approval or to-do still folds what it offered to one line, and its answer's chip reads the decision, Approve or Couldn't do it", async () => {
  const settled = (
    id: string,
    title: string,
    response: InboxItem["response"],
    reply: NonNullable<InboxItem["answer"]>,
  ) => ({
    ...item(id, title, 6_000),
    response,
    status: INBOX_STATUS.ANSWERED,
    settledAt: 6_000,
    answeredBy: READER,
    answer: reply,
  });
  inboxes.set(BILLING.id, [
    settled(
      "a1b2c3d4-0000-4000-8000-000000000031",
      "Run the migration?",
      { type: INBOX_RESPONSE.APPROVAL },
      { reply: INBOX_REPLY.APPROVED },
    ),
    settled(
      "a1b2c3d4-0000-4000-8000-000000000032",
      "Add the token",
      { type: INBOX_RESPONSE.TODO },
      { reply: INBOX_REPLY.NOT_DONE },
    ),
  ]);
  const { page } = mount();
  await settle();
  const read = (title: string) => {
    act(() => rowNamed(page, title).click());
    const pane = itemPane(page);
    return [
      pane.querySelector("details[data-inbox-offered] summary")?.textContent,
      pane.querySelector("[data-inbox-pick]")?.textContent,
    ];
  };
  assert.deepEqual(read("Run the migration?"), ["2 options · you picked Approve", "Approve"]);
  assert.deepEqual(read("Add the token"), [
    "2 options · you picked Couldn't do it",
    "Couldn't do it",
  ]);
});

test("a settled choice whose pick is not the one recommended marks each apart: the pick by whose it was, and the recommended option by its badge", async () => {
  inboxes.set(BILLING.id, [
    THRESHOLD,
    { ...RETRY, answer: { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] } },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  openOffered(page);

  assert.deepEqual(optionHeads(page, true), [
    "Retry 3 times over an hourRecommendedBacks off 5, 15, then 40 minutes.",
    "Retry onceYour pick",
  ]);
});

test("a teammate's answer names them by their disc and name, beside their pick and over what they chose, and their name hangs their card", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, answeredBy: CHARLES }]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  openOffered(pane);
  const picked =
    [...pane.querySelectorAll('[aria-label="What the agent offered"] li')].find((option) =>
      option.textContent?.includes("pick"),
    ) ?? assert.fail("the pick is marked");
  assert.equal(
    wordsOf(picked),
    "Retry 3 times over an hourCharles Pan’s pickRecommendedBacks off 5, 15, then 40 minutes.",
  );
  assert.equal(picked.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
  assert.equal(
    pane.querySelector("details[data-inbox-offered] summary")?.textContent,
    "2 options · Charles Pan picked Retry 3 times over an hour",
  );
  const reply =
    pane.querySelector<HTMLElement>('[data-inbox-comment="answered"]') ??
    assert.fail("their answer");
  assert.match(answerHead(page) ?? "", /^Charles Pan.+ · /u);
  assert.equal(reply.querySelector("[data-inbox-pick]")?.textContent, "Retry 3 times over an hour");

  const answerer = reply.querySelector("[data-actor-ref]") ?? assert.fail("the answerer is named");
  act(() => {
    answerer.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-actor-card='person']");
  assert.match(card?.textContent ?? "", /Charles Pan/u);
});

test("a form stacks its fields, each its name over its control, \"Optional\" after the name of one that may be left empty and \"Required\" nowhere: a select's options are pills, an optional one's pick taken back by pressing it again and a required one's kept, a yes-or-no a checkbox beside its name, a number a short field, and a text field the composer's own field", async () => {
  inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      response: {
        type: INBOX_RESPONSE.FORM,
        fields: [
          { type: INBOX_FIELD.SELECT, label: "Channel", options: ["Email", "Slack"] },
          { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
          { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
          { type: INBOX_FIELD.NUMBER, label: "Retries" },
          { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
        ],
      },
    },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const pane = itemPane(page);
  const channel = () => segmentedGroup(pane, "Channel");
  const severity = () => segmentedGroup(pane, "Severity");
  const onCall = () =>
    pane.querySelector<HTMLInputElement>('[data-inbox-field="boolean"] input[type="checkbox"]') ??
    assert.fail("no Page on-call checkbox");
  const unpicked = readSegmented(channel());

  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  const picked = [readSegmented(channel()).checked, readSegmented(severity()).checked];
  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  act(() => onCall().click());

  assert.deepEqual(
    [...pane.querySelectorAll("[data-inbox-field]")].map((each) => [
      each.getAttribute("data-inbox-field"),
      each.querySelector(".inbox-field-optional") !== null,
    ]),
    [
      ["select", true],
      ["select", false],
      ["boolean", true],
      ["number", true],
      ["text", false],
    ],
  );
  assert.equal(pane.textContent?.includes("Required"), false);
  assert.equal(channel().dataset.look, "pill");
  assert.deepEqual(unpicked, { options: ["Email", "Slack"], checked: [], tabStops: ["Email"] });
  assert.deepEqual(picked, [["Slack"], ["High"]]);
  assert.deepEqual(readSegmented(channel()).checked, [], "the optional pick is taken back");
  assert.deepEqual(readSegmented(severity()).checked, ["High"], "the required pick stands");
  assert.equal(onCall().checked, true);
  assert.ok(pane.querySelector('[data-inbox-field="number"] .inbox-field-short input'));
  assert.ok(pane.querySelector('[data-inbox-field="text"] .inbox-field-composer .composer-editor'));
  const reason =
    pane.querySelector<HTMLElement>('[data-inbox-field="text"]') ?? assert.fail("no Reason");
  act(() => reason.querySelector<HTMLElement>(".luke-field-label")?.click());
  assert.equal(
    document.activeElement,
    composerEditor(reason),
    "a press on its name takes the caret in",
  );
  assert.equal(
    document.getElementById(composerEditor(reason).getAttribute("aria-labelledby") ?? "")
      ?.textContent,
    "Reason",
  );
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
  const [task, agent] = crumbs;
  assert.equal(
    task?.querySelector('[aria-hidden="true"]')?.innerHTML,
    renderToStaticMarkup(createElement(DocumentIcon)),
    "the plan's crumb wears its tab's document glyph",
  );
  assert.ok(
    agent?.querySelector('[aria-hidden="true"] .state-glyph'),
    "the agent's crumb wears its mark",
  );
  assert.equal(page.querySelectorAll(".inbox-view-items .desktop-toolbar button").length, 2);
  act(() => crumbs[0]?.click());
  act(() => crumbs[1]?.click());
  assert.deepEqual(asked.shownTasks, [BILLING.id]);
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

test("an image an item shows is drawn, and a press opens it over the window", async () => {
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c70",
    alt: "The pull request tab",
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, blocks: [shot] }, RETRY]);
  const { page } = mount();
  await settle();
  // The image lands once its item's own read does, as the pane's read holds the items it is kept for.
  for (const land of imageReads.splice(0)) land();
  await settle();
  const picture = page.querySelector<HTMLImageElement>("[data-inbox-image] img");
  assert.ok(picture, "the item draws its image");
  assert.equal(picture.alt, "The pull request tab");
  const press = page.querySelector<HTMLButtonElement>(
    'button[aria-label="Enlarge The pull request tab"]',
  );
  assert.ok(press, "the image is pressed to enlarge it");
  act(() => press.click());
  assert.equal(
    document.querySelector<HTMLImageElement>(".attachment-viewer-image")?.alt,
    "The pull request tab.png",
  );
});

test("an image that lands before its item's own read does is drawn all the same", async () => {
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c71",
    alt: "The sandbox's window",
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, blocks: [shot] }, RETRY]);
  // The list's read of the plan answers, while the pane's own read of it is held.
  let billingReads = 0;
  startRead = (taskId) =>
    taskId === BILLING.id && billingReads++ > 0 ? new Promise(() => undefined) : undefined;
  const { page } = mount();
  await settle();
  assert.ok(page.querySelector("[data-inbox-image]"), "the item is drawn from the list's read");
  for (const land of imageReads.splice(0)) land();
  await settle();
  assert.equal(
    page.querySelector<HTMLImageElement>("[data-inbox-image] img")?.alt,
    "The sandbox's window",
  );
});

/** The card standing in the window, as a reader hears it: the agent's name, then what its corner says, such as "Working…". */
/** The buttons of the card standing in the window that offer to open something, by what they say: none, since the control the card hangs from opens what it is about. */
function openings(card: string): string[] {
  const standing = document.querySelector(`.luke-tooltip-card ${card}`);
  assert.ok(standing, "a card is hung");
  return [...standing.querySelectorAll("button")]
    .map((button) => button.textContent ?? "")
    .filter((words) => words.startsWith("Open"));
}

function standingCard(): readonly [string | null | undefined, string | null | undefined] {
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "an agent's card is hung");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
  ];
}

/** Rests on a control as the keyboard reaches it, which hangs its card as a resting pointer does. */
function reach(control: HTMLElement): void {
  document.documentElement.dataset.keyboard = "true";
  act(() => control.focus());
}

/** The agent's references in the pane's thread, each its tile and its name as one button. */
function threadRefs(page: HTMLElement): HTMLButtonElement[] {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(
      '.inbox-board button[data-actor-ref][data-kind="agent"]',
    ),
  ];
}

/** Whether a reference wears an agent's tile, the solid rounded square every agent is drawn on. */
function wearsAgentTile(element: Element): boolean {
  return element.querySelector('.actor-mark[data-kind="agent"]') !== null;
}

test("the thread names its agent as one button wherever it does, its subject's line, its question's comment, and the line saying an answer was sent to it: each hangs the agent's tab's card, which offers no Open agent, and opens its tab, leaving the Inbox", async () => {
  const { page, asked } = mount();
  await settle();
  const [byline, comment] = threadRefs(page);
  assert.ok(byline, "the subject's line names the agent");
  assert.equal(byline.textContent, "Alerts");
  assert.ok(wearsAgentTile(byline), "the subject's line wears the agent's tile");
  assert.equal(comment?.textContent, "Alerts", "the question's comment names the agent");
  const asking =
    page.querySelector('[data-inbox-comment="asked"]') ?? assert.fail("the question is a comment");
  assert.ok(
    asking.querySelector('.inbox-comment-face .actor-mark[data-kind="agent"]'),
    "the agent's tile leads its comment",
  );
  reach(byline);
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  assert.deepEqual(openings("[data-tab-card]"), [], "the name is the way to the tab");
  act(() => byline.click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);

  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = page.querySelector<HTMLButtonElement>(
    '[data-inbox-comment="answered"] button[data-actor-ref][data-kind="agent"]',
  );
  assert.ok(sent, "the line saying the answer was sent names the agent");
  assert.equal(sent.textContent, "Alerts");
  assert.ok(wearsAgentTile(sent), "the line names the agent by its tile too");
  reach(sent);
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  assert.deepEqual(openings("[data-tab-card]"), []);
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
  assert.ok(wearsAgentTile(mark), "the row's mark is the agent's tile");
  act(() => {
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.deepEqual(standingCard(), ["Alerts", "Working…"]);
  // A press on the card, as one selecting its words makes, leaves the row unchosen and the card standing.
  const card = document.querySelector<HTMLElement>(".luke-tooltip-card [data-tab-card]");
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
  assert.ok(wearsAgentTile(other), "a bare mark is still an agent's tile");
});

test("an item's mark hangs a card naming the teammate who started its agent, as the plan's row names them, and no starter on the reader's own agent", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  /** The words of the card the row's mark hangs, the task's row naming its agent as started by `starter`. */
  const markCard = async (starter: typeof CHARLES): Promise<string | null | undefined> => {
    const { page } = mount();
    await settle();
    const line = BILLING.agents?.agents[0];
    assert.ok(line && BILLING.agents, "the plan's row names its agent");
    const agents = { ...BILLING.agents, agents: [{ ...line, startedBy: starter }] };
    act(() => setTasks([{ ...BILLING, agents }, INVITES]));
    const mark = rowNamed(page, "How is a failed email retried?").querySelector("[data-agent-ref]");
    assert.ok(mark, "the row's mark is the agent's reference");
    act(() => {
      mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const words = wordsOf(document.querySelector(".luke-tooltip-card [data-tab-card]"));
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return words;
  };

  assert.match((await markCard(CHARLES)) ?? "", /Started by Charles Pan/u);
  const own = await markCard(READER);
  assert.match(own ?? "", /Alerts/u, "the reader's own agent still hangs its card");
  assert.doesNotMatch(own ?? "", /Started by/u);
});

test("a plan main says changed is read again, so an item answered on another Mac lists as settled; the Needs you tab then lists only what still needs you until another tab is pressed, and outlives a relaunch", async () => {
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
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
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

  const needsYou = () => showTab(page, "Needs you");
  assert.equal(needsYou().getAttribute("aria-selected"), "false");
  act(() => needsYou().click());
  assert.equal(needsYou().getAttribute("aria-selected"), "true");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(needsYou().getAttribute("aria-selected"), "true");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  act(() => showTab(page, "Everything").click());
  assert.equal(needsYou().getAttribute("aria-selected"), "false");
  assert.deepEqual(listed(page), everything);
});

test("each tab counts what it lists, filtered out or not: Needs you's count in the attention mark's orange while anything needs you and quiet while nothing does, and the counts move as an item is answered elsewhere", async () => {
  const answered = { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] };
  const settled = { ...EXPIRY, status: INBOX_STATUS.ANSWERED, answer: answered };
  inboxes.set(INVITES.id, [settled]);
  inboxes.set(BILLING.id, [RETRY]);
  const { page } = mount();
  await settle();
  const tone = () =>
    showTab(page, "Needs you").querySelector("[data-tone]")?.getAttribute("data-tone");
  assert.deepEqual(showTabs(page), [
    "Needs you 0",
    "Unread 0",
    "All open 0",
    "[Everything 2]",
    "Archived 0",
  ]);
  assert.equal(tone(), "quiet");

  // Another task's agent asks again, unread, as main says that task changed.
  inboxes.set(INVITES.id, [{ ...EXPIRY, updatedAt: 6_000, unread: true }]);
  act(() =>
    setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 1, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(showTabs(page), [
    "Needs you 1",
    "Unread 1",
    "All open 1",
    "[Everything 2]",
    "Archived 0",
  ]);
  assert.equal(tone(), "attention");
});

test("an archived task's items stand on the Archived tab alone, counted there and nowhere else: each drawn as it stood, needing nobody, read but not answered, the box giving way to Unarchive, which brings the task back; the tab is never where a relaunch opens", async () => {
  const archivedInvites: TaskSummary = { ...INVITES, archivedAt: 9_000 };
  const { page, asked } = mount([], { standing: [BILLING], archived: [archivedInvites] });
  await settle();
  assert.deepEqual(showTabs(page), [
    "Needs you 1",
    "Unread 0",
    "All open 1",
    "[Everything 2]",
    "Archived 1",
  ]);
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
  ]);

  act(() => showTab(page, "Archived").click());
  await settle();
  assert.deepEqual(listed(page), ["# Invites", "▸ Expire after 7 days?"]);
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?", "Archived", false]);
  const pane =
    page.querySelector<HTMLElement>(".inbox-view-items:not([hidden])") ??
    assert.fail("the item is shown beside the list");
  const options = [...pane.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.equal(options.length, 2, "what it asks still stands");
  assert.ok(
    options.every((option) => option.disabled),
    "its options take no pick",
  );
  assert.equal(pane.querySelector(".inbox-answer"), null, "no box takes an answer");
  assert.match(pane.textContent ?? "", /Unarchive the task to answer or reply/u);
  const unarchive =
    [...pane.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Unarchive",
    ) ?? assert.fail("the pane offers Unarchive");
  act(() => unarchive.click());
  assert.deepEqual(asked.marks, [[INVITES.id, TASK_MARK.UNARCHIVE]]);
  assert.equal(window.localStorage.getItem(SHOW_KEY), JSON.stringify("all"));
});

test("a link to an archived task's item opens it on the Archived tab, which lists it, rather than saying it is not found", async () => {
  const archivedInvites: TaskSummary = { ...INVITES, archivedAt: 9_000 };
  const { page } = mount([], { standing: [BILLING], archived: [archivedInvites] });
  await settle();
  act(() => chooseFromOutside({ taskId: INVITES.id, itemId: EXPIRY.id, opened: true }));
  await settle();
  assert.equal(showTab(page, "Archived").getAttribute("aria-selected"), "true");
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?", "Archived", false]);
});

test("a fresh profile opens the Inbox on All open, grouped by task, a settled item left out until Everything is pressed", async () => {
  window.localStorage.clear();
  const { page } = mount();
  await settle();
  assert.deepEqual(showTabs(page), [
    "Needs you 2",
    "Unread 0",
    "[All open 2]",
    "Everything 3",
    "Archived 0",
  ]);
  assert.deepEqual(listed(page), [
    "# Invites",
    "▸ *Expire after 7 days?",
    "# Billing usage alerts",
    "*Alert at 80%?",
  ]);
  act(() => showTab(page, "Everything").click());
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "*Alert at 80%?",
    "# Invites",
    "▸ *Expire after 7 days?",
  ]);
});

test("a Needs you press kept before the tabs opens the Inbox on the Needs you tab, and one left off opens it on Everything, all that list then held; a tab pressed since is kept in its place", async () => {
  window.localStorage.clear();
  window.localStorage.setItem(EARLIER_SHOW_KEY, JSON.stringify(true));
  let { page } = mount();
  await settle();
  assert.deepEqual(showTabs(page), [
    "[Needs you 2]",
    "Unread 0",
    "All open 2",
    "Everything 3",
    "Archived 0",
  ]);
  act(() => root?.unmount());

  window.localStorage.setItem(EARLIER_SHOW_KEY, JSON.stringify(false));
  ({ page } = mount());
  await settle();
  assert.deepEqual(showTabs(page), [
    "Needs you 2",
    "Unread 0",
    "All open 2",
    "[Everything 3]",
    "Archived 0",
  ]);
  act(() => showTab(page, "Unread").click());
  act(() => root?.unmount());
  root = undefined;

  ({ page } = mount());
  await settle();
  assert.deepEqual(showTabs(page), [
    "Needs you 2",
    "[Unread 0]",
    "All open 2",
    "Everything 3",
    "Archived 0",
  ]);
});

test("grouped by person or by nothing, each row names its task in a chip before its preview, never on its title's line, which the title keeps whole; grouped by task, the header names it and the rows wear no chip", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  const { page } = mount();
  await settle();
  const chips = () =>
    ["Alert at 80%?", "Expire after 7 days?"].map((title) => {
      const row = rowNamed(page, title);
      return {
        chip: row.querySelector(".luke-list-row-description .luke-list-row-lead")?.textContent,
        firstLine: row.querySelector(".luke-list-row-head")?.textContent?.includes(title)
          ? row.querySelector(".luke-list-row-head .luke-list-row-lead, .home-row-context")
          : "the title is not on the first line",
        preview: row.querySelector(".luke-list-row-description")?.textContent,
      };
    });
  assert.deepEqual(
    chips().map(({ chip }) => chip),
    [undefined, undefined],
  );

  chooseView(page, "Group by", "None");
  assert.deepEqual(chips(), [
    {
      chip: "Billing usage alerts",
      firstLine: null,
      preview: "Billing usage alertsChoice · 2 options, one recommended",
    },
    {
      chip: "Invites",
      firstLine: null,
      preview: "InvitesChoice · 2 options, one recommended",
    },
  ]);

  chooseView(page, "Group by", "Person");
  assert.deepEqual(
    chips().map(({ chip, firstLine }) => [chip, firstLine]),
    [
      ["Billing usage alerts", null],
      ["Invites", null],
    ],
  );
});

test("on the Unread tab, the first item chosen is the reader's unread one, which keeps its place among the steps once opening it reads it, and K and J step only among what is unread", async () => {
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("unread"));
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "How is a failed email retried?"]);
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");
  pressKey("j");
  assert.equal(
    readTitle(page),
    "How is a failed email retried?",
    "the read item left once it was left, and the read one in its task is no step",
  );
  act(() => keys.unmount());
});

test("a folded plan counts what in it needs you, and one where nothing does counts nothing", async () => {
  const { page } = mount();
  await settle();
  inboxes.set(INVITES.id, [{ ...EXPIRY, status: INBOX_STATUS.CLOSED, updatedAt: 6_000 }]);
  act(() =>
    setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  const headers = () => [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .sidebar-repository-header button[aria-expanded]:not([aria-haspopup])",
    ),
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

/** Lays the Inbox out this wide, as the window would, and tells it so. */
function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".inbox-view");
  assert.ok(view, "the Inbox is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

/** The edge the list is resized by, while it stands. */
function listEdge(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>('.inbox-tasks [role="separator"]');
}

test("the list is resized from its edge between its bounds, and keeps its width across a relaunch", async () => {
  let { page } = mount();
  await settle();
  const edge = () => {
    const separator = listEdge(page);
    assert.ok(separator, "the list has an edge to resize it by");
    return separator;
  };
  const width = () => Number(edge().getAttribute("aria-valuenow"));
  const press = (key: string) => {
    act(() => {
      edge().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };
  assert.equal(width(), 320, "a mail app's list, narrower than the item it reads");
  press("ArrowRight");
  assert.equal(width(), 336);
  press("End");
  assert.equal(width(), 440);
  press("ArrowRight");
  assert.equal(width(), 440, "no wider than its greatest width");

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(width(), 440);
  press("Home");
  assert.equal(width(), 300);
  press("ArrowLeft");
  assert.equal(width(), 300, "no narrower than its least width");

  layOut(page, 900);
  press("End");
  assert.equal(width(), 340, "no wider than leaves the item its room");
});

/** Which of the Inbox's columns a reader finds standing: the list, the item, or both. */
function columnsShown(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  const item = page.querySelector(".inbox-view-items");
  return [
    ...(list === null || list.hasAttribute("hidden") ? [] : ["list"]),
    ...(item === null || item.hasAttribute("hidden") ? [] : ["item"]),
  ];
}

/** The item's bar's press named Inbox, the way back to the list, where there is one. */
function wayBack(page: HTMLElement): HTMLButtonElement | undefined {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-view-items > .desktop-toolbar button"),
  ].find((button) => button.textContent === "Inbox");
}

/** The way back from the item standing alone to the list. */
function backToList(page: HTMLElement): HTMLButtonElement {
  const back = wayBack(page);
  assert.ok(back, "the item standing alone has a way back");
  return back;
}

/** The empty state a column stands, as it reads: its line, or none where the column stands none. */
function emptyStateIn(page: HTMLElement, column: string): string | null {
  const shown = page.querySelector(column);
  assert.ok(shown, "the column is drawn");
  const empty = shown.querySelector(".luke-empty-state");
  return empty === null || shown.hasAttribute("hidden") ? null : (empty.textContent ?? "");
}

test("an Inbox with nothing in it stands its empty state in the pane beside the list, and in the list itself once the list stands alone", async () => {
  inboxes = new Map();
  listedAgents = [];
  const { page } = mount();
  await settle();
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  assert.deepEqual(
    [emptyStateIn(page, ".inbox-tasks"), emptyStateIn(page, ".inbox-view-items")],
    [null, "Nothing needs you"],
  );

  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), "Nothing needs you");
});

test("while its plans are first read, the list stands placeholder rows in its items' place, saying to a reader that the inbox is being read, with no row to press and no ring; once the reads land, the items stand where they stood", async () => {
  const reads = new Map([
    [BILLING.id, pending()],
    [INVITES.id, pending()],
  ]);
  startRead = (taskId) => reads.get(taskId)?.promise;
  const { page } = mount();
  await settle();
  const list = page.querySelector<HTMLElement>(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  const wait = list.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
  assert.equal(wait?.textContent, "Reading your inbox…");
  assert.ok(
    (wait?.querySelectorAll(".luke-list-row .luke-skeleton").length ?? 0) > 0,
    "placeholder rows stand in the items' place",
  );
  assert.deepEqual(listed(page), []);
  assert.equal(list.querySelector(".luke-spinner"), null, "no ring stands in the list's corner");

  reads.get(BILLING.id)?.settle({ items: [THRESHOLD, RETRY], cursor: "1" });
  reads.get(INVITES.id)?.settle({ items: [EXPIRY], cursor: "1" });
  await settle();
  assert.equal(list.querySelector('[aria-busy="true"]'), null);
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
});

test("an Inbox opened before the account's task list is read stands placeholder rows, and neither the list nor the pane says nothing needs you, whatever its width; once the list lands, its items stand", async () => {
  const { page } = mount([], { listUnread: true });
  await settle();
  const list = page.querySelector<HTMLElement>(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  assert.equal(
    list.querySelector('[role="status"][aria-busy="true"]')?.textContent,
    "Reading your inbox…",
  );
  assert.deepEqual(
    [emptyStateIn(page, ".inbox-tasks"), emptyStateIn(page, ".inbox-view-items")],
    [null, null],
  );
  assert.equal(page.querySelector(".sidebar-note"), null, "no line says nothing needs you");
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), null);

  layOut(page, 1200);
  act(() => {
    setTasks([BILLING, INVITES]);
    setListRead(true);
  });
  await settle();
  assert.equal(list.querySelector('[aria-busy="true"]'), null);
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
});

test("an item a link names before the account's task list is read says no Not found, and shows once the list lands", async () => {
  const { page } = mount([], { listUnread: true });
  await settle();
  act(() => chooseFromOutside({ taskId: INVITES.id, itemId: EXPIRY.id, opened: true }));
  await settle();
  assert.doesNotMatch(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);

  act(() => {
    setTasks([BILLING, INVITES]);
    setListRead(true);
  });
  await settle();
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Expire after 7 days?",
  );
});

test("an Inbox too narrow for the list and the item side by side shows the chosen item alone, the whole Inbox wide, under a way back that Back's chord and Escape take as well, the keyboard landing on the item's row; a row pressed opens its item again, and from the list Escape does not leave the Inbox", async () => {
  const { page, asked } = mount();
  await settle();
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Alert at 80%?");
  assert.equal(backToList(page).textContent, "Inbox");

  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(listEdge(page), null, "a list standing alone has no edge to drag");
  assert.ok(
    document.activeElement === rowNamed(page, "Alert at 80%?"),
    "the keyboard is on its row",
  );

  act(() => rowNamed(page, "Expire after 7 days?").click());
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Expire after 7 days?");
  assert.ok(document.activeElement === backToList(page), "the keyboard lands on the way back");
  act(() => runAppCommand(APP_COMMAND.BACK));
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.ok(
    document.activeElement === rowNamed(page, "Expire after 7 days?"),
    "the keyboard is on its row",
  );

  act(() => rowNamed(page, "Expire after 7 days?").click());
  act(() => runAppCommand(APP_COMMAND.INBOX_LIST));
  assert.deepEqual([columnsShown(page), asked.closed], [["list"], 0]);
  act(() => {
    assert.equal(runAppCommand(APP_COMMAND.INBOX_LIST), false, "the list offers no Escape");
  });
  assert.deepEqual([columnsShown(page), asked.closed], [["list"], 0], "the Inbox stands");
});

test("the Inbox joins only once narrowed past the band, keeping the item it shows, and splits again only once widened past it; split again, it forgets the list was asked for, so narrowed it lands on its item", async () => {
  const { page } = mount();
  await settle();
  layOut(page, 900);
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  layOut(page, 860);
  assert.deepEqual(columnsShown(page), ["list", "item"], "within the band it stays split");
  rowNamed(page, "Alert at 80%?").focus();
  layOut(page, 850);
  assert.deepEqual(columnsShown(page), ["item"], "narrowed, the item it shows stays");
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Alert at 80%?");
  assert.ok(
    document.activeElement === backToList(page),
    "the keyboard leaves the hidden row for the item's way back",
  );

  act(() => backToList(page).click());
  layOut(page, 880);
  assert.deepEqual(columnsShown(page), ["list"], "within the band it stays one column");
  layOut(page, 900);
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  assert.equal(wayBack(page), undefined);
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
});

/** The window's keymap, standing beside the Inbox as the shell stands it; the root it is drawn in, to unmount. */
function standKeymap(): Root {
  function Keymap() {
    useAppKeymap(true);
    return null;
  }
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => keys.render(createElement(Keymap)));
  return keys;
}

/** A key pressed alone where the keyboard stands, or into the target given. */
function pressKey(key: string, target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The pager at the end of the item's bar, as it reads: "2 of 3", or none where it is not drawn. */
function pagerOf(page: HTMLElement): string | null {
  return (
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-pager-count")?.textContent ?? null
  );
}

/** One of the pager's arrows, by its name. */
function arrowNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const arrow = page.querySelector<HTMLButtonElement>(`.inbox-pager button[aria-label="${name}"]`);
  assert.ok(arrow, `the pager offers ${name}`);
  return arrow;
}

/** The title of the item the pane reads. */
function readTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]")?.textContent;
}

/** Needs you's empty state in the list as a reader meets it: its heading, its line, and its one press; none where the list stands none. */
function needsYouEmpty(page: HTMLElement): readonly (string | null | undefined)[] | null {
  const empty = page.querySelector(".inbox-tasks:not([hidden]) .luke-empty-state");
  if (empty === null) return null;
  return [
    empty.querySelector("h3")?.textContent,
    empty.querySelector("p")?.textContent,
    empty.querySelector("button")?.textContent,
  ];
}

test("with only settled items, the Needs you tab lists no row, the item read still shown beside the list, which says nothing needs you and offers Show everything, nothing being open; its press shows Everything", async () => {
  const answered = { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] };
  inboxes.set(INVITES.id, [{ ...EXPIRY, status: INBOX_STATUS.ANSWERED, answer: answered }]);
  inboxes.set(BILLING.id, [RETRY]);
  const { page } = mount();
  await settle();
  const button = () => showTab(page, "Needs you");
  const everything = [
    "# Billing usage alerts",
    "▸ How is a failed email retried?",
    "# Invites",
    "Expire after 7 days?",
  ];
  assert.deepEqual(listed(page), everything);

  act(() => button().click());
  assert.equal(button().getAttribute("aria-selected"), "true");
  assert.deepEqual(listed(page), [], "the item read is not listed under a filter leaving it out");
  assert.deepEqual(needsYouEmpty(page), [
    "Nothing needs you",
    "You've answered everything",
    "Show everything",
  ]);
  assert.equal(emptyStateIn(page, ".inbox-view-items"), null, "the pane says nothing twice");
  assert.equal(readTitle(page), "How is a failed email retried?");

  // One column wide, the item read stands alone with nothing to page to, and its way back reaches the empty list.
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(pagerOf(page), null);
  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(needsYouEmpty(page)?.[0], "Nothing needs you");

  const showAll = page.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button");
  assert.ok(showAll, "the empty state offers Show everything");
  act(() => showAll.click());
  assert.equal(showTab(page, "Everything").getAttribute("aria-selected"), "true");
  assert.deepEqual(
    columnsShown(page),
    ["list"],
    "Show all leaves the rows it brings back standing",
  );
  assert.ok(
    document.activeElement === rowNamed(page, "How is a failed email retried?"),
    "the keyboard lands on the row of the item read, not on the button Show all took away",
  );
  assert.deepEqual(listed(page), everything);
  assert.equal(needsYouEmpty(page), null);
});

test("one column wide, an answered item that the Needs you tab draws no row for shows no count in its pager, though its arrows still step to the rows either side, which count only the rows drawn", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  act(() => showTab(page, "Needs you").click());
  assert.deepEqual(listed(page), [
    "# Invites",
    "*Expire after 7 days?",
    "# Billing usage alerts",
    "*Alert at 80%?",
  ]);
  layOut(page, 800);
  assert.equal(readTitle(page), "How is a failed email retried?");
  assert.equal(pagerOf(page), null, "no row, so no count");
  assert.equal(arrowNamed(page, "Previous item").disabled, true);
  act(() => arrowNamed(page, "Next item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "2 of 2"]);
});

test("on the Needs you tab, a focused row whose item is answered on another Mac leaves the keyboard on the tab rather than nowhere", async () => {
  const { page } = mount();
  await settle();
  const needsYou = showTab(page, "Needs you");
  act(() => needsYou.click());
  rowNamed(page, "Expire after 7 days?").focus();
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
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);
  assert.ok(document.activeElement === showTab(page, "Needs you"), "the keyboard is on the tab");
});

test("one column wide, the item's bar says where it stands in the list, and its arrows, K, and J step up and down the list in its order, a settled item among them, stopping at its ends", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  layOut(page, 800);
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "2 of 3"]);

  act(() => arrowNamed(page, "Previous item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["How is a failed email retried?", "1 of 3"]);
  assert.equal(arrowNamed(page, "Previous item").disabled, true, "nothing above the first");
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");

  pressKey("j");
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "2 of 3"]);
  act(() => arrowNamed(page, "Next item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Expire after 7 days?", "3 of 3"]);
  assert.equal(arrowNamed(page, "Next item").disabled, true, "nothing below the last");
  pressKey("j");
  assert.equal(readTitle(page), "Expire after 7 days?");
  act(() => keys.unmount());
});

test("split, K and J move the chosen row and the item beside it, which draws no pager, and a J typed into the item's box is the box's", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  assert.equal(pagerOf(page), null, "the list beside the item says where it stands");

  pressKey("j");
  assert.deepEqual(
    listed(page).filter((row) => row.startsWith("▸")),
    ["▸ *Expire after 7 days?"],
  );
  assert.equal(readTitle(page), "Expire after 7 days?");
  pressKey("k");
  assert.equal(readTitle(page), "Alert at 80%?");

  const box = composerEditor(page.querySelector(".inbox-view-items") ?? page);
  // Note that jsdom computes no `isContentEditable`, which a browser answers for the editor.
  Object.defineProperty(box, "isContentEditable", { value: true });
  box.focus();
  pressKey("j", box);
  assert.equal(readTitle(page), "Alert at 80%?", "the letter is the box's");
  act(() => keys.unmount());
});

test("a folded plan's items have no row, so K and J pass over them and the pager counts the rows a reader finds", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  act(() => headerNamed(page, "Invites").click());
  pressKey("j");
  assert.equal(readTitle(page), "Alert at 80%?", "nothing below the last row");
  layOut(page, 800);
  assert.equal(pagerOf(page), "2 of 2");
  act(() => keys.unmount());
});

test("the chosen item keeps its place when its own plan folds, so J still reaches the rows below, and once left the folded rows are passed over", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  act(() => headerNamed(page, "Billing usage alerts").click());
  pressKey("j");
  assert.equal(readTitle(page), "Expire after 7 days?");
  pressKey("k");
  assert.equal(readTitle(page), "Expire after 7 days?", "the folded plan holds no row above");
  act(() => keys.unmount());
});

test("a settled item offers, over its box, the next item that needs you, by its agent's tile and title and J where J reaches it, a press opening it; an item that waits offers none", async () => {
  const { page } = mount();
  await settle();
  const offered = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  assert.equal(offered(), null, "the item chosen waits on its box");

  act(() => rowNamed(page, "How is a failed email retried?").click());
  const next = offered();
  assert.ok(next, "the settled item offers the next");
  assert.equal(wordsOf(next), "NextAlert at 80%?J");
  assert.ok(wearsAgentTile(next), "the next item's agent stands by its tile");
  act(() => next.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.equal(offered(), null);
});

test("Next hands the keyboard to the item it opens, its way back one column wide and its row split, and the item opens at its thread's top", async () => {
  const { page } = mount();
  await settle();
  const next = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  act(() => rowNamed(page, "How is a failed email retried?").click());
  // Note that the thread's scroller is the area its board stands in.
  const board = page.querySelector<HTMLElement>(".inbox-view-items .inbox-board")?.parentElement;
  assert.ok(board, "the item's thread");
  board.scrollTop = 600;
  next()?.focus();
  act(() => next()?.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.ok(
    document.activeElement === rowNamed(page, "Alert at 80%?"),
    "split, the keyboard is on its row",
  );
  assert.equal(board.scrollTop, 0, "the next item opens at its top");

  layOut(page, 800);
  act(() => backToList(page).click());
  act(() => rowNamed(page, "How is a failed email retried?").click());
  next()?.focus();
  act(() => next()?.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.ok(
    document.activeElement === backToList(page),
    "one column wide, the keyboard is on its way back",
  );
});

test("a press on the row already chosen hands the keyboard nowhere, so a later narrowing leaves it where the developer put it", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  const elsewhere = document.body.appendChild(document.createElement("button"));
  elsewhere.focus();
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.ok(document.activeElement === elsewhere, "the keyboard stays outside the Inbox");
  elsewhere.remove();
});

/** Every answer the pane sends, written down and left unanswered, so the box stays as it was. */
function heldAnswers(): CodingAgentInboxAnswerParams[] {
  const sent: CodingAgentInboxAnswerParams[] = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return bridge.act(request);
      sent.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  return sent;
}

/** The open item's pane, where its box stands. */
function itemPane(page: HTMLElement): HTMLElement {
  return page.querySelector<HTMLElement>(".inbox-view-items") ?? assert.fail("the pane is drawn");
}

/** The names of the files attached in `within`, as each chip names its file. */
function attachedNames(within: Element): (string | null)[] {
  return [...within.querySelectorAll('[aria-label="Attached files"] > li')].map((chip) =>
    chip.getAttribute("title"),
  );
}

test("an item's box is the agent's message box: it takes no caret as the item opens, so K and J stay the list's; Enter sends its note, Shift+Enter is a new line, and Escape leaves the box but not the item", async () => {
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.notEqual(document.activeElement, composerEditor(pane), "opening an item takes no caret");

  typeInComposer(pane, "Use 90%\ninstead");
  pressInComposer(pane, "Escape");
  assert.notEqual(document.activeElement, composerEditor(pane), "Escape leaves the box");
  assert.equal(readTitle(page), "Alert at 80%?", "and the item stands");

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ itemId, reply, note }) => ({ itemId, reply, note })),
    [{ itemId: THRESHOLD.id, reply: INBOX_REPLY.ANSWERED, note: "Use 90%\ninstead" }],
  );
});

/** Whether an item's row wears the Draft pencil. */
function rowDrafted(page: HTMLElement, title: string): boolean {
  return rowNamed(page, title).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null;
}

test("an item whose box holds unsent words wears the Draft pencil on its row while another item is chosen, as a sidebar task's row does, and none while its box stands beside the list; with the list standing alone, the chosen item's row wears it too", async () => {
  const { page } = mount();
  await settle();
  typeInComposer(itemPane(page), "Use 90% instead");
  await settle();
  assert.equal(rowDrafted(page, "Alert at 80%?"), false, "the chosen item's box shows its words");

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(rowDrafted(page, "Alert at 80%?"), true, "the draft is marked while away");
  assert.equal(rowDrafted(page, "Expire after 7 days?"), false, "only the item holding it is");
  assert.equal(rowDrafted(page, "How is a failed email retried?"), false);

  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.equal(composerEditor(itemPane(page)).textContent, "Use 90% instead");
  assert.equal(rowDrafted(page, "Alert at 80%?"), false);
  layOut(page, 800);
  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(rowDrafted(page, "Alert at 80%?"), true, "the list standing alone hides its box");
});

/** Hands `files` to the open item's box: picked in its hidden picker, or dropped on its card. */
async function handFiles(page: HTMLElement, files: readonly File[], how: "pick" | "drop") {
  const pane = itemPane(page);
  if (how === "pick") {
    const picker =
      pane.querySelector<HTMLInputElement>('input[type="file"]') ?? assert.fail("no file picker");
    Object.defineProperty(picker, "files", { configurable: true, value: files });
    act(() => picker.dispatchEvent(new Event("change", { bubbles: true })));
  } else {
    const card = pane.querySelector(".agent-composer") ?? assert.fail("no answer card");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files } });
    act(() => card.dispatchEvent(drop));
  }
  // Note that a file is read off the disk before it lands in the box.
  for (let round = 0; round < 4; round += 1) await settle();
}

test("files picked or dropped in an item's box are drawn as chips and go with its answer, standing for the developer's own words where they wrote none", async () => {
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");

  await handFiles(page, [new File(["threshold: 0.9\n"], "alerts.yml", { type: "" })], "pick");
  await handFiles(page, [new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" })], "drop");
  assert.deepEqual(attachedNames(pane), ["alerts.yml", "spec.pdf"]);

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, note, attachments }) => ({ reply, note, attachments })),
    [
      {
        reply: INBOX_REPLY.ANSWERED,
        note: undefined,
        attachments: [
          { name: "alerts.yml", mediaType: "text/plain", data: btoa("threshold: 0.9\n") },
          { name: "spec.pdf", mediaType: "application/pdf", data: btoa("%PDF-1.7") },
        ],
      },
    ],
  );
});

/** A text file whose bytes are read only once the test opens its gate, as a slow disk would hand them over. */
function gatedFile(name: string, words: string) {
  const file = new File([words], name, { type: "text/plain" });
  let open: () => void = () => undefined;
  const gate = new Promise<ArrayBuffer>((resolve) => {
    open = () => resolve(new TextEncoder().encode(words).buffer);
  });
  Object.defineProperty(file, "arrayBuffer", { value: () => gate });
  return { file, open };
}

test("files whose reads land together both stand in the box", async () => {
  const { page } = mount();
  await settle();
  const first = gatedFile("a.txt", "a\n");
  const second = gatedFile("b.txt", "b\n");
  await handFiles(page, [first.file], "pick");
  await handFiles(page, [second.file], "drop");
  await act(async () => {
    first.open();
    second.open();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settle();
  assert.deepEqual(attachedNames(itemPane(page)), ["a.txt", "b.txt"]);
});

test("files read for an item its agent changed meanwhile land nowhere, and the box says to attach them again", async () => {
  let deliver: (outcome: ReadOutcome) => void = () => undefined;
  heldRead = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const { page } = mount();
  await settle();
  const slow = gatedFile("trace.txt", "boom\n");
  await handFiles(page, [slow.file], "pick");
  const revised = { ...THRESHOLD, revision: 2, title: "Alert at 85%?" };
  act(() =>
    deliver({
      status: ACT_OUTCOME_STATUS.DONE,
      value: { items: [revised, RETRY], cursor: "2" },
    }),
  );
  await settle();
  assert.equal(readTitle(page), "Alert at 85%?");
  await act(async () => {
    slow.open();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settle();
  const pane = itemPane(page);
  assert.deepEqual(attachedNames(pane), [], "the file lands on no revision");
  assert.match(pane.querySelector('[role="alert"]')?.textContent ?? "", /Attach them again/u);
});

test("an answer file whose read failed says so under the files, and Retry reads it again", async () => {
  const answered: InboxItem = {
    ...THRESHOLD,
    response: { type: INBOX_RESPONSE.TEXT },
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
    answer: { reply: INBOX_REPLY.ANSWERED, note: "See the spec." },
    answerFiles: [
      {
        attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f2",
        name: "spec.pdf",
        mediaType: "application/pdf",
      },
    ],
  };
  inboxes = new Map([[BILLING.id, [answered]]]);
  let failing = true;
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return bridge.act(request);
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: failing
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : { contentType: "application/pdf", base64: "JVBERg==" },
      });
    },
  });
  const { page } = mount();
  await settle();
  const comment = () =>
    itemPane(page).querySelector('[data-inbox-comment="answered"]') ??
    assert.fail("the answer is drawn");
  const failed = comment().querySelector("[data-inbox-files-failed]");
  assert.ok(failed, "the failed read is said");
  failing = false;
  const retry = [...failed.querySelectorAll("button")].find((each) =>
    /retry/iu.test(each.textContent ?? ""),
  );
  act(() => retry?.click());
  await settle();
  assert.equal(comment().querySelector("[data-inbox-files-failed]"), null);
  assert.ok(comment().querySelector('button[aria-label="Open spec.pdf"]'), "the file opens now");
});

test("an item that needs no reply says a file attached in its box will be sent to the agent", async () => {
  inboxes = new Map([
    [BILLING.id, [{ ...THRESHOLD, response: { type: INBOX_RESPONSE.TODO }, needsReply: false }]],
  ]);
  const { page } = mount();
  await settle();
  const quiet = () => itemPane(page).querySelector("[data-inbox-quiet]")?.textContent;
  assert.equal(quiet(), "Without a note, this won't message the agent.");
  await handFiles(page, [new File(["ok\n"], "flag.txt", { type: "text/plain" })], "pick");
  assert.equal(quiet(), "Your answer and its files will be sent to the agent.");
});

test("an answered item draws the files its answer carried as a sent message's are, a picture by its thumbnail once read and any other file by its name, and files alone stand under the answer's head with no pick and no empty note", async () => {
  const answered: InboxItem = {
    ...THRESHOLD,
    response: { type: INBOX_RESPONSE.TEXT },
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
    answer: { reply: INBOX_REPLY.ANSWERED },
    answerFiles: [
      {
        attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f1",
        name: "alerts.png",
        mediaType: INBOX_IMAGE_TYPE.PNG,
      },
      {
        attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f2",
        name: "spec.pdf",
        mediaType: "application/pdf",
      },
    ],
  };
  inboxes = new Map([[BILLING.id, [answered]]]);
  const { page } = mount();
  await settle();
  const comment = () =>
    itemPane(page).querySelector('[data-inbox-comment="answered"]') ??
    assert.fail("the answer is drawn");
  assert.deepEqual(attachedNames(comment()), ["alerts.png", "spec.pdf"]);
  assert.equal(comment().querySelector("[data-inbox-pick]"), null, "no chip says it was answered");
  assert.equal(comment().querySelector("[data-inbox-note]"), null, "no empty note stands");

  act(() => {
    for (const land of imageReads) land();
  });
  await settle();
  assert.equal(
    comment().querySelector('[aria-label="Attached files"] img')?.getAttribute("src"),
    "data:image/png;base64,iVBORw0KGgo=",
  );
});

test("in the window's Inbox an @ in an item's box offers its plan's repository's files, and the file picked reaches the agent in the note as its link", async () => {
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);

  typeInComposer(pane, "See @roll");
  await settle();
  const offered = [...pane.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (name) => name.textContent,
  );
  pressInComposer(pane, "Enter");
  await settle();
  const chips = [...composerEditor(pane).querySelectorAll("[data-mention-ref]")].map(
    (chip) => chip.textContent,
  );
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(offered, ["rollout-store.ts"]);
  assert.deepEqual(chips, ["rollout-store.ts"]);
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  assert.deepEqual(
    sent.map(({ note }) => note),
    [`See ${file}`],
  );
});

test("an answered item's note draws a mention it holds as the chip a sent message draws, never as its link's words", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const answered: InboxItem = {
    ...RETRY,
    answer: {
      reply: INBOX_REPLY.CHOSE,
      choices: ["Retry 3 times over an hour"],
      note: `See ${file}`,
    },
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, answered]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  const note = itemPane(page).querySelector('[data-inbox-comment="answered"] [data-inbox-note]');

  assert.equal(note?.querySelector("[data-mention-ref]")?.textContent, "rollout-store.ts");
  assert.equal(note?.textContent, "See rollout-store.ts");
});

test("an answered form draws its values a field a line under the answer's head, a text field's words as a sent message's, so a mention it holds is its chip and never its link's words", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const filled: InboxItem = {
    ...RETRY,
    response: {
      type: INBOX_RESPONSE.FORM,
      fields: [
        { type: INBOX_FIELD.SELECT, label: "Effort", options: ["high", "xhigh"] },
        { type: INBOX_FIELD.TEXT, label: "Reason" },
        { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
      ],
    },
    answer: {
      reply: INBOX_REPLY.SUBMITTED,
      values: [
        { label: "Effort", value: "high" },
        { label: "Reason", value: `See ${file}` },
        { label: "Page on-call", value: false },
      ],
    },
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, filled]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  const values = itemPane(page).querySelector(
    '[data-inbox-comment="answered"] [data-inbox-values]',
  );

  assert.deepEqual(
    [...(values?.querySelectorAll("li") ?? [])].map((line) => [
      line.querySelector(".inbox-value-label")?.textContent,
      line.querySelector(".inbox-value-words")?.textContent,
    ]),
    [
      ["Effort", "high"],
      ["Reason", "See rollout-store.ts"],
      ["Page on-call", "no"],
    ],
  );
  assert.equal(values?.querySelector("[data-mention-ref]")?.textContent, "rollout-store.ts");
});

test("what an item's box said of a dictation that failed stays with that item, and the next item's box opens without it", async () => {
  // The strip draws still under reduced motion, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) =>
      request.kind === ACT_KIND.MICROPHONE_REQUEST
        ? Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MICROPHONE_STATUS.DENIED })
        : bridge.act(request),
  });
  const { page } = mount();
  await settle();
  const alerts = () =>
    [...itemPane(page).querySelectorAll('.agent-composer [role="alert"]')].map(
      (alert) => alert.textContent,
    );

  const dictate =
    itemPane(page).querySelector<HTMLButtonElement>('button[aria-label="Dictate"]') ??
    assert.fail("the microphone is offered");
  await act(async () => dictate.click());
  await settle();
  const refused = alerts();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();

  assert.equal(refused.length, 1, "the dictation says why it left nothing");
  assert.deepEqual(alerts(), [], "the next item's box says nothing of it");
});

/** The repository's one skill read for the box, and every GitHub page a press opened, written down. */
function skillReads(): string[] {
  const opened: string[] = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind === ACT_KIND.TASKS_SKILLS) {
        const release = {
          name: "release",
          description: "Use to cut a release.",
          path: ".agents/skills/release/SKILL.md",
        };
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { skills: { repository: "acme/relay", branch: "main", skills: [release] } },
        });
      }
      if (request.kind === ACT_KIND.GITHUB_OPEN) {
        opened.push(request.payload.url);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      }
      return bridge.act(request);
    },
  });
  return opened;
}

/** The chip of the skill an answered note names, pressed. */
async function pressNoteSkill(page: HTMLElement, name: string): Promise<void> {
  await settle();
  const note = itemPane(page).querySelector('[data-inbox-comment="answered"] [data-inbox-note]');
  const chip = [...(note?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === name,
  );
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());
}

/** Where the release skill's file stands on GitHub. */
const RELEASE_ON_GITHUB = "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md";

test("in the window's Inbox a skill an answered note names is the chip a sent message draws, which opens its SKILL.md on GitHub", async () => {
  const answered: InboxItem = {
    ...RETRY,
    answer: {
      reply: INBOX_REPLY.CHOSE,
      choices: ["Retry 3 times over an hour"],
      note: "Run /release first.",
    },
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, answered]],
    [INVITES.id, [EXPIRY]],
  ]);
  const opened = skillReads();
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await pressNoteSkill(page, "/release");

  assert.deepEqual(opened, [RELEASE_ON_GITHUB]);
});

test("a skill named by a settled item of an agent with no plan that a link reached opens in the agent's own repository, which its group names none of", async () => {
  const settled: InboxItem = {
    ...BUMP,
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
    answer: { reply: INBOX_REPLY.ANSWERED, note: "Run /release first." },
  };
  agentInboxes = new Map([[STRAY_AGENT, [settled]]]);
  pageAgents = new Map([[STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }]]);
  const opened = skillReads();
  const { page } = mount();
  await settle();
  act(() => chooseFromOutside({ agentId: STRAY_AGENT, itemId: BUMP.id, opened: true }));
  await settle();
  await pressNoteSkill(page, "/release");

  assert.deepEqual(opened, [RELEASE_ON_GITHUB]);
});

test("an item that needs no reply says a bare answer won't message the agent, and that a note typed in its box will", async () => {
  const todo: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000009", "Turn on the flag", 6_000),
    response: { type: INBOX_RESPONSE.TODO },
    needsReply: false,
  };
  inboxes = new Map([
    [BILLING.id, [todo]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Turn on the flag").click());
  const quiet = () => page.querySelector(".inbox-view-items [data-inbox-quiet]")?.textContent;
  assert.equal(quiet(), "Without a note, this won't message the agent.");

  typeInComposer(page.querySelector(".inbox-view-items") ?? page, "Done on preview too.");
  assert.equal(quiet(), "Your note will be sent to the agent.");
});

test("an item that needs no reply, once settled, says a note or a file was sent to the agent and a bare press kept for it to read", async () => {
  const quietDone = (id: string, title: string, at: number, note?: string): InboxItem => ({
    ...item(id, title, at),
    response: { type: INBOX_RESPONSE.TODO },
    needsReply: false,
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
    answer: { reply: INBOX_REPLY.DONE, ...(note === undefined ? undefined : { note }) },
  });
  const withFile: InboxItem = {
    ...quietDone("a1b2c3d4-0000-4000-8000-000000000012", "Rotate the key", 5_000),
    answerFiles: [
      {
        attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f1",
        name: "rotation.txt",
        mediaType: "text/plain",
      },
    ],
  };
  inboxes = new Map([
    [
      BILLING.id,
      [
        quietDone(
          "a1b2c3d4-0000-4000-8000-000000000010",
          "Turn on the flag",
          6_000,
          "On preview too.",
        ),
        quietDone("a1b2c3d4-0000-4000-8000-000000000011", "Add the secret", 5_500),
        withFile,
      ],
    ],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  const where = (title: string) => {
    act(() => rowNamed(page, title).click());
    return answerHead(page);
  };
  assert.match(where("Turn on the flag") ?? "", /· Sent to /u);
  assert.match(where("Add the secret") ?? "", /Saved for the agent to read$/u);
  assert.match(
    where("Rotate the key") ?? "",
    /· Sent to /u,
    "a file reaches the agent as a note does",
  );
});

test("an answered item that asked to be heard back, carried without its answer, still says it was sent to the agent", async () => {
  const { answer: _dropped, ...bare } = RETRY;
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, bare]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  assert.match(answerHead(page) ?? "", /· Sent to /u);
});

test("a note answered on an item that needs no reply reaches the agent, so the window reads its agents again, as it does for no bare answer", async () => {
  const todo = (id: string, title: string): InboxItem => ({
    ...item(id, title, 6_000),
    response: { type: INBOX_RESPONSE.TODO },
    needsReply: false,
  });
  const noted = todo("a1b2c3d4-0000-4000-8000-000000000012", "Turn on the flag");
  const bare = todo("a1b2c3d4-0000-4000-8000-000000000013", "Add the secret");
  inboxes = new Map([
    [BILLING.id, [noted, bare]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  const listReads: Act[] = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) listReads.push(request);
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        const asked = request.payload.itemId === noted.id ? noted : bare;
        const answered = { ...asked, status: INBOX_STATUS.ANSWERED, answeredBy: READER };
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { item: answered, taken: true },
        });
      }
      return bridge.act(request);
    },
  });
  const doneAndSend = async () => {
    act(() => openOptions(itemPane(page))[0]?.click());
    await act(async () => answerSend(itemPane(page)).click());
  };

  act(() => rowNamed(page, "Add the secret").click());
  await doneAndSend();
  await settle();
  assert.equal(listReads.length, 0, "a bare Done reaches no one, so nothing about the agent moved");

  act(() => rowNamed(page, "Turn on the flag").click());
  typeInComposer(page.querySelector(".inbox-view-items") ?? page, "On preview too.");
  await doneAndSend();
  await settle();
  assert.ok(listReads.length > 0, "the agent heard the note, so its list is read again");
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
    setTasks([INVITES]);
    setHolding([{ taskId: INVITES.id, items: 1, updatedAt: 4_000 }]);
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
      { taskId: BILLING.id, items: 3, updatedAt: 7_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.ok(listed(page).includes("*Page on-call too?"), listed(page).join(" | "));
});

test("once the chosen plan's own held read fails, an image the list's read draws since still lands", async () => {
  heldRead = () => answered(UNANSWERED_READ);
  const { page } = mount();
  await settle();
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c72",
    alt: "The retry schedule",
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, revision: 2, blocks: [shot] }, RETRY]);
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 7_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  for (const land of imageReads.splice(0)) land();
  await settle();
  assert.equal(
    page.querySelector<HTMLImageElement>("[data-inbox-image] img")?.alt,
    "The retry schedule",
  );
});

test("an answer to a plan's read that a newer one overtook moves nothing: the newer read's failure still says so with Try again", async () => {
  const first = pending();
  const second = pending();
  const reads = [first, second];
  startRead = (taskId) => (taskId === INVITES.id ? reads.shift()?.promise : undefined);
  const { page } = mount();
  await settle();
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
    ]),
  );
  await settle();
  second.settle(UNANSWERED_READ);
  await settle();
  first.settle({ items: [EXPIRY], cursor: "1" });
  await settle();
  const note = page.querySelector<HTMLElement>('.inbox-tasks [role="alert"]');
  assert.match(note?.textContent ?? "", /Some items could not be read\./u);
  assert.equal(
    listed(page).includes("*Expire after 7 days?"),
    false,
    "the overtaken read lists nothing",
  );
});

/** An agent with no task an automation started, and the question it asked. */
const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const QUARANTINE: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000009", "Quarantine the flaky test?", 6_000),
  agentId: SWEEP_AGENT,
};

test("an item of an agent with no plan stands under the automation that started it, and opens on its agent's own read under the automation's crumb", async () => {
  agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page, asked } = mount([
    {
      id: QUARANTINE.id,
      agentId: SWEEP_AGENT,
      title: QUARANTINE.title,
      postedAt: QUARANTINE.postedAt,
      agentTitle: "Sweep the flaky tests",
      agentModel: "anthropic/claude-opus-5.5",
      automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
      automationName: "Nightly flake sweep",
      repository: "acme/relay",
    },
  ]);
  await settle();

  assert.ok(agentReads.length > 0 && agentReads.every((agentId) => agentId === SWEEP_AGENT));
  const rows = listed(page);
  assert.ok(rows.includes("# Nightly flake sweep"), rows.join(" | "));
  assert.equal(rows[rows.indexOf("# Nightly flake sweep") + 1], "▸ *Quarantine the flaky test?");

  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();

  const crumbs = page.querySelector(".inbox-crumbs")?.textContent ?? "";
  assert.match(crumbs, /Nightly flake sweep/u);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Quarantine the flaky test?");
  assert.deepEqual(asked.shownTasks, [], "the automation's crumb opens no plan");
});

/** The automation that started the agent with no task, as its workspace's list reads it. */
const SWEEP: AutomationSummary = {
  id: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  planId: null,
  planName: null,
  workspaceId: "workspace-acme",
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

/** An agent with no task no automation the reader may read names, and its question. */
const STRAY_AGENT = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const BUMP: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000c", "Bump the Node image?", 1_500),
  agentId: STRAY_AGENT,
};

/** The header of a group in the list, by its name. */
function headerNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const header = [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .sidebar-repository-header button[aria-expanded]:not([aria-haspopup])",
    ),
  ].find((each) => heardName(each) === name);
  assert.ok(header, `no header for ${name}`);
  return header;
}

/** Hovers a control as a resting pointer does, and answers the words of the card it hangs, its discs left out. */
function hoveredCard(control: Element, card: string): string | null {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return wordsOf(document.querySelector(`.luke-tooltip-card ${card}`));
}

test("an automation's group wears its clock tile and hangs its card, as its crumb does, the card's name opening its page since the header's press folds; its agent's row wears the agent's tile and hangs a card naming the agent and the automation that started it; the agents no automation names stand under no actor", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  listedWorkspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  automations = [SWEEP];
  agentInboxes = new Map([
    [SWEEP_AGENT, [QUARANTINE]],
    [STRAY_AGENT, [BUMP]],
  ]);
  const { page, asked } = mount([
    { ...waitingTaskless(QUARANTINE), agentTitle: "Sweep the flaky tests" },
    { ...waitingTaskless(BUMP), automationId: null, automationName: null },
  ]);
  await settle();

  const sweep = headerNamed(page, "Nightly flake sweep");
  assert.ok(
    sweep.querySelector(':scope > [aria-hidden="true"] .actor-mark[data-kind="automation"]'),
    "the automation's group wears its clock tile",
  );
  assert.match(hoveredCard(sweep, '[data-actor-card="automation"]') ?? "", /Nightly flake sweep/u);
  assert.deepEqual(openings('[data-actor-card="automation"]'), [], "no Open automation");
  const name = document.querySelector<HTMLButtonElement>(
    '.luke-tooltip-card [data-actor-card="automation"] .luke-hover-card-name button',
  );
  assert.equal(name?.textContent, "Nightly flake sweep", "the card's name is a button");
  act(() => name?.click());
  assert.deepEqual(asked.shownAutomations, [SWEEP.id]);
  assert.equal(sweep.getAttribute("aria-expanded"), "true", "the header itself still only folds");

  const others = headerNamed(page, "Other agents");
  assert.ok(others.querySelector(".actor-mark") === null, "a group of agents names no actor");
  assert.ok(
    others.querySelector(':scope > [aria-hidden="true"] .lucide-factory'),
    "a group of agents wears the Factory's glyph, as the sidebar's row of every agent does",
  );

  const mark = rowNamed(page, "Quarantine the flaky test?").querySelector("[data-agent-ref]");
  assert.ok(mark, "the planless agent's row hangs its card");
  assert.ok(wearsAgentTile(mark), "the planless agent's row wears its tile");
  assert.match(
    hoveredCard(mark, "[data-tab-card]") ?? "",
    /Sweep the flaky tests.*Started by Nightly flake sweep/u,
  );

  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();
  const crumb = page.querySelector<HTMLButtonElement>('nav[aria-label="Path"] button');
  assert.ok(crumb, "the automation's crumb is drawn");
  assert.ok(crumb.querySelector(".lucide-clock"), "the automation's crumb wears its clock");
  assert.match(hoveredCard(crumb, '[data-actor-card="automation"]') ?? "", /Nightly flake sweep/u);
  assert.equal(
    document.querySelector('.luke-tooltip-card [data-actor-card="automation"] button')?.textContent,
    undefined,
    "the crumb's card offers nothing to press, since the crumb opens the automation",
  );
  act(() => crumb.click());
  assert.deepEqual(asked.shownAutomations, [SWEEP.id, SWEEP.id]);

  act(() => rowNamed(page, "Bump the Node image?").click());
  await settle();
  // Note that no automation stands behind its crumb, so the crumb is words, opening nothing.
  const stray = page.querySelector<HTMLElement>('nav[aria-label="Path"] li');
  assert.equal(stray?.textContent, "Other agents");
  assert.equal(stray?.querySelector("button"), null);
  assert.ok(
    stray?.querySelector(".lucide-clock") === null,
    "the crumb of the agents no automation names wears no automation's clock",
  );
  assert.ok(
    stray?.querySelector(".lucide-factory"),
    "it wears the Factory's glyph, as its group does",
  );
});

/** Another agent with no task the same automation started, whose two questions wait. */
const SECOND_AGENT = "6f708192-a3b4-4c5d-8e6f-708192a3b4c5";
const SECOND_ASK: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000a", "Skip the slow suite?", 2_000),
  agentId: SECOND_AGENT,
};
const THIRD_ASK: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000b", "Retry the flaky job?", 2_500),
  agentId: SECOND_AGENT,
};

/** One waiting item of an agent with no task, as main's read lists it. */
function waitingTaskless(asked: InboxItem): AppInboxTasklessItem {
  return {
    id: asked.id,
    agentId: asked.agentId,
    title: asked.title,
    postedAt: asked.postedAt,
    agentTitle: null,
    agentModel: "anthropic/claude-opus-5.5",
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
  };
}

test("an agent with no plan whose waiting items move, one answered on another Mac, is read again, the answered item no longer needing you", async () => {
  agentInboxes = new Map([
    [SWEEP_AGENT, [QUARANTINE]],
    [SECOND_AGENT, [SECOND_ASK, THIRD_ASK]],
  ]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();
  assert.ok(listed(page).includes("*Skip the slow suite?"));

  agentInboxes.set(SECOND_AGENT, [{ ...SECOND_ASK, status: INBOX_STATUS.ANSWERED }, THIRD_ASK]);
  act(() => setTaskless([QUARANTINE, THIRD_ASK].map(waitingTaskless)));
  await settle();

  assert.ok(listed(page).includes("Skip the slow suite?"), listed(page).join(" | "));
});

test("a read of an agent with no plan that fails is said with Retry, which reads it again though it was read before", async () => {
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();

  agentReadFails = true;
  act(() => setTaskless([QUARANTINE, THIRD_ASK].map(waitingTaskless)));
  await settle();
  assert.match(
    page.querySelector(".inbox-tasks")?.textContent ?? "",
    /Some items could not be read\./u,
  );
  const before = agentReads.filter((agentId) => agentId === SECOND_AGENT).length;

  agentReadFails = false;
  act(() =>
    [...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks button")]
      .find((button) => button.textContent === "Retry")
      ?.click(),
  );
  await settle();

  assert.ok(agentReads.filter((agentId) => agentId === SECOND_AGENT).length > before);
  assert.doesNotMatch(page.querySelector(".inbox-tasks")?.textContent ?? "", /could not be read/u);
});

test("an agent whose waiting items come back to what it was read for lets go of the read asked between, so its late answer draws nothing", async () => {
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();
  // The read asked for the items between is held, to land only after they came back.
  let landBetween: () => void = () => undefined;
  const answered = agentInboxes;
  agentInboxes = new Map([[SECOND_AGENT, []]]);
  holdAgentRead = (respond) => {
    landBetween = respond;
  };
  act(() => setTaskless([QUARANTINE, THIRD_ASK].map(waitingTaskless)));
  await settle();
  holdAgentRead = undefined;
  agentInboxes = answered;
  act(() => setTaskless([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless)));
  await settle();
  act(() => landBetween());
  await settle();

  assert.ok(listed(page).includes("*Skip the slow suite?"), listed(page).join(" | "));
});

test("an item chosen by a notification's click, in an Inbox showing its list alone, is shown itself, and Back stands on the list again, the notification's ask taken once", async () => {
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();
  layOut(page, 700);
  await settle();
  act(() => backToList(page).click());
  assert.equal(page.querySelector(".inbox-view")?.getAttribute("data-columns"), "list");

  act(() => chooseFromOutside({ agentId: SECOND_AGENT, itemId: SECOND_ASK.id, opened: true }));
  await settle();

  assert.equal(page.querySelector(".inbox-view")?.getAttribute("data-columns"), "item");
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Skip the slow suite?");

  act(() => backToList(page).click());
  await settle();
  assert.equal(
    page.querySelector(".inbox-view")?.getAttribute("data-columns"),
    "list",
    "Back stands on the list, the notification's ask taken once",
  );
});

test("an untitled agent an automation started goes by its automation's name in the Inbox, as on its own page", async () => {
  agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount([waitingTaskless(QUARANTINE)]);
  await settle();

  const mark = rowNamed(page, "Quarantine the flaky test?").querySelector("[data-agent-ref]");
  assert.ok(mark, "the planless agent's row hangs its card");
  assert.match(hoveredCard(mark, "[data-tab-card]") ?? "", /^Nightly flake sweep/u);
});

test("an item's row offers Copy link on a right-click, copying the item's link under the task that holds it", async () => {
  listedWorkspace = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const { page } = mount();
  await settle();
  act(() => {
    rowNamed(page, "Alert at 80%?").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the row's menu offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${BILLING.id}/inbox/${THRESHOLD.id}`]);
});

test("an item a link names that no read holds, of a task the reader cannot read, is not found in its pane, and no other item is chosen in its place", async () => {
  const { page } = mount();
  await settle();
  act(() =>
    chooseFromOutside({
      taskId: "0f0e0d0c-0000-4000-8000-00000000dead",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(
    page.querySelector(".inbox-view-items")?.textContent ?? "",
    /Not foundThis Inbox item doesn't exist, or you don't have access to it\./u,
  );
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to a settled item of an agent with no plan, none of whose items waits any more, lists the agent by its own read and shows the item", async () => {
  const settled = { ...BUMP, status: INBOX_STATUS.ANSWERED };
  agentInboxes = new Map([[STRAY_AGENT, [settled]]]);
  pageAgents = new Map([[STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }]]);
  const { page } = mount();
  await settle();
  act(() => chooseFromOutside({ agentId: STRAY_AGENT, itemId: BUMP.id, opened: true }));
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Bump the Node image?",
  );
});

test("an item a link names is not found though another task's read failed, and in a narrow Inbox the notice stands alone, not the list, with a way back to it", async () => {
  startRead = (taskId) =>
    taskId === BILLING.id
      ? Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
        })
      : undefined;
  const { page } = mount();
  await settle();
  layOut(page, 600);
  act(() =>
    chooseFromOutside({
      taskId: "0f0e0d0c-0000-4000-8000-00000000dead",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");

  assert.match(pane?.textContent ?? "", /Not found/u);
  assert.equal(pane?.hidden, false);
  const back = [...(pane?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Back to Inbox",
  );
  assert.ok(back, "the notice leads back to the list");
  act(() => back.click());
  assert.equal(page.querySelector<HTMLElement>(".inbox-view-items")?.hidden, true);
  assert.ok(
    document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".inbox-tasks") !== null,
    "the keyboard lands on the list, not the hidden notice",
  );
});

test("an item a link names under an agent that is not there, deleted or another's, is not found once its page's read says so, and no other item is chosen", async () => {
  const { page } = mount();
  await settle();
  act(() =>
    chooseFromOutside({
      agentId: "0f0e0d0c-0000-4000-8000-0000000a9e47",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("an item a link names under an agent with no task that its own read does not hold is not found, though the account's task list is not read yet", async () => {
  agentInboxes = new Map([[STRAY_AGENT, []]]);
  pageAgents = new Map([[STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }]]);
  const { page } = mount([], { listUnread: true });
  await settle();
  act(() =>
    chooseFromOutside({
      agentId: STRAY_AGENT,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
});

test("an item a link names under a task with no agent and nothing in its Inbox is not found, and no other task's item is chosen", async () => {
  const quiet = { ...INVITES, id: "0f0e0d0c-0000-4000-8000-00000000a11e", name: "Quiet task" };
  listedAgents = [];
  const { page } = mount();
  await settle();
  act(() => setTasks([BILLING, INVITES, quiet]));
  act(() =>
    chooseFromOutside({
      taskId: quiet.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("an item a link names that its task's Inbox read does not hold is not found, though the task's agents are still being read", async () => {
  agentListHeld = true;
  const { page } = mount();
  await settle();
  act(() =>
    chooseFromOutside({
      taskId: BILLING.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to an item newer than its task's last read waits for the read of it, saying no Not found, and then shows it", async () => {
  const { page } = mount();
  await settle();
  const posted = item("a1b2c3d4-0000-4000-8000-000000000005", "Page on-call too?", 7_000);
  let land: () => void = () => undefined;
  startRead = (taskId) =>
    taskId === INVITES.id
      ? new Promise((resolve) => {
          land = () =>
            resolve({
              status: ACT_OUTCOME_STATUS.DONE,
              value: { items: [EXPIRY, posted], cursor: "2" },
            });
        })
      : undefined;
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
      { taskId: INVITES.id, items: 2, updatedAt: 7_000 },
    ]),
  );
  act(() => chooseFromOutside({ taskId: INVITES.id, itemId: posted.id, opened: true }));
  await settle();
  const waiting = page.querySelector(".inbox-view-items")?.textContent ?? "";
  land();
  await settle();

  assert.doesNotMatch(waiting, /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Page on-call too?",
  );
});

test("an item a link names under a task whose own read fails is kept asked for, and no other task's item is chosen in its place", async () => {
  const quiet = { ...INVITES, id: "0f0e0d0c-0000-4000-8000-00000000a11f", name: "Quiet task" };
  startRead = (taskId) =>
    taskId === quiet.id
      ? Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
        })
      : undefined;
  const { page } = mount();
  await settle();
  act(() => setTasks([BILLING, INVITES, quiet]));
  act(() =>
    chooseFromOutside({
      taskId: quiet.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to an agent's item newer than the agent's last read waits for the read of it, saying no Not found, and then shows it", async () => {
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK]]]);
  pageAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
  const { page } = mount([SECOND_ASK].map(waitingTaskless));
  await settle();
  const held: (() => void)[] = [];
  holdAgentRead = (respond) => {
    held.push(respond);
  };
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  act(() => setTaskless([SECOND_ASK, THIRD_ASK].map(waitingTaskless)));
  act(() => chooseFromOutside({ agentId: SECOND_AGENT, itemId: THIRD_ASK.id, opened: true }));
  await settle();
  const waiting = page.querySelector(".inbox-view-items")?.textContent ?? "";
  holdAgentRead = undefined;
  for (const respond of held) respond();
  await settle();

  assert.doesNotMatch(waiting, /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Retry the flaky job?",
  );
});

test("an item a link names under an agent nothing waits on any more, read before, is not found by that read though the agent's own read fails", async () => {
  agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK]]]);
  pageAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
  const { page } = mount([SECOND_ASK].map(waitingTaskless));
  await settle();
  agentReadFails = true;
  act(() => setTaskless([]));
  act(() =>
    chooseFromOutside({
      agentId: SECOND_AGENT,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
});

/** A teammate of the reader's, who writes on a thread. */
const TEAMMATE = { userId: "user-teammate", name: "Charles Pan" };

/** One message on a thread, by `author`, its words and when. */
function threadMessage(
  id: string,
  author: { readonly member: typeof READER } | "agent",
  text: string,
  createdAt: number,
): InboxMessage {
  return author === "agent"
    ? { id, author: INBOX_MESSAGE_AUTHOR.AGENT, text, createdAt }
    : { id, author: INBOX_MESSAGE_AUTHOR.MEMBER, member: author.member, text, createdAt };
}

/** The shown item's thread as a reader meets it: each comment's kind, its writer's face, its writer by name, and a message's words. */
function threadOf(page: HTMLElement): (string | null | undefined)[][] {
  return [...itemPane(page).querySelectorAll<HTMLElement>(".inbox-thread > li")].map((entry) => [
    entry.dataset.inboxComment ?? (entry.dataset.inboxEarlier === undefined ? "?" : "earlier"),
    entry.querySelector<HTMLElement>(".inbox-comment-face .actor-mark")?.dataset.kind,
    wordsOf(entry.querySelector(".inbox-comment-name")),
    wordsOf(entry.querySelector("[data-inbox-message-text]")),
  ]);
}

/** Every message the pane sends, written down and answered by `answer`, the item as the service would hand it back by default. */
function heldMessages(
  answer: (params: CodingAgentInboxMessageParams) => CodingAgentInboxMessagedView,
): CodingAgentInboxMessageParams[] {
  const sent: CodingAgentInboxMessageParams[] = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return bridge.act(request);
      sent.push(request.payload);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: answer(request.payload) });
    },
  });
  return sent;
}

/** The message as the service answers it: written on the thread by the reader, the item otherwise as it stood. */
function writtenOn(item: InboxItem, id: string) {
  return (params: CodingAgentInboxMessageParams): CodingAgentInboxMessagedView => ({
    item: {
      ...item,
      updatedAt: 9_000,
      messages: [
        ...(item.messages ?? []),
        {
          ...threadMessage(id, { member: READER }, params.text, 9_000),
          ...(params.attachments === undefined
            ? undefined
            : {
                files: params.attachments.map((file, at) => ({
                  attachmentId: `a1b2c3d4-0000-4000-8000-0000000000${String(70 + at)}`,
                  name: file.name,
                  mediaType: file.mediaType,
                })),
              }),
        },
      ],
    },
  });
}

test("a thread draws its messages after the question in the order they were written, the answer among them: a teammate's by their face and name, the reader's own as You, and the agent's by its tile and name, their mentions as chips", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const threaded: InboxItem = {
    ...RETRY,
    updatedAt: 5_300,
    messages: [
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000001",
        { member: TEAMMATE },
        "Should it page at night too?",
        4_500,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000002",
        "agent",
        "Only in business hours.",
        5_100,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000003",
        { member: READER },
        `See ${file}`,
        5_200,
      ),
    ],
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  assert.deepEqual(threadOf(page), [
    ["asked", "agent", "Alerts", null],
    ["message", "person", "Charles Pan", "Should it page at night too?"],
    ["answered", "person", "You", null],
    ["message", "agent", "Alerts", "Only in business hours."],
    ["message", "person", "You", "See rollout-store.ts"],
  ]);
  const mine = itemPane(page).querySelectorAll('[data-inbox-comment="message"]')[2];
  assert.equal(mine?.querySelector("[data-mention-ref]")?.textContent, "rollout-store.ts");
});

/** Selects the words drawn in the item's pane as `words`, from `from` through `to`, as a drag lets them go. */
function selectInPane(page: HTMLElement, words: string, from: string, to: string): void {
  const walker = document.createTreeWalker(itemPane(page), NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
  assert.ok(text instanceof Text, `${words} is drawn`);
  const range = document.createRange();
  range.setStart(text, text.data.indexOf(from));
  range.setEnd(text, text.data.indexOf(to) + to.length);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  act(() => {
    text.parentElement?.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
}

/** Reply, where it stands over the window. */
function replyPress(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button")].find(
    (each) => each.textContent === "Reply",
  );
}

test("words selected in the agent's part of a thread stand Reply over them, which quotes them into the box: a settled item's message sends the quote set apart over the words typed under it, and a teammate's words offer no Reply", async () => {
  const threaded: InboxItem = {
    ...RETRY,
    updatedAt: 5_300,
    messages: [
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000041",
        { member: TEAMMATE },
        "Should it page at night too?",
        4_500,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000042",
        "agent",
        "Only in business hours. Nights wait for the morning.",
        5_100,
      ),
    ],
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = heldMessages(writtenOn(threaded, "c1b2c3d4-0000-4000-8000-000000000043"));
  const pane = itemPane(page);

  selectInPane(page, "Should it page", "Should", "too?");
  assert.equal(replyPress(), undefined, "a teammate's words are not the agent's");

  selectInPane(page, "Only in business hours.", "Only", "hours.");
  const reply = replyPress() ?? assert.fail("Reply stands over the agent's words");
  act(() => reply.click());
  await settle();
  assert.equal(replyPress(), undefined, "Reply goes once pressed");
  assert.equal(document.activeElement, composerEditor(pane), "the box takes the caret");
  typeInComposer(pane, "Page at night for a full outage.");
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text }) => text),
    ["> Only in business hours.\n\nPage at night for a full outage."],
  );
});

test("words selected in an open item's question quote into its box, its answer's note carries the quote, and Reply stands down while the answer is out", async () => {
  const asking: InboxItem = {
    ...THRESHOLD,
    blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Usage alerts fire at 80% of the plan's quota." }],
  };
  inboxes = new Map([
    [BILLING.id, [asking]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  const reply = replyPress() ?? assert.fail("Reply stands over the agent's question");
  act(() => reply.click());
  await settle();
  typeInComposer(pane, "Make it 90%.");
  pressInComposer(pane, "Enter");
  await settle();

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  assert.equal(replyPress(), undefined, "no quote is offered while the answer is out");
  assert.deepEqual(
    sent.map(({ itemId, note }) => ({ itemId, note })),
    [
      {
        itemId: THRESHOLD.id,
        note: "> Usage alerts fire at 80% of the plan's quota.\n\nMake it 90%.",
      },
    ],
  );
});

test("a message written on a settled item's thread from its box goes as a message, never an answer, and lands on the thread in place, scrolled into view, the item still answered and the box emptied", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const answers = heldAnswers();
  const sent = heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000010"));
  const pane = itemPane(page);
  const board =
    pane.querySelector<HTMLElement>(".inbox-board")?.parentElement ?? assert.fail("the thread");
  // The thread is taller than its board, so the new comment lands under its foot.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === board) return DOMRect.fromRect({ y: 0, height: 400 });
    if (this.matches("[data-message-id]")) return DOMRect.fromRect({ y: 900, height: 60 });
    return DOMRect.fromRect();
  });

  typeInComposer(pane, "Page on-call at night too.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ itemId, text, attachments }) => ({ itemId, text, attachments })),
    [{ itemId: RETRY.id, text: "Page on-call at night too.", attachments: undefined }],
  );
  assert.deepEqual(answers, [], "the item is not answered again");
  assert.deepEqual(threadOf(page).at(-1), [
    "message",
    "person",
    "You",
    "Page on-call at night too.",
  ]);
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?", "Answered", false]);
  assert.equal(composerEditor(pane).textContent, "", "the box lets its words go");
  assert.equal(board.scrollTop, 560, "the board scrolls its own new comment's foot into view");
});

test("a message refused says why under the box, which keeps its words, and leaves nothing on the thread", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(() => ({ failure: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED }));
  const pane = itemPane(page);

  typeInComposer(pane, "Page on-call at night too.");
  act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "This task is archived. Unarchive it first.",
  );
  assert.equal(pane.querySelector('[data-inbox-comment="message"]'), null);
  assert.equal(composerEditor(pane).textContent, "Page on-call at night too.");
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?", "Answered", false]);
});

test("files alone make a message: sent from a settled item's box with no words, and drawn on the thread as the files alone", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000020"));
  const pane = itemPane(page);
  const send = () =>
    pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ?? assert.fail("no Send");
  assert.equal(send().disabled, true, "an empty box sends nothing");

  await handFiles(page, [new File(["boom\n"], "trace.txt", { type: "text/plain" })], "pick");
  act(() => send().click());
  await settle();

  assert.deepEqual(
    sent.map(({ text, attachments }) => ({ text, attachments })),
    [
      {
        text: "",
        attachments: [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }],
      },
    ],
  );
  const message =
    pane.querySelector('[data-inbox-comment="message"]') ?? assert.fail("the message is drawn");
  assert.deepEqual(attachedNames(message), ["trace.txt"]);
  assert.equal(message.querySelector("[data-inbox-message-text]"), null, "no empty words");
});

test("an open item's box still answers it: its note goes as the answer and never as a message, and its thread's messages stand over it", async () => {
  const waiting: InboxItem = {
    ...THRESHOLD,
    messages: [
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000030",
        { member: TEAMMATE },
        "Is 80% too eager?",
        2_500,
      ),
    ],
  };
  inboxes = new Map([
    [BILLING.id, [waiting, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  const answers = heldAnswers();
  const messages = heldMessages(writtenOn(waiting, "c1b2c3d4-0000-4000-8000-000000000031"));
  const pane = itemPane(page);
  assert.deepEqual(threadOf(page), [
    ["asked", "agent", "Alerts", null],
    ["message", "person", "Charles Pan", "Is 80% too eager?"],
  ]);
  assert.equal(
    composerEditor(pane).getAttribute("aria-label"),
    "Add a note, or answer in your own words",
  );

  typeInComposer(pane, "Use 90%");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    answers.map(({ itemId, reply, note }) => ({ itemId, reply, note })),
    [{ itemId: THRESHOLD.id, reply: INBOX_REPLY.ANSWERED, note: "Use 90%" }],
  );
  assert.deepEqual(messages, []);
});

test("a thread read cut to its latest messages says the earlier ones are in the agent's tab, the agent's name opening it", async () => {
  const long: InboxItem = {
    ...RETRY,
    messages: Array.from({ length: INBOX_BOUNDS.MAX_MESSAGES_READ }, (_, at) =>
      threadMessage(
        `d1b2c3d4-0000-4000-8000-${String(at).padStart(12, "0")}`,
        { member: TEAMMATE },
        `Note ${String(at)}`,
        5_000 + at,
      ),
    ),
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, long]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page, asked } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const earlier =
    itemPane(page).querySelector<HTMLElement>("[data-inbox-earlier]") ??
    assert.fail("the cut is said");
  assert.equal(wordsOf(earlier), "Earlier messages are in Alerts’s tab");
  assert.equal(threadOf(page)[1]?.[0], "earlier", "the line stands before the messages");
  act(() => earlier.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

test("an answer left unsent on an item a teammate answers meanwhile is let go rather than becoming a message, and a message being written on a settled item outlasts the reads after it", async () => {
  let deliver: (outcome: ReadOutcome) => void = () => undefined;
  heldRead = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");
  typeInComposer(pane, "Use 90%");
  await settle();

  const answered: InboxItem = {
    ...THRESHOLD,
    status: INBOX_STATUS.ANSWERED,
    answeredBy: TEAMMATE,
    answer: { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] },
    settledAt: 3_500,
    updatedAt: 3_500,
  };
  act(() =>
    deliver({ status: ACT_OUTCOME_STATUS.DONE, value: { items: [answered, RETRY], cursor: "2" } }),
  );
  await settle();
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Message Alerts…");
  assert.equal(composerEditor(pane).textContent, "", "the unsent answer is not a message");

  typeInComposer(pane, "Thanks, Charles.");
  await settle();
  act(() =>
    deliver({ status: ACT_OUTCOME_STATUS.DONE, value: { items: [answered, RETRY], cursor: "3" } }),
  );
  await settle();
  assert.equal(composerEditor(pane).textContent, "Thanks, Charles.");
});

/** A row's two lines as a reader meets them: whether its first holds its title and its time, and the muted words of its second. */
function rowLines(page: HTMLElement, title: string): [boolean, string | null | undefined] {
  const row = rowNamed(page, title);
  const head = row.querySelector(".luke-list-row-head");
  const first =
    head?.querySelector(ROW_TITLE)?.textContent === title && head.querySelector("time") !== null;
  return [first, row.querySelector(".luke-list-row-description")?.textContent];
}

test("an item's row reads as two lines, its title and time over the last word in its thread: what an open item asks, an answer by who gave it, You for the reader, a teammate's latest message by their name, and why its agent took one back", async () => {
  const NIGHT: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000004", "Page on-call at night?", 2_000),
    response: { type: INBOX_RESPONSE.TODO },
    blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Add the **rota** to PagerDuty." }],
  };
  const SEV: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000005", "Which incidents page?", 1_500),
    startedBy: TEAMMATE,
    messages: [
      threadMessage("a1b2c3d4-0000-4000-8000-000000000051", "agent", "Asked on #oncall.", 1_200),
      threadMessage(
        "a1b2c3d4-0000-4000-8000-000000000052",
        { member: TEAMMATE },
        "Only **sev1**,\nnever sev2.",
        1_500,
      ),
    ],
  };
  inboxes.set(BILLING.id, [THRESHOLD, RETRY, NIGHT, SEV]);
  inboxes.set(INVITES.id, [
    { ...EXPIRY, status: INBOX_STATUS.CLOSED, closedReason: "The plan now says 7 days." },
  ]);
  const { page } = mount();
  await settle();
  assert.deepEqual(rowLines(page, "Alert at 80%?"), [true, "Choice · 2 options, one recommended"]);
  assert.deepEqual(rowLines(page, "How is a failed email retried?"), [
    true,
    "You: Retry 3 times over an hour · And page on-call if all three fail.",
  ]);
  assert.deepEqual(rowLines(page, "Page on-call at night?"), [
    true,
    "To-do · Add the rota to PagerDuty.",
  ]);
  assert.deepEqual(rowLines(page, "Which incidents page?"), [
    true,
    "Charles Pan: Only sev1, never sev2.",
  ]);
  assert.deepEqual(rowLines(page, "Expire after 7 days?"), [
    true,
    "Withdrawn: The plan now says 7 days.",
  ]);
});

test("the attention mark stands before the time on the reader's own open item alone: a teammate's open item wears their face there with no mark and no ring, saying to a reader that it waits on them, a settled one wears neither, and none is drawn in the unread weight", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  const { page } = mount();
  await settle();
  const ends = (title: string) => {
    const row = rowNamed(page, title);
    const meta = row.querySelector(".luke-list-row-meta");
    return {
      mark: meta?.querySelector(".attention-mark") !== null,
      face: meta?.querySelector<HTMLElement>(".actor-mark")?.dataset.kind,
      said: meta?.querySelector(".visually-hidden")?.textContent,
      dot: row.querySelector(".inbox-row-unread") !== null,
      unread: row.closest("li")?.dataset.unread === "true",
    };
  };
  assert.deepEqual(ends("Expire after 7 days?"), {
    mark: true,
    face: undefined,
    said: "Needs you",
    dot: false,
    unread: false,
  });
  assert.deepEqual(ends("Alert at 80%?"), {
    mark: false,
    face: "person",
    said: "Waiting on Charles Pan",
    dot: false,
    unread: false,
  });
  assert.deepEqual(ends("How is a failed email retried?"), {
    mark: false,
    face: undefined,
    said: undefined,
    dot: false,
    unread: false,
  });
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "Alert at 80%?",
    "# Invites",
    "▸ *Expire after 7 days?",
  ]);
});

test("a teammate's open item of an agent with no plan is listed under the automation that started it, wearing the teammate's face with no attention mark; Needs you leaves it out, and Group by person lists it under the teammate", async () => {
  agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, startedBy: TEAMMATE }]]]);
  const { page } = mount([{ ...waitingTaskless(QUARANTINE), startedBy: TEAMMATE.userId }]);
  await settle();
  const rows = listed(page);
  assert.equal(
    rows[rows.indexOf("# Nightly flake sweep") + 1],
    "Quarantine the flaky test?",
    rows.join(" | "),
  );
  const meta = rowNamed(page, "Quarantine the flaky test?").querySelector(".luke-list-row-meta");
  assert.equal(meta?.querySelector(".attention-mark"), null);
  assert.equal(meta?.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
  assert.equal(meta?.querySelector(".visually-hidden")?.textContent, "Waiting on Charles Pan");

  act(() => showTab(page, "Needs you").click());
  assert.equal(
    listed(page).includes("Quarantine the flaky test?"),
    false,
    listed(page).join(" | "),
  );

  act(() => showTab(page, "Everything").click());
  chooseView(page, "Group by", "Person");
  const byPerson = listed(page);
  assert.equal(
    byPerson[byPerson.indexOf("# Charles Pan") + 1],
    "Quarantine the flaky test?",
    byPerson.join(" | "),
  );
});

/** Whether a row reads as unread: its blue dot, its title in the unread weight, and "Unread" said to a reader, each `?` where only some stand. */
function unreadOf(page: HTMLElement, title: string): boolean | "?" {
  const row = rowNamed(page, title);
  const marks = [
    row.querySelector(".inbox-row-gutter .inbox-row-unread") !== null,
    row.closest("li")?.dataset.unread === "true",
    [...row.querySelectorAll(".luke-list-row-meta .visually-hidden")].some(
      (each) => each.textContent === "Unread",
    ),
  ];
  if (marks.every(Boolean)) return true;
  return marks.some(Boolean) ? "?" : false;
}

/** The mark a row's hover offers over its time. */
function hoverMark(page: HTMLElement, title: string): HTMLButtonElement {
  const li = rowNamed(page, title).closest("li");
  const press = li?.querySelector<HTMLButtonElement>(".luke-list-row-actions button");
  assert.ok(press, `${title}'s row offers a mark over its time`);
  return press;
}

/** A row's right-click menu as it reads: each item's words, its key where it names one, a rule between groups. */
function rowMenu(page: HTMLElement, title: string): string[] {
  act(() => {
    rowNamed(page, title).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  return menuWords();
}

/** The menu open now as it reads: each item's words, its key where it names one, and a rule between its groups. */
function menuWords(): string[] {
  const menu = [...document.querySelectorAll('[role="menu"]')].at(-1);
  assert.ok(menu, "a menu is open");
  return [...menu.querySelectorAll('[role^="menuitem"], .luke-menu-rule')].map((each) =>
    each.classList.contains("luke-menu-rule") ? "—" : (each.textContent ?? ""),
  );
}

/** The menu item whose words start with `label`, in the menu open now. */
function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
    each.textContent?.startsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

/** The workspace the marking tests list, whose Mark all as read names it. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

test("an unread item wears the blue dot in its row's gutter, its title in the unread weight, and says Unread to a reader; opening it marks it read at once, the item standing chosen first among them", async () => {
  inboxes.set(BILLING.id, [
    { ...THRESHOLD, unread: true },
    { ...RETRY, unread: true },
  ]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const { page } = mount();
  await settle();
  // The item standing chosen is shown, and so opened, as the Inbox opens.
  assert.deepEqual(readMarks, [`read:${THRESHOLD.id}`]);
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  assert.equal(unreadOf(page, "Expire after 7 days?"), true);
  assert.equal(unreadOf(page, "How is a failed email retried?"), true);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(readMarks, [`read:${THRESHOLD.id}`, `read:${EXPIRY.id}`]);
  assert.equal(unreadOf(page, "Expire after 7 days?"), false);
  assert.equal(unreadOf(page, "How is a failed email retried?"), true);
});

test("a row's mark over its time, the first item of its menu, and U each mark an item read or unread: Mark as unread on a read item, Mark as read on an unread one, U the chosen item, and the menu names U above Copy link", async () => {
  listedWorkspace = ACME;
  const keys = standKeymap();
  const { page } = mount();
  await settle();
  const retry = "How is a failed email retried?";
  assert.equal(hoverMark(page, retry).getAttribute("aria-label"), "Mark as unread");
  act(() => hoverMark(page, retry).click());
  await settle();
  assert.equal(unreadOf(page, retry), true);
  assert.equal(hoverMark(page, retry).getAttribute("aria-label"), "Mark as read");
  assert.equal(
    page.querySelector('[aria-current="page"] .luke-list-row-title')?.textContent,
    "Alert at 80%?",
    "a press on the mark opens nothing",
  );

  assert.deepEqual(rowMenu(page, retry), ["Mark as readU", "—", "Copy link"]);
  act(() => menuItem("Mark as read").click());
  await settle();
  assert.equal(unreadOf(page, retry), false);

  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true, "U marks the chosen item unread");
  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "and U again marks it read");
  assert.deepEqual(readMarks, [
    `unread:${RETRY.id}`,
    `read:${RETRY.id}`,
    `unread:${THRESHOLD.id}`,
    `read:${THRESHOLD.id}`,
  ]);
  act(() => keys.unmount());
});

test("an item marked unread while it is shown stays unread until it is opened again, as a mail app keeps it", async () => {
  const keys = standKeymap();
  const { page } = mount();
  await settle();
  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true, "leaving it leaves it unread");
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "opening it again reads it");
  assert.deepEqual(readMarks, [`unread:${THRESHOLD.id}`, `read:${THRESHOLD.id}`]);
  act(() => keys.unmount());
});

test("a mark the service refuses is let go, and the dot stands as the reads hold it", async () => {
  readMarkRefused = true;
  const { page } = mount();
  await settle();
  act(() => hoverMark(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(readMarks, [`unread:${RETRY.id}`]);
  assert.equal(unreadOf(page, "How is a failed email retried?"), false);
});

test("Mark all as read in the view's menu, under Group by, marks every unread item of the listed workspace read and clears the dots alone, the attention marks standing; with nothing unread it stands disabled", async () => {
  listedWorkspace = ACME;
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const { page } = mount();
  await settle();
  const openOptions = () => {
    const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
    assert.ok(options, "the head offers the view's menu");
    act(() => options.click());
    return menuWords();
  };
  assert.deepEqual(openOptions(), [
    "Group by",
    "Sort",
    "—",
    "Whose",
    "—",
    "Media previews",
    "—",
    "Mark all as read",
  ]);
  act(() => menuItem("Mark all as read").click());
  await settle();
  assert.deepEqual(readMarks, ["all:workspace-acme"]);
  assert.equal(unreadOf(page, "Expire after 7 days?"), false);
  assert.equal(unreadOf(page, "How is a failed email retried?"), false);
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
  openOptions();
  assert.equal(menuItem("Mark all as read").matches(":disabled"), true);
});

test("Mark all as read, once the service took it, reads every listed task and every agent with no task again, since the write moves nothing main hears of", async () => {
  listedWorkspace = ACME;
  const taskReads: string[] = [];
  startRead = (taskId) => {
    taskReads.push(taskId);
    return undefined;
  };
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, unread: true }]]]);
  const { page } = mount([waitingTaskless(QUARANTINE)]);
  await settle();
  const tasksBefore = taskReads.length;
  const agentsBefore = agentReads.length;
  const marksBefore = readMarks.length;
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  act(() => menuItem("Mark all as read").click());
  await settle();
  assert.deepEqual(readMarks.slice(marksBefore), ["all:workspace-acme"]);
  assert.deepEqual(
    [...new Set(taskReads.slice(tasksBefore))].toSorted(),
    [BILLING.id, INVITES.id].toSorted(),
  );
  assert.deepEqual(agentReads.slice(agentsBefore), [SWEEP_AGENT]);
});

test("a row swiped right marks its item: a long swipe marks an unread item read as it is let go, a short one leaves the row open on an Unread button for a read one, and neither opens the item", async () => {
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  const { page } = mount();
  await settle();
  readMarks = [];
  const retry = "How is a failed email retried?";
  const item = rowNamed(page, retry).closest("li") ?? assert.fail("the row's item");
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 300, height: 56 }),
  );
  Object.assign(item, { setPointerCapture: () => undefined });
  // Note that every event is stamped at one instant, since the swipe reads the hand's speed off the stamps and jsdom's come off the wall clock; never at 0, which React replaces with the wall clock's.
  const at = (type: string, x: number) =>
    Object.defineProperty(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10, pointerId: 1 }),
      "timeStamp",
      { value: 1 },
    );
  const swipe = (to: number) =>
    act(() => {
      const press = rowNamed(page, retry);
      press.dispatchEvent(at("pointerdown", 10));
      press.dispatchEvent(at("pointermove", 30));
      press.dispatchEvent(at("pointermove", 10 + to));
      press.dispatchEvent(at("pointerup", 10 + to));
      press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
  swipe(220);
  await settle();
  assert.deepEqual(readMarks, [`read:${RETRY.id}`]);
  assert.equal(unreadOf(page, retry), false);

  swipe(40);
  await settle();
  const button = item.querySelector<HTMLButtonElement>("button[data-swipe-act]");
  assert.equal(button?.textContent, "Unread");
  act(() => button?.click());
  await settle();
  assert.deepEqual(readMarks, [`read:${RETRY.id}`, `unread:${RETRY.id}`]);
  assert.equal(unreadOf(page, retry), true);
  assert.equal(
    page.querySelector('[aria-current="page"] .luke-list-row-title')?.textContent,
    "Alert at 80%?",
    "a swipe opens nothing",
  );
});

/** The answers the pane sent, and how the test answers the oldest still out, as the service would. */
interface GatedAnswers {
  readonly sent: CodingAgentInboxAnswerParams[];
  readonly answer: (view: CodingAgentInboxAnsweredView) => void;
}

/** Every answer the pane sends, held until the test answers it as the service would. */
function gatedAnswers(): GatedAnswers {
  const sent: CodingAgentInboxAnswerParams[] = [];
  const waiting: ((view: CodingAgentInboxAnsweredView) => void)[] = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return bridge.act(request);
      sent.push(request.payload);
      return new Promise((resolve) =>
        waiting.push((value) => resolve({ status: ACT_OUTCOME_STATUS.DONE, value })),
      );
    },
  });
  return { sent, answer: (view) => waiting.shift()?.(view) };
}

/** Threshold as the service answers it once the reader's note was taken. */
const THRESHOLD_ANSWERED: InboxItem = {
  ...THRESHOLD,
  status: INBOX_STATUS.ANSWERED,
  answer: { reply: INBOX_REPLY.ANSWERED, note: "Use 90%" },
  answeredBy: READER,
  settledAt: 6_000,
  updatedAt: 6_000,
};

/** Each plan's header as the list folds it: its name and what in it needs you. */
function foldedCounts(page: HTMLElement): (string | null)[] {
  const headers = () => [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .sidebar-repository-header button[aria-expanded]:not([aria-haspopup])",
    ),
  ];
  for (const header of headers()) {
    if (header.getAttribute("aria-expanded") === "true") act(() => header.click());
  }
  const counts = headers().map((header) => header.textContent);
  for (const header of headers()) act(() => header.click());
  return counts;
}

/** Sends a note from the open item's box as its answer. */
function answerWithNote(page: HTMLElement, note: string): void {
  const pane = itemPane(page);
  typeInComposer(pane, note);
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
}

test("an answer leaves Needs you the moment it is sent, its plan's count dropping with it, and no stale read brings it back: not its plan's own held read, nor the list's once another plan's item is chosen, nor main's word before it caught up", async () => {
  // The plan's first held read is the test's to land, and every one after it stays held.
  const held = pending();
  let asked = false;
  heldRead = (taskId) => {
    if (taskId !== BILLING.id || asked) return new Promise(() => undefined);
    asked = true;
    return held.promise;
  };
  const { page } = mount();
  await settle();
  const { sent, answer } = gatedAnswers();
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts1 needs you", "Invites1 needs you"]);

  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(sent.length, 1, "the answer is on its way, the service not answering yet");
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "▸ Alert at 80%?",
    "How is a failed email retried?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
  assert.deepEqual(subjectOf(page), ["Alert at 80%?", "Answered", false]);
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts", "Invites1 needs you"]);

  await act(async () => answer({ item: THRESHOLD_ANSWERED, taken: true }));
  await settle();
  // The plan's own held read lands as it stood before the answer, asked before it was taken.
  await act(async () => held.settle({ items: [THRESHOLD, RETRY], cursor: "2" }));
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");

  // The choice moves to another plan's item, so the answered one's plan is drawn from the list's read, which main has not moved yet.
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(
    needsYouMark(rowNamed(page, "Alert at 80%?")),
    "",
    "the stale read brings nothing back",
  );
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts", "Invites1 needs you"]);

  // Main catches up, and the list reads the plan again, holding the answer itself.
  inboxes.set(BILLING.id, [THRESHOLD_ANSWERED, RETRY]);
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 6_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");
  assert.equal(readTitle(page), "Expire after 7 days?", "the choice never jumps back");
});

test("an answer the service refuses brings its item back as it was, needing you, with its box's words and why it did not go", async () => {
  const { page } = mount();
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");

  await act(async () => answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
  await settle();
  const pane = itemPane(page);
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "*");
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts1 needs you", "Invites1 needs you"]);
  assert.equal(composerEditor(pane).textContent, "Use 90%", "the box keeps its words");
  assert.ok(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "the box says why the answer did not go",
  );
});

test("an answer the agent changed its item before stands no longer: the item comes back as the agent now asks it, and the box says so", async () => {
  const { page } = mount();
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();

  const asked = { ...THRESHOLD, revision: 2, title: "Alert at 85%?", updatedAt: 6_000 };
  await act(async () => answer({ item: asked, taken: false }));
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 85%?")), "*");
  assert.equal(
    itemPane(page).querySelector('.agent-composer [role="alert"]')?.textContent,
    "The agent changed this item before your answer landed. Answer it as it stands now.",
  );
});

test("an item its agent posts again after it was answered needs you again once a read holds the newer revision, though the list's older read still stands for it elsewhere", async () => {
  const { page } = mount();
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();
  await act(async () => answer({ item: THRESHOLD_ANSWERED, taken: true }));
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");

  // The agent asks again under the same key, and main says the plan moved.
  inboxes.set(BILLING.id, [{ ...THRESHOLD, revision: 2, updatedAt: 7_000 }, RETRY]);
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 7_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "*");
});

test("a message the service took stays the last word on its item's row once another plan's item is chosen, though the list's read of its plan is older than the message", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000011"));
  const pane = itemPane(page);
  typeInComposer(pane, "Page on-call at night too.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  const said = "You: Page on-call at night too.";
  assert.equal(rowLines(page, "How is a failed email retried?")[1], said);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(rowLines(page, "How is a failed email retried?")[1], said);
});

/** The workspace the Whose tests list, shared with Charles, and its members as read. */
const SHARED_WORKSPACE: Workspace = { ...ACME, memberCount: 2 };
const SHARED_MEMBERS: readonly WorkspaceMember[] = [
  { ...READER, email: "dana@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...TEAMMATE, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

/** The chip over the list saying whose items it holds, as a reader meets it: its words and its ×'s name; none where none stands. */
function whoseChip(page: HTMLElement): readonly (string | null | undefined)[] | null {
  const chip = page.querySelector(".inbox-tasks-chips .luke-chip");
  if (chip === null) return null;
  return [
    chip.querySelector(".luke-chip-name")?.textContent,
    chip.querySelector("button")?.getAttribute("aria-label"),
  ];
}

test("Whose in the view's menu lists one teammate's items, by their face and name, or the reader's own as Mine; a chip over the list says so, the tabs count only theirs, the choice outlives a relaunch, and the chip's × lists everyone's again", async () => {
  listedWorkspace = SHARED_WORKSPACE;
  members = SHARED_MEMBERS;
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  let { page } = mount();
  await settle();
  assert.equal(whoseChip(page), null, "everyone's items stand under no chip");
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  act(() => viewItem("Whose").click());
  assert.deepEqual(
    ["Everyone", "Mine", "Charles Pan"].map((each) => viewItem(each).getAttribute("aria-checked")),
    ["true", "false", "false"],
  );
  assert.ok(
    viewItem("Charles Pan").querySelector('.actor-mark[data-kind="person"]'),
    "a teammate is offered by their face",
  );
  act(() => viewItem("Charles Pan").click());
  await settle();
  assert.deepEqual(listed(page), ["# Billing usage alerts", "Alert at 80%?"]);
  assert.deepEqual(whoseChip(page), ["Charles Pan", "Show everyone's items"]);
  assert.deepEqual(showTabs(page), [
    "Needs you 0",
    "Unread 0",
    "All open 1",
    "[Everything 1]",
    "Archived 0",
  ]);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(whoseChip(page), ["Charles Pan", "Show everyone's items"]);

  chooseView(page, "Whose", "Mine");
  assert.deepEqual(whoseChip(page)?.[0], "Mine");
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "# Invites",
    "*Expire after 7 days?",
  ]);

  const clear = page.querySelector<HTMLButtonElement>(".inbox-tasks-chips .luke-chip button");
  assert.ok(clear, "the chip offers its ×");
  act(() => clear.click());
  assert.equal(whoseChip(page), null);
  assert.deepEqual(showTabs(page), [
    "Needs you 1",
    "Unread 0",
    "All open 2",
    "[Everything 3]",
    "Archived 0",
  ]);
});

test("a teammate chosen in Whose with nothing in the tab shown says so, and offers everyone's items again where no tab holds any of theirs", async () => {
  listedWorkspace = SHARED_WORKSPACE;
  members = SHARED_MEMBERS;
  const { page } = mount();
  await settle();
  chooseView(page, "Whose", "Charles Pan");
  assert.deepEqual(listed(page), []);
  assert.deepEqual(needsYouEmpty(page), [
    "Nothing here",
    "Nothing in the Inbox is theirs",
    "Show everyone's",
  ]);
  const everyone = page.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button");
  act(() => everyone?.click());
  assert.equal(whoseChip(page), null);
  assert.equal(listed(page).length, 5);
});

test("grouped by status, what needs you stands under the attention mark, then what waits on a teammate, then what is answered, each folding as a task's group does, a folded group counting what in it needs you and its rows passed over by K and J", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  const { page } = mount();
  await settle();
  chooseView(page, "Group by", "Status");
  assert.deepEqual(listed(page), [
    "# Needs you",
    "▸ *Expire after 7 days?",
    "# Waiting on others",
    "Alert at 80%?",
    "# Answered",
    "How is a failed email retried?",
  ]);
  const header = (name: string) =>
    [
      ...page.querySelectorAll<HTMLButtonElement>(
        ".inbox-tasks .sidebar-repository-header button[aria-expanded]:not([aria-haspopup])",
      ),
    ].find((each) => heardName(each) === name);
  assert.ok(
    header("Needs you")?.closest(".sidebar-repository-header")?.querySelector(".attention-mark"),
    "Needs you's group wears the attention mark",
  );
  act(() => header("Waiting on others")?.click());
  act(() => header("Needs you")?.click());
  assert.deepEqual(listed(page), [
    "# Needs you",
    "# Waiting on others",
    "# Answered",
    "How is a failed email retried?",
  ]);
  assert.equal(header("Needs you")?.textContent, "Needs you1 needs you");
  const keys = standKeymap();
  pressKey("j");
  assert.equal(readTitle(page), "How is a failed email retried?", "J passes over the folded rows");
  act(() => keys.unmount());
});

test("sorted by waiting longest from the view's menu, the open items stand first, the one posted longest ago first, the answered ones after them, and the choice outlives a relaunch", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, postedAt: 500 }, RETRY]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, postedAt: 900 }]);
  let { page } = mount();
  await settle();
  chooseView(page, "Group by", "None");
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);
  chooseView(page, "Sort", "Waiting longest");
  assert.deepEqual(listed(page), [
    "▸ *Alert at 80%?",
    "*Expire after 7 days?",
    "How is a failed email retried?",
  ]);
  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(listed(page), [
    "▸ *Alert at 80%?",
    "*Expire after 7 days?",
    "How is a failed email retried?",
  ]);
});

test("an item marked read as it opened stays read once another plan's item is chosen, though the list's read of its plan, which a mark never moves, still holds it unread", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  // The plan's held read wakes on the mark, as the service wakes it, holding the item read.
  const held = pending();
  let asked = false;
  heldRead = (taskId) => {
    if (taskId !== BILLING.id || asked) return new Promise(() => undefined);
    asked = true;
    return held.promise;
  };
  const { page } = mount();
  await settle();
  assert.deepEqual(readMarks, [`read:${THRESHOLD.id}`]);
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  await act(async () =>
    held.settle({ items: [{ ...THRESHOLD, unread: false }, RETRY], cursor: "2" }),
  );
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "the list's older read brings no dot back");
});

test("a mark another window makes later on the same item stands once the plan's held read holds it, over the window's own earlier mark", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  // The plan's held reads land as the test says: its own mark heard, then another window's.
  const reads: PendingRead[] = [pending(), pending()];
  heldRead = (taskId) =>
    taskId === BILLING.id
      ? (reads.shift()?.promise ?? new Promise(() => undefined))
      : new Promise(() => undefined);
  const [own, other] = reads;
  assert.ok(own !== undefined && other !== undefined);
  const { page } = mount();
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  await act(async () =>
    own.settle({ items: [{ ...THRESHOLD, unread: false }, RETRY], cursor: "2" }),
  );
  await settle();
  await act(async () =>
    other.settle({ items: [{ ...THRESHOLD, unread: true }, RETRY], cursor: "3" }),
  );
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
});
