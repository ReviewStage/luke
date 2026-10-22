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
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { inboxAttachmentAddress } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAsk,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  inboxReadAskSchema,
  inboxReadResponseSchema,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import { TASK_STATUS, TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { DocumentIcon } from "@luke/ui";
import type { TaskMark } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Effect, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, onTestFinished, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand, useAppKeymap } from "../app-commands.js";
import { DRAFT_WORD } from "../draft-mark.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeActPortCalls,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import {
  copyingInto,
  DESKTOP_LINKS,
  fakeAppPlatform,
  QUIET_PANEL,
} from "../testing/app-platform.js";
import { handState, stateWith } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { readSegmented, segment, segmentedGroup } from "../testing/segmented.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { DesktopInbox } from "./desktop-inbox.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { SidebarInbox } from "./sidebar-inbox.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Where the window's Inbox keeps the scope it shows, and where its Needs you button kept its press before the tabs that stood before its scopes. */
const SHOW_KEY = "luke.inboxShow";
const EARLIER_SHOW_KEY = "luke.inboxWaitingOnly";

/** Where the window's Inbox keeps how it sorts, and how it groups. */
const SORT_KEY = "luke.inboxSort";
const GROUPING_KEY = "luke.inboxGrouping";

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
/** Each agent with no task's own pages as a read of them answers, none for an agent the reader cannot reach. */
let agentPages = new Map<string, readonly PageLine[]>();
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
/** Leaves the Inbox for another place and comes back to it, as the window's sidebar does. */
let setInboxOpen: (open: boolean) => void = () => undefined;
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
  readonly status: typeof FAKE_ANSWER.DONE;
  readonly value: CodingAgentInboxAnswerView;
}

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
/** Main's follows for the window, each followed inbox pushed as the knobs above say. */
let main = followedInboxes(() => undefined);

/** A read's answer as main pushes it: the items, or why there are none. */
function pushedOf(answer: CodingAgentInboxAnswerView) {
  return "failure" in answer ? { failure: answer.failure } : { items: answer.items };
}

/** A task's inbox as main pushes it now: as `startRead` settles it, where it holds one, or as `inboxes` holds it. */
function answerTask(taskId: string) {
  const held = startRead?.(taskId);
  if (held === undefined) return { items: inboxes.get(taskId) ?? [] };
  void held.then((outcome) =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: taskId }, pushedOf(outcome.value)),
  );
  return undefined;
}

/** An agent's inbox as main pushes it now, the push counted: refused, held in the test's hands, or as `agentInboxes` holds it. */
function answerAgent(agentId: string) {
  agentReads.push(agentId);
  if (agentReadFails) return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
  const items = agentInboxes.get(agentId) ?? [];
  const hold = holdAgentRead;
  if (hold === undefined) return { items };
  hold(() => main.push({ kind: INBOX_SCOPE_KIND.AGENT, id: agentId }, { items }));
  return undefined;
}

/** Every followed inbox pushed again as it now stands, as main pushes a change. */
function pushAgain(): void {
  for (const taskId of [...inboxes.keys(), BILLING.id, INVITES.id]) {
    const scope = { kind: INBOX_SCOPE_KIND.PLAN, id: taskId };
    if (!main.isFollowed(scope)) continue;
    const inbox = answerTask(taskId);
    if (inbox !== undefined) main.push(scope, inbox);
  }
  for (const agentId of agentInboxes.keys()) {
    const scope = { kind: INBOX_SCOPE_KIND.AGENT, id: agentId };
    if (!main.isFollowed(scope)) continue;
    const inbox = answerAgent(agentId);
    if (inbox !== undefined) main.push(scope, inbox);
  }
}

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
  // Note that the Inbox opens on All here, so the tests of what an item shows meet settled
  // items too; the tests of the scopes clear it to meet the Inbox as a fresh profile opens it.
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("all"));
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  startRead = undefined;
  taskPages = new Map([[BILLING.id, [FUNNEL]]]);
  agentPages = new Map();
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
  main = followedInboxes((scope) =>
    scope.kind === INBOX_SCOPE_KIND.PLAN ? answerTask(scope.id) : answerAgent(scope.id),
  );
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { automations } });
      }
      if (request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: [] });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: members });
      }
      const done = (value: CodingAgentListAnswer) =>
        Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
        return agentListHeld ? new Promise(() => undefined) : done({ agents: listedAgents });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        const agent = pageAgents.get(request.payload.agentId);
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
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
          status: FAKE_ANSWER.DONE,
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
      if (request.kind === ACT_KIND.TASKS_PAGES) {
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: {
            pages:
              "taskId" in request.payload
                ? (taskPages.get(request.payload.taskId) ?? [])
                : (agentPages.get(request.payload.agentId) ?? []),
          },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_STATE) {
        const { itemId, unread } = request.payload;
        readMarks.push(`${unread ? "unread" : "read"}:${itemId}`);
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: readMarkRefused
            ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
            : { id: itemId, unread },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_ALL) {
        readMarks.push(`all:${request.payload.workspaceId ?? "every workspace"}`);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { marked: 2 } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) {
        return new Promise((resolve) =>
          imageReads.push(() =>
            resolve({
              status: FAKE_ANSWER.DONE,
              value: { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
            }),
          ),
        );
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  fakeActPort({ ...fakeActPortCalls(), ...main.procedures });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  /** How many times it was asked for New task. */
  newTasks: number;
}

/** The Inbox over the two tasks, and the items of agents with no task given, its own view real, as the tasks tab holds it, and every press that leaves it recorded; or, `listUnread`, opened before the account's task list is first read; or over the tasks given; or, `room`, under the side panel itself in that room, as the tasks tab holds it while the Inbox has chosen nothing. */
function mount(
  firstTaskless: readonly AppInboxTasklessItem[] = [],
  {
    listUnread = false,
    standing = [BILLING, INVITES],
    room,
    sidebar = false,
    panel,
    holding: firstHolding = HOLDING,
    withSidebar = false,
  }: {
    listUnread?: boolean;
    standing?: readonly TaskSummary[];
    room?: ShellRoom;
    /** Whether the inbox-first sidebar lists the Inbox, read once for it and the page, which then shows the chosen item alone. */
    sidebar?: boolean;
    /** The side panel the Inbox opens what its item names in, where the test records what it opened. */
    panel?: SidePanelControl;
    /** Main's first word of the tasks holding items. */
    holding?: readonly AppInboxTaskHolding[];
    /** Whether the window's sidebar stands beside the Inbox page, its Inbox row counting. */
    withSidebar?: boolean;
  } = {},
) {
  // Note that the host's inbox streams are answered beside whatever acts the test answers by now.
  fakeActPort({ ...fakeActPortCalls(), ...main.procedures });
  const asked: Asked = {
    shownTasks: [],
    shownAgents: [],
    shownAutomations: [],
    closed: 0,
    marks: [],
    newTasks: 0,
  };
  function Page({ sidePanel }: { sidePanel?: SidePanelControl | undefined }) {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    // Whether the list was asked for, which the window keeps as the Tasks tab does.
    const [listAsked, setListAsked] = useState(false);
    const [inboxOpen, setOpen] = useState(true);
    setInboxOpen = setOpen;
    chooseFromOutside = setChosen;
    const [holding, setHeld] = useState(firstHolding);
    const [listed, setListed] = useState<readonly TaskSummary[]>(listUnread ? [] : standing);
    const [listRead, setRead] = useState(!listUnread);
    setListRead = setRead;
    // Note that main's word of a change comes with the change pushed, as the host follows both.
    setHolding = (next) => {
      setHeld(next);
      pushAgain();
    };
    const [taskless, setWaiting] = useState(firstTaskless);
    setTaskless = (next) => {
      setWaiting(next);
      pushAgain();
    };
    setTasks = setListed;
    const control = tasksControl({
      me: READER.userId,
      workspace: listedWorkspace,
      tasks: listed,
      listRead,
      sidePanel: sidePanel ?? tasksControl().sidePanel,
      inbox: [
        { taskId: BILLING.id, items: [waitingOf(THRESHOLD)] },
        { taskId: INVITES.id, items: [waitingOf(EXPIRY)] },
      ],
      inboxTasks: holding,
      inboxTaskless: taskless,
      inboxView: {
        open: inboxOpen,
        chosen,
        onOpen: () => undefined,
        onClose: () => {
          asked.closed += 1;
        },
        onChoose: setChosen,
        onOpenItem: setChosen,
        listed: listAsked,
        onListed: setListAsked,
        onSingle: (single: boolean) => {
          toldSingle.push(single);
        },
        pages: undefined,
        onTaskAgents: () => undefined,
      },
      onShowTask: (taskId) => asked.shownTasks.push(taskId),
      onMarkTask: (taskId, mark) => asked.marks.push([taskId, mark]),
      onNewTask: () => {
        asked.newTasks += 1;
      },
      onShowAgent: (taskId, agentId) => asked.shownAgents.push([taskId, agentId]),
      automationsView: {
        ...tasksControl().automationsView,
        onOpen: (place) => {
          if (place?.kind === AUTOMATIONS_PAGE.EDIT)
            asked.shownAutomations.push(place.automationId);
        },
        onClose: () => undefined,
      },
    });
    if (sidebar) return createElement(SharedListing, { tasks: control });
    const inbox = createElement(DesktopInbox, { tasks: control });
    return withSidebar
      ? createElement(Fragment, null, createElement(DesktopSidebar, sidebarProps(control)), inbox)
      : inbox;
  }
  function Panelled({ at }: { at: ShellRoom }) {
    const sidePanel = useSidePanel(
      undefined,
      { id: undefined, holds: {}, bare: true },
      [],
      [],
      [],
      [],
      [],
      at,
    );
    return createElement(Page, { sidePanel });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const page =
    room === undefined
      ? createElement(Page, { sidePanel: panel })
      : createElement(Panelled, { at: room });
  act(() => root?.render(onRegistry(AtomRegistry.make(), page)));
  return { page: container, asked };
}

/** What the Inbox told the window of whether it shows one column, in order. */
let toldSingle: boolean[] = [];

/** The Inbox as the inbox-first shell draws it: read once, listed in the sidebar, and its chosen item alone in the plan's place. */
function SharedListing({ tasks }: { tasks: TasksControl }) {
  const listing = useInboxListing(tasks);
  return createElement(
    Fragment,
    null,
    createElement(
      "aside",
      { className: "desktop-sidebar" },
      createElement(SidebarInbox, {
        tasks,
        listing,
        shown: true,
        onOpen: tasks.inboxView.onOpenItem,
      }),
    ),
    createElement("main", null, createElement(DesktopInbox, { tasks, listing })),
  );
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
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

/** What the row of the item so titled says of its task's status; none where it wears no status. */
function rowStatus(page: HTMLElement, title: string): string | undefined {
  return (
    rowNamed(page, title).closest("li")?.querySelector(".inbox-row-task-status")?.textContent ??
    undefined
  );
}

/** Whether the row of the item so titled is drawn gray, its item done with. */
function rowMuted(page: HTMLElement, title: string): boolean {
  return rowNamed(page, title).closest("li")?.getAttribute("data-muted") === "true";
}

function rowNamed(page: HTMLElement, title: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main"),
  ].find((each) => each.querySelector(ROW_TITLE)?.textContent === title);
  assert.ok(row, `no row for ${title}`);
  return row;
}

/** Opens the list's View options. */
function openViewOptions(page: HTMLElement): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
}

/** The scopes the view's menu may offer, in their order, and Archived, which it offered while tasks were archived, so a menu offering it again is heard. */
const SCOPE_NAMES = ["To do", "All", "Archived"] as const;

/** The Inbox's name as the list's head says it. */
function headTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-tasks .desktop-toolbar-title")?.textContent;
}

/** Shows the scope `name` from the list's View options. */
function showScope(page: HTMLElement, name: (typeof SCOPE_NAMES)[number]): void {
  openViewOptions(page);
  act(() => viewItem(name).click());
}

/**
 * The list's head as a reader meets it: the Inbox's name, then each scope
 * its View options offers, the one shown in brackets; the menu is closed
 * again on the scope shown.
 */
function scopes(page: HTMLElement): string[] {
  openViewOptions(page);
  const offered = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].filter(
    (each) => SCOPE_NAMES.some((name) => each.textContent === name),
  );
  const shown = offered.find((each) => each.getAttribute("aria-checked") === "true");
  const words = offered.map((each) =>
    each === shown ? `[${each.textContent}]` : (each.textContent ?? ""),
  );
  act(() => shown?.click());
  return [headTitle(page) ?? "", ...words];
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

test("Second line in the view's menu, checked at first, makes every row one line once unchecked, its title alone, and the choice outlives a relaunch", async () => {
  let { page } = mount();
  await settle();
  const described = (title: string) =>
    rowNamed(page, title).querySelector(".luke-list-row-description") !== null;
  assert.ok(described("Alert at 80%?"), "a row has its second line at first");
  const toggle = () => {
    const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
    act(() => options?.click());
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    ].find((each) => each.textContent?.includes("Second line"));
    assert.ok(item, "the view's menu offers Second line");
    const checked = item.getAttribute("aria-checked");
    act(() => item.click());
    return checked;
  };
  assert.equal(toggle(), "true");
  await settle();
  assert.equal(described("Alert at 80%?"), false, "unchecked, the row is one line");
  assert.equal(described("Expire after 7 days?"), false);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(described("Alert at 80%?"), false, "the choice outlives a relaunch");
});

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

/** The shown settled item's question filled in as answered, its controls standing read-only. */
function answeredControls(page: HTMLElement): HTMLElement {
  return (
    page.querySelector<HTMLElement>(".inbox-view-items:not([hidden]) [data-inbox-answered]") ??
    assert.fail("the question stands filled in as answered")
  );
}

/** Each option of the shown settled item's question, by its label, and whether the answer picked it. */
function answeredOptions(page: HTMLElement): [string | null | undefined, boolean][] {
  return [
    ...answeredControls(page).querySelectorAll<HTMLButtonElement>(
      '[role="radio"], [role="checkbox"]',
    ),
  ].map((option) => [
    option.querySelector(".luke-choice-label")?.textContent,
    option.getAttribute("aria-checked") === "true",
  ]);
}

/** The picks the shown item's answer carries, as its question draws them checked. */
function answeredPicks(page: HTMLElement): (string | null | undefined)[] {
  return answeredOptions(page)
    .filter(([, picked]) => picked)
    .map(([label]) => label);
}

test("a settled choice's answer is the developer's comment, under a line saying who, when, and that it reached the agent: the question's options in the look they were offered in, read-only, the pick checked and the rest not, then their note, with no chip repeating the pick", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  assert.equal(pane.querySelector("[data-inbox-offered]"), null, "nothing is folded away");
  assert.ok(
    answeredControls(page).closest('[data-inbox-comment="answered"]'),
    "the options lead the answer's comment",
  );
  assert.equal(pane.querySelector('[data-inbox-comment="asked"] [role="radio"]'), null);
  assert.deepEqual(answeredOptions(page), [
    ["Retry 3 times over an hour", true],
    ["Retry once", false],
  ]);
  const list =
    answeredControls(page).querySelector<HTMLElement>(".luke-choice-list") ??
    assert.fail("the options stand as the list they were");
  assert.equal(list.dataset.look, "marked", "each row still leads with its radio");
  assert.equal(list.dataset.readOnly, "true", "the list records the answer at full strength");
  assert.equal(list.getAttribute("aria-readonly"), "true");
  assert.ok(
    [...list.querySelectorAll("button")].every((row) => row.disabled),
    "no row takes a press",
  );
  assert.equal(list.querySelector(".luke-choice-number"), null, "no number picks a settled row");
  assert.deepEqual(
    [...list.querySelectorAll<HTMLElement>(".luke-badge")].map((badge) => [
      badge.textContent,
      badge.dataset.tone,
    ]),
    [["Recommended", "neutral"]],
    "the badge is history now, not a call to act",
  );
  const firstRow = list.querySelector("button");
  act(() => firstRow?.click());
  act(() => list.querySelectorAll("button")[1]?.click());
  assert.deepEqual(answeredPicks(page), ["Retry 3 times over an hour"], "a press changes nothing");
  assert.equal(
    pane.querySelector(".composer-editor")?.getAttribute("aria-label"),
    "Reply",
    "a settled item takes no answer, only a reply on its thread",
  );
  const reply = pane.querySelector<HTMLElement>('[data-inbox-comment="answered"]');
  assert.ok(reply, "the developer's answer is their own comment");
  assert.equal(reply.querySelector("[data-inbox-pick]"), null, "no chip repeats the pick");
  assert.equal(reply.querySelector("p")?.textContent, "And page on-call if all three fail.");
  assert.match(answerHead(page) ?? "", /^You.+ · Sent to Alerts$/u);
  assert.equal(
    reply.querySelector<HTMLElement>(".inbox-comment-head [data-actor-ref] .actor-mark")?.dataset
      .kind,
    "person",
    "the answerer's face leads their comment",
  );
  assert.ok(
    reply.querySelector("[data-actor-ref][data-kind='person']"),
    "the answerer by their name",
  );
});

/** A waiting item's options as a reader meets them: each row's words, its label, its Recommended badge where it wears one, and its detail. */
function optionHeads(page: HTMLElement): (string | null)[] {
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  return [...pane.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')].map((each) =>
    wordsOf(each),
  );
}

/** The shown item's subject as a reader meets it: everything under the thread's subject, which is its title alone. */
function subjectOf(page: HTMLElement): string[] {
  const subject =
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-subject") ??
    assert.fail("the thread leads with its subject");
  return [...subject.children].map((child) => child.textContent ?? "");
}

test("a thread leads with its item's title alone as its subject, whether the item waits, is answered, or was taken back by its agent, whose comment says why and whose options stay folded", async () => {
  const WITHDRAWN: InboxItem = {
    ...EXPIRY,
    status: INBOX_STATUS.CLOSED,
    closedReason: "The plan now says 7 days.",
  };
  inboxes.set(INVITES.id, [WITHDRAWN]);
  const { page } = mount();
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
  const fold = () =>
    page.querySelector<HTMLDetailsElement>(
      ".inbox-view-items:not([hidden]) details[data-inbox-offered]",
    );
  assert.equal(fold(), null, "an answered item's options stand filled in, not folded");
  assert.deepEqual(answeredPicks(page), ["Retry 3 times over an hour"]);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?"]);
  const withdrawnFold = fold() ?? assert.fail("what a withdrawn item offered is folded");
  assert.equal(withdrawnFold.open, false, "the fold stands closed");
  assert.equal(withdrawnFold.querySelector("summary")?.textContent, "2 options offered");
  const withdrawn =
    page.querySelector('[data-inbox-comment="withdrawn"]') ??
    assert.fail("the agent's taking it back is a comment");
  assert.match(
    wordsOf(withdrawn.querySelector(".inbox-comment-head")) ?? "",
    /^Alertswithdrew this /u,
  );
  assert.equal(withdrawn.querySelector("p")?.textContent, "The plan now says 7 days.");
});

/** Every close the Inbox sends, answered as the service takes it: the item closed by the reader. */
function takenCloses(): { itemId: string; revision: number }[] {
  const sent: { itemId: string; revision: number }[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_CLOSE) return previous(request);
      sent.push({ itemId: request.payload.itemId, revision: request.payload.revision });
      const asked = [...inboxes.values()].flat().find((each) => each.id === request.payload.itemId);
      const closed: InboxItem = {
        ...(asked ?? THRESHOLD),
        status: INBOX_STATUS.CLOSED,
        closedBy: READER,
        settledAt: 6_000,
        updatedAt: 6_000,
      };
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { item: closed, taken: true },
      });
    },
  });
  return sent;
}

/** The question Resolve asks, answered Resolve. */
async function confirmClose(): Promise<void> {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Resolve asks first");
  assert.equal(document.activeElement?.textContent, "Cancel", "Cancel takes the keyboard");
  const resolve = [...question.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Resolve",
  );
  await act(async () => (resolve ?? assert.fail("the question offers Resolve")).click());
  await settle();
}

test("an open item's ⋯ menu in the pane's bar offers Mark as read or unread, Copy link, and Resolve without answering, which asks first and then settles it at the revision drawn, the thread saying who closed it and that the agent was told; a settled item's menu offers Copy link alone", async () => {
  listedWorkspace = ACME;
  onlyAsking({ type: INBOX_RESPONSE.APPROVAL }, { needsReply: true });
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  const ellipsis = () =>
    itemPane(page).querySelector<HTMLButtonElement>(
      '.desktop-toolbar button[aria-label="Item actions"]',
    ) ?? assert.fail("the pane's bar ends in its ⋯ menu");

  act(() => ellipsis().click());
  assert.deepEqual(menuWords(), [
    "Mark as unreadU",
    "—",
    "Copy link",
    "—",
    "Resolve without answering",
  ]);
  act(() => menuItem("Mark as unread").click());
  await settle();
  assert.ok(readMarks.includes(`unread:${THRESHOLD.id}`), "the menu marks the item unread");
  act(() => ellipsis().click());
  act(() => menuItem("Resolve without answering").click());
  await settle();
  assert.deepEqual(sent, [], "Close asks first");
  await confirmClose();

  assert.deepEqual(sent, [{ itemId: THRESHOLD.id, revision: THRESHOLD.revision }]);
  const closed =
    itemPane(page).querySelector('[data-inbox-comment="closed"]') ??
    assert.fail("the close is a comment of the closer's");
  assert.match(wordsOf(closed.querySelector(".inbox-comment-head")) ?? "", /Sent to/u);
  assert.equal(
    closed.querySelector("[data-inbox-pick]")?.textContent,
    "Resolved without an answer",
  );
  act(() => ellipsis().click());
  assert.deepEqual(
    menuWords(),
    ["Mark as unreadU", "—", "Copy link"],
    "a settled item offers no Close",
  );
});

test("an open item's row offers Resolve without answering beside its mark and last in its right-click menu, each asking first; a settled item's row offers neither", async () => {
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  const threshold = "Alert at 80%?";
  const retry = "How is a failed email retried?";
  const hoverClose = (title: string) =>
    rowNamed(page, title)
      .closest("li")
      ?.querySelector<HTMLButtonElement>(
        '.luke-list-row-actions button[aria-label="Resolve without answering"]',
      );

  assert.equal(hoverClose(retry), null, "a settled row offers no Close");
  assert.ok(!rowMenu(page, retry).includes("Resolve without answering"));
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );

  assert.deepEqual(rowMenu(page, threshold).slice(-2), ["—", "Resolve without answering"]);
  act(() => menuItem("Resolve without answering").click());
  await settle();
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Close asks first");
  const cancel = [...question.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Cancel",
  );
  act(() => cancel?.click());
  await settle();
  assert.deepEqual(sent, [], "Cancel closes nothing");

  act(() => (hoverClose(threshold) ?? assert.fail("an open row offers Close")).click());
  await settle();
  await confirmClose();
  assert.deepEqual(sent, [{ itemId: THRESHOLD.id, revision: THRESHOLD.revision }]);
  assert.equal(hoverClose(threshold), null, "the closed row offers Close no longer");
});

/** The act channel answering every close as `answer` does, written down by item. */
function answeredCloses(answer: (itemId: string) => { item: InboxItem; taken: boolean }): string[] {
  const sent: string[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_CLOSE) return previous(request);
      sent.push(request.payload.itemId);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: answer(request.payload.itemId),
      });
    },
  });
  return sent;
}

/** Closes the item from its pane's ⋯ menu, answering the question Close. */
async function closeFromPane(page: HTMLElement): Promise<void> {
  const ellipsis =
    itemPane(page).querySelector<HTMLButtonElement>(
      '.desktop-toolbar button[aria-label="Item actions"]',
    ) ?? assert.fail("the pane's bar ends in its ⋯ menu");
  act(() => ellipsis.click());
  act(() => menuItem("Resolve without answering").click());
  await settle();
  await confirmClose();
}

test("a close taken lets go of the item's draft, though another item is chosen", async () => {
  const { page } = mount();
  await settle();
  typeInComposer(itemPane(page), "Use 90% instead");
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(rowDrafted(page, "Alert at 80%?"), true);
  takenCloses();

  act(() =>
    rowNamed(page, "Alert at 80%?").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  act(() => menuItem("Resolve without answering").click());
  await settle();
  await confirmClose();

  assert.equal(rowDrafted(page, "Alert at 80%?"), false, "the closed item's draft is let go");
});

test("a close the agent changed its item before is not taken: the item stands as the agent now asks it, though no read holds the newer revision yet", async () => {
  const { page } = mount();
  await settle();
  const changed = { ...THRESHOLD, revision: 2, title: "Alert at 85%?", updatedAt: 6_000 };
  const sent = answeredCloses(() => ({ item: changed, taken: false }));

  await closeFromPane(page);

  assert.deepEqual(sent, [THRESHOLD.id]);
  assert.equal(
    needsYouMark(rowNamed(page, "Alert at 85%?")),
    "*",
    "it needs you as the agent now asks it",
  );
});

test("a teammate's open item leads with its title alone, and its box still takes your answer", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: CHARLES }, RETRY]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
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

/**
 * What the open item's box says outside its controls, its files, and its
 * note line, its presses' words among it: nothing but a notice's Got it, since the box
 * carries no helper text, its Send held until it holds something to send.
 */
function footWords(pane: HTMLElement): string {
  const box = pane.querySelector("form.inbox-answer") ?? assert.fail("the box");
  const copy = box.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const part of copy.querySelectorAll(
    ":scope > :is([data-inbox-draft-ask], .attached-files, .agent-composer-field)",
  )) {
    part.remove();
  }
  return copy.textContent ?? "";
}

/**
 * The open item's box as a reader meets it, top to bottom: "controls" where
 * the open question's controls stand as its body, the note line by what it
 * asks for, then the foot's row of presses, left to right, each by its name.
 */
function boxParts(pane: HTMLElement): string[] {
  const form = pane.querySelector("form.inbox-answer") ?? assert.fail("the box");
  return [...form.children].flatMap((part) => {
    if (part.matches("[data-inbox-draft-ask]")) return ["controls"];
    if (part.matches(".agent-composer-field")) {
      const line = part.querySelector(".composer-editor") ?? assert.fail("the line's editor");
      return [`line: ${line.getAttribute("aria-label")}`];
    }
    if (part.matches(".inbox-answer-foot")) {
      const presses = [...part.querySelectorAll<HTMLElement>("button, .composer-editor")].map(
        (press) => press.getAttribute("aria-label") ?? press.textContent,
      );
      return [`row: ${presses.join(", ")}`];
    }
    return [];
  });
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

test("Enter on a focused option sends the answer and never presses the option; with nothing picked, Send stands held, and Enter there or in the box sends nothing and takes the keyboard to the options, the box saying nothing of what is missing", async () => {
  const { page } = mount();
  await settle();
  const sent = heldAnswers();
  const pane = itemPane(page);

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.equal(document.activeElement, openOptions(pane)[0], "the keyboard goes to the options");
  assert.equal(footWords(pane), "", "the box says nothing of what is missing");
  assert.equal(answerSend(pane).disabled, true, "Send stands held");
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "the note line stands on its own under the options, over the row of presses",
  );
  keyOn(openOptions(pane)[0] ?? assert.fail("no option"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "an answer lacking its pick goes nowhere");
  assert.deepEqual(checkedOptions(pane), [], "and Enter picked nothing");

  const once = openOptions(pane)[1] ?? assert.fail("no second option");
  act(() => once.click());
  assert.equal(answerSend(pane).disabled, false, "the pick lights Send");
  keyOn(once, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, choices }) => ({ reply, choices })),
    [{ reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] }],
  );
  // The answer stands at once, as sent: the pick Enter was on, never pressed off.
  assert.deepEqual(answeredPicks(page), ["Retry once"], "Enter left the pick standing");
});

test("a waiting choice of several is a checkbox list whose box counts nothing on its foot: the arrows move along it picking nothing, a number key toggles its option, and Enter on a picked option sends every pick and lets none go", async () => {
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
  assert.equal(footWords(pane), "", "the foot says nothing of how many may be picked");
  assert.equal(pane.textContent?.includes("Pick any that apply"), false, "no line under the list");

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
  assert.equal(footWords(pane), "", "nor how many are");

  keyOn(email, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ reply, choices }) => ({ reply, choices })),
    [{ reply: INBOX_REPLY.CHOSE, choices: ["Pager", "Email"] }],
  );
  // The answer stands at once, as sent: every pick, Enter's own among them.
  assert.deepEqual(answeredPicks(page), ["Email", "Pager"], "Enter let no pick go");
});

test("Enter anywhere in a form, in a short number field or its text field's composer, sends what is filled, a required field left empty absent from it, and with nothing filled takes the keyboard to the first required one, the box naming nothing; Shift+Enter in a text field is a new line, and an @ there picks a mention written in as its link", async () => {
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
  assert.equal(footWords(pane), "");

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
  assert.deepEqual(footPresses(pane), ["Dictate", "Send"], "Decline and Approve left the foot");

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(sent, []);
  assert.equal(document.activeElement, openOptions(pane)[0]);
  assert.equal(footWords(pane), "");
  assert.equal(answerSend(pane).disabled, true);

  pressKey("2", document.activeElement ?? document.body);
  assert.deepEqual(checkedOptions(pane), ["Decline"]);
  assert.equal(answerSend(pane).disabled, false);
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
  assert.deepEqual(footPresses(pane), ["Dictate", "Send"], "Done left the foot");

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
  assert.equal(footWords(pane), "");
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

test("a note from before version 5 that asks to be heard back is left open as it is opened, since its nod would message the agent: its Send reads Got it while its box is empty and is the round Send once a word is written, and Enter in its box sends the nod, with no line at the foot beside it", async () => {
  onlyAsking({ type: INBOX_RESPONSE.NONE }, { needsReply: true });
  const sent = heldAnswers();
  const { page } = mount();
  await settle();
  assert.deepEqual(sent, [], "opening it answers nothing");
  const pane = itemPane(page);
  assert.deepEqual(footPresses(pane), ["Dictate", "Got it"]);
  assert.equal(
    footWords(pane),
    "Got it",
    "Got it is Send's own words, and no line stands beside it",
  );
  typeInComposer(pane, "Looks right");
  assert.equal(answerSend(pane).getAttribute("aria-label"), "Send");
  assert.equal(footWords(pane), "");
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

test("a note from before version 5 that needs no reply is acknowledged as it is opened, and its box offers no Got it", async () => {
  const note = onlyAsking({ type: INBOX_RESPONSE.NONE }, { needsReply: false });
  // Unanswered, so the note stands open again with its box.
  const answered: CodingAgentInboxAnswerParams[] = [];
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return previous(request);
      answered.push(request.payload);
      const value = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
    },
  });
  const { page } = mount();
  await settle();
  assert.deepEqual(
    answered.map(({ itemId, reply }) => ({ itemId, reply })),
    [{ itemId: note.id, reply: INBOX_REPLY.ACKNOWLEDGED }],
  );
  const pane = itemPane(page);
  assert.equal(answerSend(pane).getAttribute("aria-label"), "Send");
  assert.equal(answerSend(pane).disabled, true, "an empty box sends nothing");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.equal(answered.length, 1, "Enter in the empty box sends no second nod");
});

test("a settled approval or to-do draws its two cards as they were offered, read-only, the decision given checked in its tone, with no fold and no chip repeating it", async () => {
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
    assert.equal(pane.querySelector("[data-inbox-offered]"), null, "nothing is folded away");
    assert.equal(pane.querySelector("[data-inbox-pick]"), null, "no chip repeats the decision");
    const checked = answeredControls(page).querySelector<HTMLElement>('[aria-checked="true"]');
    return [answeredOptions(page), checked?.dataset.tone];
  };
  assert.deepEqual(read("Run the migration?"), [
    [
      ["Approve", true],
      ["Decline", false],
    ],
    "complete",
  ]);
  assert.deepEqual(read("Add the token"), [
    [
      ["Add the token", false],
      ["Couldn't do it", true],
    ],
    "danger",
  ]);
});

test("a settled choice whose pick is not the one recommended marks each apart: the pick checked, and the recommended option by its badge", async () => {
  inboxes.set(BILLING.id, [
    THRESHOLD,
    { ...RETRY, answer: { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] } },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  assert.deepEqual(answeredOptions(page), [
    ["Retry 3 times over an hour", false],
    ["Retry once", true],
  ]);
  assert.deepEqual(
    [...answeredControls(page).querySelectorAll('[role="radio"]')].map((row) => wordsOf(row)),
    ["Retry 3 times over an hourRecommendedBacks off 5, 15, then 40 minutes.", "Retry once"],
  );
});

test("a teammate's answer names them by their disc and name, their pick checked in the question over it, and their name hangs their card", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, answeredBy: CHARLES }]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  assert.deepEqual(answeredPicks(page), ["Retry 3 times over an hour"]);
  const reply =
    pane.querySelector<HTMLElement>('[data-inbox-comment="answered"]') ??
    assert.fail("their answer");
  assert.match(answerHead(page) ?? "", /^Charles Pan.+ · /u);
  assert.equal(
    reply.querySelector<HTMLElement>(".inbox-comment-head [data-actor-ref] .actor-mark")?.dataset
      .kind,
    "person",
  );

  const answerer = reply.querySelector("[data-actor-ref]") ?? assert.fail("the answerer is named");
  restOn(answerer);
  const card = document.querySelector(".luke-tooltip-card [data-actor-card='person']");
  assert.match(card?.textContent ?? "", /Charles Pan/u);
});

test("a form stacks its fields, each its name over its control, \"Optional\" after the name of one that may be left empty and \"Required\" nowhere: a select's options are pills, any one's pick taken back by pressing it again, a required one's too since a field left empty sends without it, a yes-or-no a checkbox beside its name, a number a short field, and a text field the composer's own field", async () => {
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
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(askMarker(pane), null);

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
  assert.deepEqual(readSegmented(severity()).checked, [], "the required pick is taken back too");
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

test("a form's select wears the Recommended badge on the option the agent recommends and on no other, and picks nothing for the developer", async () => {
  inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      response: {
        type: INBOX_RESPONSE.FORM,
        fields: [
          {
            type: INBOX_FIELD.SELECT,
            label: "Channel",
            options: ["Email", "Slack"],
            recommended: "Slack",
          },
          { type: INBOX_FIELD.SELECT, label: "Severity", options: ["Low", "High"] },
        ],
      },
    },
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const pane = itemPane(page);

  assert.deepEqual(readSegmented(segmentedGroup(pane, "Channel")), {
    options: ["Email", "SlackRecommended"],
    checked: [],
    tabStops: ["Email"],
  });
  assert.deepEqual(readSegmented(segmentedGroup(pane, "Severity")).options, ["Low", "High"]);
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
  assert.deepEqual(
    [...page.querySelectorAll(".inbox-view-items .desktop-toolbar button")]
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .slice(2),
    ["Item actions"],
    "beside the crumbs the bar holds the item's ⋯ menu alone",
  );
  act(() => crumbs[0]?.click());
  act(() => crumbs[1]?.click());
  assert.deepEqual(asked.shownTasks, [BILLING.id]);
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

/** What an intersection observer reports of the heading it watches: in the thread's view, or scrolled up past its top. */
type HeadingSeen = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;

/** The headings the pane's intersection observers watch, each with its observer's callback. */
const headingsWatched = new Map<Element, HeadingSeen>();

/** An intersection observer that reports nothing until a test scrolls the heading it watches. */
class HeadingObserver {
  readonly #callback: HeadingSeen;
  constructor(callback: HeadingSeen) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    headingsWatched.set(target, this.#callback);
  }
  disconnect(): void {
    for (const [target, callback] of headingsWatched)
      if (callback === this.#callback) headingsWatched.delete(target);
  }
}

/** Scrolls the shown item's heading up out of the thread's view, or back into it, as its scroller would report it. */
function scrollHeading(page: HTMLElement, away: boolean): void {
  const heading =
    page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]") ??
    assert.fail("the item's heading is drawn");
  const seen = headingsWatched.get(heading) ?? assert.fail("the heading is watched");
  const rootBounds = DOMRect.fromRect({ y: 100, width: 600, height: 500 });
  const boundingClientRect = DOMRect.fromRect({ y: away ? 40 : 120, width: 600, height: 30 });
  act(() => seen([{ isIntersecting: !away, rootBounds, boundingClientRect }]));
}

/** The words of the item's bar's path, crumb by crumb, as a reader meets them. */
function pathWords(page: HTMLElement): (string | null)[] {
  return [
    ...page.querySelectorAll('.inbox-view-items:not([hidden]) nav[aria-label="Path"] li'),
  ].map((crumb) => crumb.textContent);
}

test("once the item's heading scrolls out of the thread's view, its title joins the bar's path as its last words, the page the reader stands on, and leaves it again once the heading is back, so it never stands twice", async () => {
  vi.stubGlobal("IntersectionObserver", HeadingObserver);
  const { page } = mount();
  await settle();
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts"], "the heading names it");

  scrollHeading(page, true);
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts", "Alert at 80%?"]);
  const title = page.querySelector(
    '.inbox-view-items nav[aria-label="Path"] [aria-current="page"]',
  );
  assert.equal(title?.textContent, "Alert at 80%?", "the title is where the reader stands");
  assert.equal(title?.closest("button"), null, "the title is words, not a press");

  scrollHeading(page, false);
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts"]);

  scrollHeading(page, true);
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(
    pathWords(page),
    ["Billing usage alerts", "Alerts"],
    "another item opens with its own heading in view",
  );
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

test("an item's Markdown draws its own pictures, read once its item's own read lands, a pair side by side, and a pull request's link alone on its line as its card", async () => {
  const before = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c72";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c73";
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const words = {
    type: INBOX_BLOCK.MARKDOWN,
    text: [
      `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`,
      "https://github.com/acme/relay/pull/42",
    ].join("\n\n"),
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, blocks: [words] }, RETRY]);
  const { page } = mount();
  await settle();
  // The pictures land once their item's own read does, which keeps them as the item's.
  for (const land of imageReads.splice(0)) land();
  await settle();
  const pair = page.querySelectorAll("[data-inbox-markdown] .transcript-pictures");
  assert.equal(pair.length, 1, "the two pictures stand side by side in one row");
  assert.deepEqual(
    [...(pair[0]?.querySelectorAll("img") ?? [])].map((image) => image.alt),
    ["The form before", "The form after"],
  );
  assert.equal(
    page.querySelector('[data-inbox-markdown] [data-lone-link="pull-request"] .luke-list-row-title')
      ?.textContent,
    "#42",
  );
  // What the item's words draw stands inside the pane's masked region.
  assert.ok(page.querySelector(".ph-no-capture [data-lone-link]"));
});

test("a picture of an item opens a viewer the arrow keys walk across every picture of the item, its Markdown's pair and its image block alike, in the order they are drawn", async () => {
  const before = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c74";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c75";
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const words = {
    type: INBOX_BLOCK.MARKDOWN,
    text: `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`,
  };
  const shot = {
    type: INBOX_BLOCK.IMAGE,
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c76",
    alt: "The pull request tab",
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, blocks: [words, shot] }, RETRY]);
  const { page } = mount();
  await settle();
  for (const land of imageReads.splice(0)) land();
  await settle();
  const press = page.querySelector<HTMLButtonElement>(
    'button[aria-label="Enlarge The form after"]',
  );
  assert.ok(press, "the picture is pressed to enlarge it");
  act(() => press.click());
  const viewer = () => {
    const card = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(card, "the viewer is open");
    return [
      card.querySelector<HTMLImageElement>(".attachment-viewer-image")?.alt,
      card.querySelector(".attachment-viewer-place")?.textContent,
    ];
  };
  const key = (name: string) =>
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        ),
    );
  assert.deepEqual(viewer(), ["The form after.png", "2 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The pull request tab.png", "3 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The form before.png", "1 of 3"]);
  key("ArrowLeft");
  assert.deepEqual(viewer(), ["The pull request tab.png", "3 of 3"]);
});

test("a thread draws a comment's files over its words: an agent's pictures stand once, where its words draw them, one they do not draw over them, and a member's picture and file over their words, the viewer walking each picture once", async () => {
  const [before, after, unnamed, mine, spec] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c80",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c81",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c82",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c83",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c84",
  ];
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const png = (attachmentId: string, name: string) => ({
    attachmentId,
    name,
    mediaType: INBOX_IMAGE_TYPE.PNG,
  });
  const agents: InboxMessage = {
    ...threadMessage(
      "c1b2c3d4-0000-4000-8000-000000000050",
      "agent",
      `The form, before and after.\n\n![Before](${picture(before)} "Before") ![After](${picture(after)} "After")`,
      1_000,
    ),
    // The service keeps each picture the words draw as a file of the message; an older one may keep one they do not draw.
    files: [png(before, "before.png"), png(after, "after.png"), png(unnamed, "older.png")],
  };
  const members: InboxMessage = {
    ...threadMessage(
      "c1b2c3d4-0000-4000-8000-000000000051",
      { member: TEAMMATE },
      "Here is mine.",
      2_000,
    ),
    files: [
      png(mine, "mine.png"),
      { attachmentId: spec, name: "spec.pdf", mediaType: "application/pdf" },
    ],
  };
  const pane = await mountThread(threadItem([agents, members]));
  for (const land of imageReads.splice(0)) land();
  await settle();

  const [agent, member] = [...pane.querySelectorAll('[data-inbox-comment="message"]')];
  assert.ok(agent && member, "both messages are drawn");
  assert.equal(
    pane.querySelectorAll('[aria-label="Attached files"] img').length,
    0,
    "no thumbnails",
  );
  const alts = (within: Element) =>
    [...within.querySelectorAll<HTMLImageElement>(".picture-block img")].map((image) => image.alt);
  assert.deepEqual(alts(agent), ["older.png", "Before", "After"], "each picture stands once");
  assert.deepEqual(alts(member), ["mine.png"]);
  assert.deepEqual(attachedNames(agent), []);
  assert.deepEqual(attachedNames(member), ["spec.pdf"]);
  // What the message carried stands over its words, as every message's files do.
  for (const [comment, carried] of [
    [agent, agent.querySelector("[data-inbox-file-pictures]")],
    [member, member.querySelector("[data-inbox-file-pictures]")],
    [member, member.querySelector('[aria-label="Attached files"]')],
  ] as const) {
    const words = comment.querySelector("[data-inbox-message-text]");
    assert.ok(words && carried, "the words and the files are drawn");
    assert.ok(words.compareDocumentPosition(carried) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  const press = pane.querySelector<HTMLButtonElement>('button[aria-label="Enlarge After"]');
  assert.ok(press, "the picture is pressed to enlarge it");
  act(() => press.click());
  const viewer = () => {
    const card = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(card, "the viewer is open");
    return [
      card.querySelector<HTMLImageElement>(".attachment-viewer-image")?.alt,
      card.querySelector(".attachment-viewer-place")?.textContent,
    ];
  };
  const key = (name: string) =>
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        ),
    );
  assert.deepEqual(viewer(), ["After.png", "3 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["mine.png", "4 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["older.png", "1 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["Before.png", "2 of 4"]);
});

/** The card standing in the window, as a reader hears it: the agent's name, then what its corner says, nothing for an agent at work whose start is not known. */
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
  focusRestOn(control);
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

test("the thread names its agent as one button wherever it does, its question's comment and the line saying an answer was sent to it: each hangs the agent's tab's card, which offers no Open agent, and opens its tab, leaving the Inbox", async () => {
  const { page, asked } = mount();
  await settle();
  const [comment, ...more] = threadRefs(page);
  assert.ok(comment, "the question's comment names the agent");
  assert.equal(comment.textContent, "Alerts");
  assert.deepEqual(more, [], "nothing over the thread names the agent again");
  const asking =
    page.querySelector('[data-inbox-comment="asked"]') ?? assert.fail("the question is a comment");
  assert.ok(
    asking.querySelector('.inbox-comment-head [data-actor-ref] .actor-mark[data-kind="agent"]'),
    "the agent's tile leads its comment",
  );
  reach(comment);
  assert.deepEqual(standingCard(), ["Alerts", undefined]);
  assert.deepEqual(openings("[data-tab-card]"), [], "the name is the way to the tab");
  act(() => comment.click());
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
  assert.deepEqual(standingCard(), ["Alerts", undefined]);
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
  let [named] = threadRefs(page);
  assert.ok(named, "the thread names the archived agent");
  assert.equal(named.textContent, "Alerts");
  reach(named);
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
  [named] = threadRefs(page);
  assert.ok(named, "the thread names an agent the plan does not list");
  assert.equal(named.textContent, "Coding agent");
  reach(named);
  assert.deepEqual(standingCard(), ["Coding agent", "Not found"]);
  act(() => named.click());
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
});

test("an item's row hangs the thread's card beside it, as a sidebar task's row hangs its task's, its tile hanging none of its own: its task, its title, where it stands, how it ended, and the agent that asked at its foot with the spinner while it works; a press on the card chooses nothing, and a press on the row chooses the item", async () => {
  const { page, asked } = mount();
  await settle();
  const row = rowNamed(page, "How is a failed email retried?");
  assert.equal(row.querySelector("[data-agent-ref]"), null, "the tile hangs no card of its own");
  assert.ok(wearsAgentTile(row), "the row wears the agent's tile");
  const words = hoveredCard(row, "[data-inbox-row-card]") ?? "";
  assert.match(words, /^Billing usage alerts/u, "the card leads with its task");
  assert.match(words, /How is a failed email retried\?/u);
  assert.match(words, /Answered/u);
  assert.match(words, /Alerts$/u, "the agent that asked stands at its foot");
  const card =
    document.querySelector<HTMLElement>(".luke-tooltip-card [data-inbox-row-card]") ??
    assert.fail("the thread's card is hung");
  assert.ok(
    card.querySelector('.luke-hover-card-row-end .state-glyph[data-state="working"]'),
    "the spinner stands beside the agent at the card's foot, no words",
  );
  // A press on the card, as one selecting its words makes, leaves the row unchosen and the card standing.
  act(() => {
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    card.click();
  });
  assert.equal(row.getAttribute("aria-current"), null);
  assert.ok(document.querySelector(".luke-tooltip-card [data-inbox-row-card]"));
  act(() => row.click());
  assert.equal(row.getAttribute("aria-current"), "page");
  assert.deepEqual(asked.shownAgents, [], "the press stays in the Inbox");
  const other = rowNamed(page, "Expire after 7 days?");
  assert.ok(wearsAgentTile(other), "a row whose plan names no agent still wears an agent's tile");
});

test("an item's card says whom an open item waits on, the reader as Needs you and a teammate by name", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(INVITES.id, [{ ...EXPIRY, startedBy: CHARLES }]);
  const { page } = mount();
  await settle();
  assert.match(
    hoveredCard(rowNamed(page, "Alert at 80%?"), "[data-inbox-row-card]") ?? "",
    /Needs you/u,
  );
  assert.match(
    hoveredCard(rowNamed(page, "Expire after 7 days?"), "[data-inbox-row-card]") ?? "",
    /Waiting on Charles Pan/u,
  );
});

test("an item's card names its task as the window names a task everywhere: the key as plain words, as every place draws a key, then the task's mention pill wearing its status's mark, its whole name in the task's card it hangs, then its status in words", async () => {
  const LONG = "Billing usage alerts, with a name long enough to be cut short in the card";
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          { id: BILLING.workspaceId, name: "Stage", role: WORKSPACE_ROLE.OWNER, github: null },
        ],
      },
    },
  );
  const { page } = mount([], {
    standing: [{ ...BILLING, name: LONG, number: 182, status: TASK_STATUS.IN_PROGRESS }, INVITES],
  });
  await settle();
  hoveredCard(rowNamed(page, THRESHOLD.title), "[data-inbox-row-card]");
  const card =
    document.querySelector<HTMLElement>(".luke-tooltip-card [data-inbox-row-card]") ??
    assert.fail("the row's card is hung");
  const head = card.querySelector('.task-card-standing[data-line="one"]');
  assert.deepEqual(
    [...(head?.children ?? [])].map((each) => [each.className, each.textContent]),
    [
      ["task-key", "STAG-182"],
      ["luke-inline-ref", LONG],
      ["inbox-card-task-status", "In progress"],
    ],
    "the key, then the task's chip, then its status, on one line",
  );
  assert.ok(head?.querySelector("[data-task-key] .luke-text"), "the key is the shared key's words");
  assert.equal(head?.querySelector(".task-card-chip"), null, "the key is no chip");
  const chip =
    head?.querySelector<HTMLElement>('.luke-inline-ref[data-look="pill"][data-holder-ref]') ??
    assert.fail("the task is named by the mention pill");
  assert.ok(
    chip.querySelector('.luke-inline-ref-glyph .luke-task-status-mark[data-status="in-progress"]'),
    "the pill wears the task's status's mark",
  );
  restOn(chip);
  const cards = [...document.querySelectorAll(".luke-tooltip-card")];
  assert.ok(
    cards.some(
      (each) => each !== card.closest(".luke-tooltip-card") && each.textContent?.includes(LONG),
    ),
    "the pill hangs a card naming the task whole",
  );
});

test("a plan main says changed is read again, so an item answered on another Mac lists as settled, gray where it stood while the list is shown; To do then lists only what still needs you until All is chosen, which sorts it anew, and the choice outlives a relaunch", async () => {
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
  assert.deepEqual(
    listed(page),
    [
      "# Billing usage alerts",
      "How is a failed email retried?",
      "▸ *Alert at 80%?",
      "# Invites",
      "Expire after 7 days?",
    ],
    "the answer moves no row while the list is shown",
  );
  assert.equal(rowMuted(page, "Expire after 7 days?"), true);
  const everything = [
    "# Invites",
    "Expire after 7 days?",
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
  ];

  showScope(page, "To do");
  assert.deepEqual(scopes(page), ["Inbox", "[To do]", "All"]);
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[To do]", "All"]);
  assert.deepEqual(listed(page), ["# Billing usage alerts", "▸ *Alert at 80%?"]);

  showScope(page, "All");
  assert.deepEqual(scopes(page), ["Inbox · All", "To do", "[All]"]);
  assert.deepEqual(listed(page), everything);
});

test("To do lists what needs you and anything of yours unread: a thread you answered that its agent writes on again comes back to it, which waiting on you alone would leave out", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  const { page } = mount();
  await settle();
  assert.deepEqual(listed(page), [
    "# Invites",
    "▸ *Expire after 7 days?",
    "# Billing usage alerts",
    "*Alert at 80%?",
  ]);

  // The retry question's agent writes again on the thread you answered, as main says its task changed.
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, updatedAt: 6_000, unread: true }]);
  act(() =>
    setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 6_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "*Alert at 80%?",
    "# Invites",
    "▸ *Expire after 7 days?",
  ]);
});

/** The number the window's sidebar draws on its Inbox row; none where it draws none. */
function sidebarInboxCount(page: HTMLElement): number | undefined {
  const row =
    [...page.querySelectorAll<HTMLElement>(".sidebar-places .luke-nav-item")].find(
      (each) => each.querySelector(".luke-nav-item-name")?.textContent === "Inbox",
    ) ?? assert.fail("the sidebar draws its Inbox row");
  const count = row.textContent?.match(/\d+/u)?.[0];
  return count === undefined ? undefined : Number(count);
}

/** How many rows To do lists, whoever's. */
function toDoRows(page: HTMLElement): number {
  return listed(page).filter((row) => !row.startsWith("# ")).length;
}

test("the sidebar's Inbox counts what To do lists, as main counts each task's to do: an open ask, an unread notice, and a thread you answered written on again, never a read settled item, or a teammate's ask; reading or answering one drops it at once", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  const NOTE: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000011", "Preview is up", 3_500),
    response: { type: INBOX_RESPONSE.NONE },
    unread: true,
  };
  const SEEN: InboxItem = {
    ...RETRY,
    id: "a1b2c3d4-0000-4000-8000-000000000012",
    key: "seen",
    title: "Which region?",
    updatedAt: 4_500,
    unread: false,
  };
  const THEIRS: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000013", "Rotate the key?", 3_800),
    startedBy: TEAMMATE,
  };
  // Note that the thread written on again changed before the open ask, so the item chosen as the Inbox opens is one opening never reads out of To do.
  const followed: InboxItem = { ...RETRY, updatedAt: 2_500, unread: true };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, followed, SEEN]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }, NOTE, THEIRS]);
  const holding = (billing: number): readonly AppInboxTaskHolding[] => [
    { taskId: BILLING.id, items: 3, toDo: billing, updatedAt: 4_500 },
    { taskId: INVITES.id, items: 3, toDo: 2, updatedAt: 4_000 },
  ];
  const { page } = mount([], { holding: holding(2), withSidebar: true });
  await settle();
  assert.equal(toDoRows(page), 4);
  assert.equal(sidebarInboxCount(page), 4, "the sidebar counts what To do lists");
  assert.deepEqual(readMarks, [`read:${EXPIRY.id}`], "opening an open ask leaves it to do");
  readMarks = [];

  // Opening the thread written on again reads it, and the count drops before main hears of it.
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(readMarks, [`read:${followed.id}`]);
  assert.equal(sidebarInboxCount(page), 3);
  // Main's word catching up counts it no longer either, and the mark adds nothing to it.
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, { ...followed, unread: false }, SEEN]);
  act(() => setHolding(holding(1)));
  await settle();
  assert.equal(sidebarInboxCount(page), 3);

  // Answering the open ask drops it the moment it is sent.
  const { sent } = gatedAnswers();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(sent.length, 1, "the answer is on its way, the service not answering yet");
  assert.equal(sidebarInboxCount(page), 2);
});

test("a read mark stops moving the sidebar's Inbox once main hands the window a read after the service took it, even where another window's mark leaves main's count as it stood", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  // Note that the thread written on again changed before the open asks, so opening the Inbox reads none out of To do.
  const followed: InboxItem = { ...RETRY, updatedAt: 2_500, unread: true };
  const SEEN: InboxItem = {
    ...RETRY,
    id: "a1b2c3d4-0000-4000-8000-000000000012",
    key: "seen",
    title: "Which region?",
    updatedAt: 2_000,
    unread: false,
  };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, followed, SEEN]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const holding = (): readonly AppInboxTaskHolding[] => [
    { taskId: BILLING.id, items: 3, toDo: 2, updatedAt: 3_000 },
    { taskId: INVITES.id, items: 1, toDo: 1, updatedAt: 4_000 },
  ];
  const { page } = mount([], { holding: holding(), withSidebar: true });
  await settle();
  assert.equal(sidebarInboxCount(page), 3);

  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.equal(sidebarInboxCount(page), 2, "reading the thread drops it at once");

  // Another window marks the read item unread as main hears of this read, so main counts the billing task's two as before.
  inboxes.set(BILLING.id, [
    { ...THRESHOLD, unread: true },
    { ...followed, unread: false },
    { ...SEEN, unread: true },
  ]);
  act(() => setHolding(holding()));
  await settle();
  assert.equal(sidebarInboxCount(page), 3, "main's newer read stands, the mark in it");
});

test("the sidebar's Inbox counts the open items alone, as before, where main carries no To do count from an older service", async () => {
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, updatedAt: 6_000, unread: true }]);
  const { page } = mount([], { withSidebar: true });
  await settle();
  assert.equal(
    sidebarInboxCount(page),
    2,
    "the threshold and expiry questions, which main lists open",
  );
});

test("a fresh profile opens the Inbox on To do, grouped by task, its head naming no scope, a settled item left out until All is chosen, which the head then names", async () => {
  window.localStorage.clear();
  const { page } = mount();
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[To do]", "All"]);
  assert.deepEqual(listed(page), [
    "# Invites",
    "▸ *Expire after 7 days?",
    "# Billing usage alerts",
    "*Alert at 80%?",
  ]);
  showScope(page, "All");
  assert.equal(headTitle(page), "Inbox · All");
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "*Alert at 80%?",
    "# Invites",
    "▸ *Expire after 7 days?",
  ]);
});

test("a task done or canceled keeps its items listed and counted as any other's, each row wearing its task's status, its card saying it in words, and a row of an agent with no task wearing none; no scope offers an archive", async () => {
  window.localStorage.clear();
  agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount(
    [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        agentTitle: "Sweep the flaky tests",
        agentModel: "anthropic/claude-opus-5.5",
        automationId: null,
        automationName: null,
        repository: "acme/relay",
      },
    ],
    {
      standing: [
        { ...BILLING, status: TASK_STATUS.DONE },
        { ...INVITES, status: TASK_STATUS.CANCELED },
      ],
    },
  );
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[To do]", "All"]);
  const rows = listed(page);
  for (const row of ["*Alert at 80%?", "*Expire after 7 days?", "*Quarantine the flaky test?"]) {
    assert.ok(
      rows.some((each) => each.replace(/^▸ /u, "") === row),
      `To do lists ${row}: ${rows.join(" | ")}`,
    );
  }
  const tasksFolded = foldedCounts(page).filter(
    (each) => each?.startsWith("Billing") === true || each?.startsWith("Invites") === true,
  );
  assert.deepEqual(tasksFolded.toSorted(), [
    "Billing usage alerts1 needs you",
    "Invites1 needs you",
  ]);
  assert.equal(rowStatus(page, "Alert at 80%?"), "Done");
  assert.equal(rowStatus(page, "Expire after 7 days?"), "Canceled");
  assert.equal(rowStatus(page, "Quarantine the flaky test?"), undefined);

  restOn(rowNamed(page, "Alert at 80%?"));
  const card = document.querySelector(".luke-tooltip-card [data-inbox-row-card]");
  assert.equal(card?.querySelector(".inbox-card-task-status")?.textContent, "Done");
});

test("a tab kept before the scopes opens the Inbox on the scope that lists what it did, Needs you and Unread on To do and All open and Everything on All, and the Needs you press kept before the tabs on To do where pressed and All where not; a scope chosen since is kept in its place", async () => {
  const kept = [
    [SHOW_KEY, "needs-you", "[To do]"],
    [SHOW_KEY, "unread", "[To do]"],
    [SHOW_KEY, "open", "[All]"],
    [SHOW_KEY, "all", "[All]"],
    [EARLIER_SHOW_KEY, true, "[To do]"],
    [EARLIER_SHOW_KEY, false, "[All]"],
  ] as const;
  const opened: (string | undefined)[] = [];
  for (const [key, value] of kept) {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(value));
    const { page } = mount();
    await settle();
    opened.push(scopes(page).find((each) => each.startsWith("[")));
    act(() => root?.unmount());
    root = undefined;
  }
  assert.deepEqual(
    opened,
    kept.map(([, , scope]) => scope),
  );

  let { page } = mount();
  await settle();
  showScope(page, "To do");
  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[To do]", "All"]);
});

test("Sort in the view's menu offers Latest first and Oldest first, which lists the item changed longest ago first; a Waiting longest kept before is read as Oldest first, and the sort chosen outlives a relaunch", async () => {
  window.localStorage.setItem(SORT_KEY, JSON.stringify("waiting"));
  let { page } = mount();
  await settle();
  openViewOptions(page);
  act(() => viewItem("Sort").click());
  assert.deepEqual(
    ["Latest first", "Oldest first"].map((each) => viewItem(each).getAttribute("aria-checked")),
    ["false", "true"],
  );
  act(() => viewItem("Oldest first").click());
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "▸ *Alert at 80%?",
    "How is a failed email retried?",
    "# Invites",
    "*Expire after 7 days?",
  ]);

  chooseView(page, "Sort", "Latest first");
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
  act(() => root?.unmount());
  root = undefined;
  ({ page } = mount());
  await settle();
  openViewOptions(page);
  act(() => viewItem("Sort").click());
  assert.equal(viewItem("Latest first").getAttribute("aria-checked"), "true");
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

test("on To do, your unread update leading the list is the first item chosen, and keeps its row, gray, once opening it reads it, so J steps on from it and K finds it gone once left", async () => {
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("newest"));
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  assert.equal(readTitle(page), "How is a failed email retried?");
  assert.deepEqual(
    listed(page),
    ["▸ How is a failed email retried?", "*Expire after 7 days?", "*Alert at 80%?"],
    "the row read stays where it stood while it is chosen",
  );
  assert.equal(rowMuted(page, "How is a failed email retried?"), true, "drawn gray");
  pressKey("j");
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.deepEqual(listed(page), ["▸ *Expire after 7 days?", "*Alert at 80%?"]);
  pressKey("k");
  assert.equal(
    readTitle(page),
    "Expire after 7 days?",
    "the read update left once it was left, and is no step",
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
  // Note that the plans keep the order they were drawn in, since the list is shown as the item closes.
  assert.deepEqual(
    headers().map((header) => [header.getAttribute("aria-expanded"), header.textContent]),
    [
      ["false", "Billing usage alerts1 needs you"],
      ["false", "Invites"],
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
  const empty = shown.querySelector(".luke-empty-state-words");
  return empty === null || shown.hasAttribute("hidden") ? null : (empty.textContent ?? "");
}

/** The way on an empty state in `column` offers, by its words. */
function emptyStateAction(page: HTMLElement, column: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`${column} .luke-empty-state button`);
}

test("an Inbox with nothing in it stands its empty state in the pane beside the list, and in the list itself once the list stands alone", async () => {
  inboxes = new Map();
  listedAgents = [];
  const { page, asked } = mount();
  await settle();
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  assert.deepEqual(
    [emptyStateIn(page, ".inbox-tasks"), emptyStateIn(page, ".inbox-view-items")],
    [null, "Nothing needs you"],
  );
  const offered = emptyStateAction(page, ".inbox-view-items");
  assert.equal(offered?.textContent, "New task", "the empty Inbox offers New task");
  act(() => offered?.click());
  assert.equal(asked.newTasks, 1, "New task asks for its dialog");

  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), "Nothing needs you");
  assert.equal(emptyStateAction(page, ".inbox-tasks")?.textContent, "New task");
});

test("on a phone, an Inbox with nothing chosen shows its list and says nothing needs you, under no panel, though the panel stands open as a first launch leaves it", async () => {
  inboxes = new Map();
  listedAgents = [];
  const { page } = mount([], { room: SHELL_ROOM.NARROW });
  assert.equal(page.querySelector(".side-panel"), null, "no panel is drawn over the Inbox");
  assert.equal(page.querySelector(".page-find[hidden]"), null, "the Inbox page is not hidden");
  await settle();
  layOut(page, 390);
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

/** The list's empty state as a reader meets it: its heading, its line, and its one press; none where the list stands none. */
function listEmpty(page: HTMLElement): readonly (string | null | undefined)[] | null {
  const empty = page.querySelector(".inbox-tasks:not([hidden]) .luke-empty-state");
  if (empty === null) return null;
  return [
    empty.querySelector("h3")?.textContent,
    empty.querySelector("p")?.textContent,
    empty.querySelector("button")?.textContent,
  ];
}

test("with only settled items, read, To do lists no row, the item read still shown beside the list, which says there is nothing to do and offers Show all; its press shows All", async () => {
  const answered = { reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] };
  inboxes.set(INVITES.id, [{ ...EXPIRY, status: INBOX_STATUS.ANSWERED, answer: answered }]);
  inboxes.set(BILLING.id, [RETRY]);
  const { page } = mount();
  await settle();
  const everything = [
    "# Billing usage alerts",
    "▸ How is a failed email retried?",
    "# Invites",
    "Expire after 7 days?",
  ];
  assert.deepEqual(listed(page), everything);

  showScope(page, "To do");
  assert.equal(headTitle(page), "Inbox");
  assert.deepEqual(listed(page), [], "the item read is not listed under a filter leaving it out");
  assert.deepEqual(listEmpty(page), [undefined, "Nothing to do", "Show all"]);
  assert.equal(emptyStateIn(page, ".inbox-view-items"), null, "the pane says nothing twice");
  assert.equal(readTitle(page), "How is a failed email retried?");

  // One column wide, the item read stands alone with nothing to page to, and its way back reaches the empty list.
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(pagerOf(page), null);
  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(listEmpty(page)?.[1], "Nothing to do");

  const showAll = page.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button");
  assert.ok(showAll, "the empty state offers Show all");
  act(() => showAll.click());
  assert.equal(headTitle(page), "Inbox · All");
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
  assert.equal(listEmpty(page), null);
});

test("one column wide, an answered item that To do draws no row for shows no count in its pager, though its arrows still step to the rows either side, which count only the rows drawn", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  showScope(page, "To do");
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

test("on To do, a focused row whose item is answered on another Mac leaves the keyboard on View options rather than nowhere", async () => {
  const { page } = mount();
  await settle();
  showScope(page, "To do");
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
  assert.ok(
    document.activeElement === page.querySelector('button[aria-label="View options"]'),
    "the keyboard is on View options",
  );
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

test("Next follows the way the keys last went: after K it offers the nearest item above that needs you, by an arrow up and K, a press opening it; after J the one below, by J", async () => {
  inboxes.set(BILLING.id, [
    { ...THRESHOLD, updatedAt: 4_500 },
    { ...RETRY, updatedAt: 2_000, settledAt: 2_000 },
  ]);
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  const offered = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "▸ *Alert at 80%?",
    "How is a failed email retried?",
    "# Invites",
    "*Expire after 7 days?",
  ]);

  pressKey("j");
  assert.equal(readTitle(page), "How is a failed email retried?");
  assert.equal(wordsOf(offered()), "NextExpire after 7 days?J");
  assert.equal(offered()?.getAttribute("aria-keyshortcuts"), "J");

  pressKey("j");
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");
  const next = offered();
  assert.ok(next, "the settled item offers the next");
  assert.equal(wordsOf(next), "Next ↑Alert at 80%?K");
  assert.equal(next.getAttribute("aria-keyshortcuts"), "K");
  act(() => next.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  act(() => keys.unmount());
});

test("Next hands the keyboard to the item it opens, its way back one column wide and its row split, and the item opens at its thread's newest message, wherever the last was scrolled", async () => {
  layOutBoards({ height: 1200 });
  const { page } = mount();
  await settle();
  const next = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  act(() => rowNamed(page, "How is a failed email retried?").click());
  const board = boardOf(itemPane(page));
  scrollBoard(board, 200);
  next()?.focus();
  act(() => next()?.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.ok(
    document.activeElement === rowNamed(page, "Alert at 80%?"),
    "split, the keyboard is on its row",
  );
  assert.equal(board.scrollTop, 800, "the next item opens at its newest message");
  assert.equal(scrollButton(itemPane(page)), null, "at its end, no way back is offered");

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
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return previous(request);
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
  // Main pushes the chosen task's inbox again as the test says it changed.
  const deliver = (outcome: ReadOutcome) =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, pushedOf(outcome.value));
  const { page } = mount();
  await settle();
  const slow = gatedFile("trace.txt", "boom\n");
  await handFiles(page, [slow.file], "pick");
  const revised = { ...THRESHOLD, revision: 2, title: "Alert at 85%?" };
  act(() =>
    deliver({
      status: FAKE_ANSWER.DONE,
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
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return previous(request);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
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

test("an item that needs no reply says nothing in its box of whether its answer will message the agent, bare, with a note, or with a file", async () => {
  inboxes = new Map([
    [BILLING.id, [{ ...THRESHOLD, response: { type: INBOX_RESPONSE.TODO }, needsReply: false }]],
  ]);
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  assert.equal(footWords(pane), "");
  typeInComposer(pane, "Done on preview too.");
  assert.equal(footWords(pane), "");
  await handFiles(page, [new File(["ok\n"], "flag.txt", { type: "text/plain" })], "pick");
  assert.equal(footWords(pane), "");
  assert.equal(pane.textContent?.includes("message the agent"), false);
  assert.equal(pane.textContent?.includes("sent to the agent"), false);
});

test("an answered item draws the files its answer carried after its words, never as a strip of thumbnails: a picture as a picture in its words is drawn, once read, and any other file as its chip; files alone stand under the answer's head with no pick and no empty note", async () => {
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
  assert.deepEqual(
    attachedNames(comment()),
    ["spec.pdf"],
    "only the file that is no picture is a chip",
  );
  assert.equal(comment().querySelector("[data-inbox-pick]"), null, "no chip says it was answered");
  assert.equal(comment().querySelector("[data-inbox-note]"), null, "no empty note stands");

  act(() => {
    for (const land of imageReads) land();
  });
  await settle();
  assert.equal(
    comment().querySelectorAll('[aria-label="Attached files"] img').length,
    0,
    "no thumbnail",
  );
  const picture = comment().querySelector<HTMLImageElement>(".picture-block img");
  assert.equal(picture?.alt, "alerts.png");
  assert.equal(picture?.getAttribute("src"), "data:image/png;base64,iVBORw0KGgo=");
  assert.ok(comment().querySelector('button[aria-label="Enlarge alerts.png"]'), "it opens larger");
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

test("an answered form draws its fields as they were asked, read-only, each holding what it was given and one left empty standing empty, a text field's words as a sent message's, so a mention it holds is its chip and never its link's words; no list under the answer repeats them", async () => {
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
        { type: INBOX_FIELD.NUMBER, label: "Retries" },
        { type: INBOX_FIELD.TEXT, label: "Notes" },
        { type: INBOX_FIELD.BOOLEAN, label: "Dry run" },
      ],
    },
    answer: {
      reply: INBOX_REPLY.SUBMITTED,
      values: [
        { label: "Effort", value: "high" },
        { label: "Reason", value: `See ${file}` },
        { label: "Page on-call", value: false },
        { label: "Retries", value: 3 },
        { label: "Dry run", value: true },
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
  await settle();

  assert.deepEqual(answeredFields(answeredControls(page)), [
    ["select", "Effort", "high"],
    ["text", "Reason", "See rollout-store.ts"],
    ["boolean", "Page on-call", "unchecked"],
    ["number", "Retries", "3"],
    ["text", "Notes", ""],
    ["boolean", "Dry run", "checked"],
  ]);
  const reason =
    answeredControls(page).querySelector('[role="textbox"][aria-readonly="true"]') ??
    assert.fail("the text field stands read-only");
  assert.equal(reason.querySelector("[data-mention-ref]")?.textContent, "rollout-store.ts");
  assert.equal(
    itemPane(page).querySelector('[data-inbox-comment="answered"] [data-inbox-values]'),
    null,
    "no list under the answer repeats the values",
  );
  assert.equal(
    itemPane(page).querySelector("[data-inbox-field]"),
    null,
    "no answered field stands where Enter's way to an empty one would look",
  );
});

/**
 * Each field of a form filled in as answered, in order: its kind, its name,
 * and what it holds as a reader meets it, a select's pick, a text field's
 * words, a number's figure, and a yes or no checked or not; each control
 * stands read-only.
 */
function answeredFields(within: Element): (string | null | undefined)[][] {
  return [...within.querySelectorAll<HTMLElement>("[data-inbox-answered-field]")].map((field) => {
    const kind = field.dataset.inboxAnsweredField;
    const name = field.querySelector(".luke-field-label, .inbox-field-name, .luke-checkbox-words")
      ?.firstChild?.textContent;
    const box = field.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const number = field.querySelector<HTMLInputElement>('input[type="number"]');
    const words = field.querySelector('[role="textbox"]');
    const pills = field.querySelector<HTMLElement>(".luke-choice-list");
    if (box !== null) {
      assert.equal(box.getAttribute("aria-readonly"), "true");
      return [kind, name, box.checked ? "checked" : "unchecked"];
    }
    if (number !== null) {
      assert.equal(number.readOnly, true);
      return [kind, name, number.value];
    }
    if (pills !== null) {
      assert.equal(pills.dataset.readOnly, "true");
      return [kind, name, pills.querySelector('[aria-checked="true"]')?.textContent];
    }
    assert.equal(words?.getAttribute("aria-readonly"), "true");
    return [kind, name, words?.textContent];
  });
}

test("an answered item of a response this build does not know still lists its values under the answer's head, as no fields stand to hold them", async () => {
  const matrix = Schema.decodeUnknownSync(inboxReadResponseSchema)({ type: "matrix" });
  inboxes = new Map([
    [
      BILLING.id,
      [
        THRESHOLD,
        {
          ...RETRY,
          response: matrix,
          answer: { reply: INBOX_REPLY.SUBMITTED, values: [{ label: "Region", value: "west" }] },
        },
      ],
    ],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());

  assert.equal(itemPane(page).querySelector("[data-inbox-answered]"), null);
  assert.equal(
    wordsOf(itemPane(page).querySelector('[data-inbox-comment="answered"] [data-inbox-values]')),
    "Regionwest",
  );
});

test("what an item's box said of a dictation that failed stays with that item, and the next item's box opens without it", async () => {
  // The strip draws still under reduced motion, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      request.kind === ACT_KIND.MICROPHONE_REQUEST
        ? Promise.resolve({ status: FAKE_ANSWER.DONE, value: MICROPHONE_STATUS.DENIED })
        : previous(request),
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
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.TASKS_SKILLS) {
        const release = {
          name: "release",
          description: "Use to cut a release.",
          path: ".agents/skills/release/SKILL.md",
        };
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { skills: { repository: "acme/relay", branch: "main", skills: [release] } },
        });
      }
      if (request.kind === ACT_KIND.GITHUB_OPEN) {
        opened.push(request.payload.url);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      return previous(request);
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

test("in the window's Inbox a skill an answered note names is the chip a sent message draws, which opens its SKILL.md in the panel beside it as its preview, as a file the item names does", async () => {
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
  const files: string[] = [];
  const panel: SidePanelControl = {
    ...tasksControl().sidePanel,
    onPreviewFile: (ref) => files.push(ref.path),
  };
  const { page } = mount([], { panel });
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await pressNoteSkill(page, "/release");

  assert.deepEqual(files, [".agents/skills/release/SKILL.md"]);
  assert.deepEqual(opened, [], "nothing leaves for GitHub");
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
  const listReads: AnyAct[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) listReads.push(request);
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        const asked = request.payload.itemId === noted.id ? noted : bare;
        const answered = { ...asked, status: INBOX_STATUS.ANSWERED, answeredBy: READER };
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { item: answered, taken: true },
        });
      }
      return previous(request);
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

/** A read the test answers when it chooses. */
interface PendingRead {
  readonly promise: Promise<ReadOutcome>;
  readonly settle: (value: CodingAgentInboxAnswerView) => void;
}

/** A read held until the test settles it. */
function pending(): PendingRead {
  let settle: PendingRead["settle"] = () => undefined;
  const promise = new Promise<ReadOutcome>((resolve) => {
    settle = (value) => resolve({ status: FAKE_ANSWER.DONE, value });
  });
  return { promise, settle };
}

test("a chosen item whose plan leaves the account's list, deleted on another Mac, gives way to the first item still waiting", async () => {
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

test("a link alone on its line to a page an agent with no plan showed stands as the page's row, hanging the card a plan's page hangs, its title, version and the agent that showed it, read as it is first hung; one of an agent the reader cannot reach keeps the chip's own card", async () => {
  const ledger: PageLine = {
    id: "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d",
    title: "Flake ledger",
    version: 3,
    at: 1_000,
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId: SWEEP_AGENT },
  };
  agentPages = new Map([[SWEEP_AGENT, [ledger]]]);
  const shown = linkOf({ kind: LINK_PLACE.PAGE, agentId: SWEEP_AGENT, pageId: ledger.id }, "acme");
  const hidden = linkOf({ kind: LINK_PLACE.PAGE, agentId: STRAY_AGENT, pageId: ledger.id }, "acme");
  const words = {
    type: INBOX_BLOCK.MARKDOWN,
    text: [shown, `[@Their ledger](${hidden})`].join("\n\n"),
  };
  agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, blocks: [words] }]]]);
  const waiting: AppInboxTasklessItem = {
    id: QUARANTINE.id,
    agentId: SWEEP_AGENT,
    title: QUARANTINE.title,
    postedAt: QUARANTINE.postedAt,
    agentTitle: "Sweep the flaky tests",
    agentModel: "anthropic/claude-opus-5.5",
    automationId: null,
    automationName: null,
    repository: "acme/relay",
  };
  // Main's document names the agent by what waits on it, as the window's names are read.
  const held = stateWith({}, {});
  handState({}, { inbox: { ...held.inbox, taskless: [waiting] } });
  const { page } = mount([waiting]);
  await settle();
  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();

  const rows = [...page.querySelectorAll('[data-inbox-markdown] [data-lone-link="page"]')];
  assert.equal(rows.length, 2, "each link alone on its line stands as a page's row");
  const [mine, theirs] = rows.map((row) => row.querySelector("button.luke-list-row-main"));
  assert.ok(mine && theirs);
  restOn(mine);
  await settle();
  const card = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.ok(card, "the agent's page hangs the page's own card");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "Flake ledger");
  assert.equal(
    card.querySelector(".luke-hover-card-sub")?.textContent,
    "Version 3 · Shown by Sweep the flaky tests",
  );
  assert.equal(
    card.querySelector(".page-card-frame")?.getAttribute("src"),
    pageFrameUrl({ agentId: SWEEP_AGENT, pageId: ledger.id, version: 3 }),
  );
  act(() => {
    mine.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });

  restOn(theirs);
  await settle();
  assert.equal(document.querySelector(".luke-tooltip-card [data-page-card]"), null);
  assert.equal(
    document.querySelector(".luke-tooltip-card [data-mention-card] .luke-hover-card-name")
      ?.textContent,
    "Their ledger",
  );
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
  restOn(control);
  return wordsOf(document.querySelector(`.luke-tooltip-card ${card}`));
}

test("an automation's group wears its clock tile and hangs its card, as its crumb does, the card's name opening its page since the header's press folds; its agent's row wears the agent's tile and hangs a card naming the agent and the automation that started it; the agents no automation names stand under no actor", async () => {
  handState({});
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
    "a group of agents wears the factory glyph, naming no one actor",
  );

  const mark = rowNamed(page, "Quarantine the flaky test?");
  assert.ok(wearsAgentTile(mark), "the planless agent's row wears its tile");
  assert.match(
    hoveredCard(mark, "[data-inbox-row-card]") ?? "",
    /^Nightly flake sweep.*Sweep the flaky tests$/su,
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
    "it wears the factory glyph, as its group does",
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

  const row = rowNamed(page, "Quarantine the flaky test?");
  assert.match(hoveredCard(row, "[data-inbox-row-card]") ?? "", /Nightly flake sweep$/u);
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
          status: FAKE_ANSWER.DONE,
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
              status: FAKE_ANSWER.DONE,
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
          status: FAKE_ANSWER.DONE,
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
  return [
    ...itemPane(page).querySelectorAll<HTMLElement>(
      '.inbox-thread > li:not([data-inbox-comment="draft"])',
    ),
  ].map((entry) => [
    entry.dataset.inboxComment ?? (entry.dataset.inboxEarlier === undefined ? "?" : "earlier"),
    entry.querySelector<HTMLElement>(".inbox-comment-head [data-actor-ref] .actor-mark")?.dataset
      .kind,
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
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: answer(request.payload) });
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

test("a message written on a settled item's thread from its box goes as a message, never an answer, and lands on the thread in place, scrolled into view with the draft reply under it, the item still answered and the box emptied", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const answers = heldAnswers();
  const sent = heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000010"));
  const pane = itemPane(page);
  const board =
    pane.querySelector<HTMLElement>(".inbox-board")?.parentElement ?? assert.fail("the thread");
  // The thread is taller than its board, so the new comment lands under its foot, the draft reply under it.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === board) return DOMRect.fromRect({ y: 0, height: 400 });
    if (this.matches("[data-message-id]")) return DOMRect.fromRect({ y: 900, height: 60 });
    if (this.matches('[data-inbox-comment="draft"]')) {
      return DOMRect.fromRect({ y: 960, height: 200 });
    }
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
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
  assert.equal(composerEditor(pane).textContent, "", "the box lets its words go");
  assert.equal(
    board.scrollTop,
    760,
    "the board scrolls its own new comment, and the draft reply's foot under it, into view",
  );
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
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
});

test("a message refused as naming no agent says the agent is archived where it is, with Unarchive after it, which brings the agent back and lets the note go, the box keeping its words; one whose agent is gone says it no longer exists", async () => {
  listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(() => ({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }));
  const unarchived: { agentId: string; archived: boolean }[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_ARCHIVE) return previous(request);
      unarchived.push(request.payload);
      // Brought back, the agent is listed so from then on.
      const back = { ...AGENT, status: CODING_AGENT_STATUS.COMPLETED };
      listedAgents = [back];
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agent: back } });
    },
  });
  const pane = itemPane(page);
  const note = () => pane.querySelector('.agent-composer [role="alert"]');
  const unarchive = () =>
    [...pane.querySelectorAll<HTMLButtonElement>(".agent-composer-note button")].find(
      (button) => button.textContent === "Unarchive",
    );

  typeInComposer(pane, "Page on-call at night too.");
  act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.match(note()?.textContent ?? "", /^This agent is archived\./u);
  act(() => (unarchive() ?? assert.fail("Unarchive follows the note")).click());
  await settle();
  assert.deepEqual(unarchived, [{ agentId: AGENT.id, archived: false }]);
  assert.equal(note(), null, "the note is let go once the agent is back");
  assert.equal(composerEditor(pane).textContent, "Page on-call at night too.");

  act(() => root?.unmount());
  listedAgents = [];
  const gone = mount().page;
  await settle();
  act(() => rowNamed(gone, "How is a failed email retried?").click());
  await settle();
  const goneItem = itemPane(gone);
  typeInComposer(goneItem, "Page on-call at night too.");
  act(() => goneItem.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    goneItem.querySelector('.agent-composer [role="alert"]')?.textContent,
    "This agent no longer exists.",
  );
  assert.equal(goneItem.querySelector(".agent-composer-note button"), null, "nothing to unarchive");
});

test("an Unarchive that lands after another send was refused lets only the archived note go, so the newer refusal still says why", async () => {
  listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  let refusal:
    | typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND
    | typeof CODING_AGENT_CALL_FAILURE.UNANSWERED = CODING_AGENT_CALL_FAILURE.NOT_FOUND;
  heldMessages(() => ({ failure: refusal }));
  let land: () => void = () => undefined;
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_ARCHIVE) return previous(request);
      const back = { ...AGENT, status: CODING_AGENT_STATUS.COMPLETED };
      // Held until the test lands it, after the second send was refused.
      return new Promise((resolve) => {
        land = () => {
          listedAgents = [back];
          resolve({ status: FAKE_ANSWER.DONE, value: { agent: back } });
        };
      });
    },
  });
  const pane = itemPane(page);
  const note = () => pane.querySelector('.agent-composer [role="alert"]')?.textContent;
  const send = () =>
    act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());

  typeInComposer(pane, "Page on-call at night too.");
  send();
  await settle();
  const unarchive = [
    ...pane.querySelectorAll<HTMLButtonElement>(".agent-composer-note button"),
  ].find((button) => button.textContent === "Unarchive");
  act(() => (unarchive ?? assert.fail("Unarchive follows the note")).click());
  refusal = CODING_AGENT_CALL_FAILURE.UNANSWERED;
  send();
  await settle();
  const newer = note();
  assert.notEqual(newer, undefined, "the second send says why it did not go");

  act(() => land());
  await settle();

  assert.equal(note(), newer, "the newer refusal stands once the agent is back");
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
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Add a note");

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
  // Main pushes the chosen task's inbox again as the test says it changed.
  const deliver = (outcome: ReadOutcome) =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, pushedOf(outcome.value));
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
    deliver({ status: FAKE_ANSWER.DONE, value: { items: [answered, RETRY], cursor: "2" } }),
  );
  await settle();
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Reply");
  assert.equal(composerEditor(pane).textContent, "", "the unsent answer is not a message");

  typeInComposer(pane, "Thanks, Charles.");
  await settle();
  act(() =>
    deliver({ status: FAKE_ANSWER.DONE, value: { items: [answered, RETRY], cursor: "3" } }),
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

test("a teammate's open item of an agent with no plan is listed under the automation that started it, wearing the teammate's face with no attention mark; To do leaves it out, and Group by person lists it under the teammate", async () => {
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

  showScope(page, "To do");
  assert.equal(
    listed(page).includes("Quarantine the flaky test?"),
    false,
    listed(page).join(" | "),
  );

  showScope(page, "All");
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

test("an unread item wears the blue dot in its row's gutter, its title in the unread weight, and says Unread to a reader; opening it marks it read at once, the item standing chosen first among them, your unread answered thread leading the list among what it reaches", async () => {
  inboxes.set(BILLING.id, [
    { ...THRESHOLD, unread: true },
    { ...RETRY, unread: true },
  ]);
  inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const { page } = mount();
  await settle();
  // The item standing chosen is shown, and so opened, as the Inbox opens.
  assert.deepEqual(readMarks, [`read:${RETRY.id}`]);
  assert.equal(unreadOf(page, "How is a failed email retried?"), false);
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
  assert.equal(unreadOf(page, "Expire after 7 days?"), true);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(readMarks, [`read:${RETRY.id}`, `read:${EXPIRY.id}`]);
  assert.equal(unreadOf(page, "Expire after 7 days?"), false);
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
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
  // Note that the unread answered item is a teammate's, so the item standing chosen is the one that needs you, and nothing is read before the mark.
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true, startedBy: TEAMMATE }]);
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
    "To do",
    "All",
    "—",
    "Group by",
    "Sort",
    "—",
    "Whose",
    "—",
    "Second line",
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

test("Mark all as read sends one write and asks no task or agent again, since each followed inbox is pushed its items' read state as it moves", async () => {
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
  const followsBefore = main.asked.length;
  const marksBefore = readMarks.length;
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  act(() => menuItem("Mark all as read").click());
  await settle();
  assert.deepEqual(readMarks.slice(marksBefore), ["all:workspace-acme"]);
  assert.deepEqual(main.asked.slice(followsBefore), [], "nothing is followed again");
  assert.deepEqual(taskReads.slice(tasksBefore), []);
  assert.deepEqual(agentReads.slice(agentsBefore), []);
});

test("a row swiped right marks its item: a long swipe marks an unread item read as it is let go, a short one leaves the row open on an Unread button for a read one, and neither opens the item", async () => {
  // Note that the unread item is a teammate's, so it is not the item standing chosen, which would read it as it opens.
  inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true, startedBy: TEAMMATE }]);
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
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return previous(request);
      sent.push(request.payload);
      return new Promise((resolve) =>
        waiting.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
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
  const { page } = mount();
  await settle();
  const { sent, answer } = gatedAnswers();
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts1 needs you", "Invites1 needs you"]);

  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(sent.length, 1, "the answer is on its way, the service not answering yet");
  assert.deepEqual(
    listed(page),
    [
      "# Billing usage alerts",
      "How is a failed email retried?",
      "▸ Alert at 80%?",
      "# Invites",
      "*Expire after 7 days?",
    ],
    "the answered row stays where it stood",
  );
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts", "Invites1 needs you"]);

  await act(async () => answer({ item: THRESHOLD_ANSWERED, taken: true }));
  await settle();
  // The plan's inbox is pushed as it stood before the answer, read before it was taken.
  await act(async () =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, { items: [THRESHOLD, RETRY] }),
  );
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

/** The list as drawn, each row by its title alone and each group by its name, what marks a row and what a group counts left out, so a row that moves or changes group is told from one that only changes its marks. */
function placesOf(page: HTMLElement): string[] {
  return listed(page).map((line) =>
    line.startsWith("# ") ? line.replace(/\d+ needs? you$/u, "") : line.replace(/^(▸ )?\*?/u, ""),
  );
}

test("on To do, answering the chosen item draws its row gray where it stood, and choosing another row clears it", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("newest"));
  const { page } = mount();
  await settle();
  const { answer } = gatedAnswers();
  assert.deepEqual(listed(page), ["▸ *Expire after 7 days?", "*Alert at 80%?"]);
  assert.equal(rowMuted(page, "Expire after 7 days?"), false);

  answerWithNote(page, "Keep 7 days");
  await settle();
  await act(async () =>
    answer({
      item: {
        ...EXPIRY,
        status: INBOX_STATUS.ANSWERED,
        answer: { reply: INBOX_REPLY.ANSWERED, note: "Keep 7 days" },
        answeredBy: READER,
        settledAt: 6_000,
        updatedAt: 6_000,
      },
      taken: true,
    }),
  );
  await settle();
  assert.deepEqual(
    listed(page),
    ["▸ Expire after 7 days?", "*Alert at 80%?"],
    "the answered row stays where it stood, needing nobody",
  );
  assert.equal(rowMuted(page, "Expire after 7 days?"), true, "drawn gray");
  assert.equal(rowMuted(page, "Alert at 80%?"), false);

  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.deepEqual(
    listed(page),
    ["▸ *Alert at 80%?"],
    "the gray row clears once another is chosen",
  );
});

test("on To do, the chosen row is let go once the Inbox is left, so an item answered while it was hidden is gone when it is come back to", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("newest"));
  const { page } = mount();
  await settle();
  assert.deepEqual(listed(page), ["▸ *Expire after 7 days?", "*Alert at 80%?"]);

  act(() => setInboxOpen(false));
  await settle();
  const answered = {
    ...EXPIRY,
    status: INBOX_STATUS.ANSWERED,
    answer: { reply: INBOX_REPLY.ANSWERED, note: "Keep 7 days" },
    settledAt: 6_000,
    updatedAt: 6_000,
  };
  // The invites plan's change is pushed, as an answer from another Mac would be.
  main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: INVITES.id }, { items: [answered] });
  await settle();
  act(() => setInboxOpen(true));
  await settle();
  assert.deepEqual(
    listed(page),
    ["*Alert at 80%?"],
    "the item answered while the Inbox was hidden no longer needs you, so it has no row",
  );
});

test("on All, every item settled and read is drawn gray, and what waits or is unread is not", async () => {
  inboxes.set(INVITES.id, [{ ...EXPIRY, status: INBOX_STATUS.CLOSED, unread: true }]);
  const { page } = mount();
  await settle();
  showScope(page, "All");
  assert.equal(rowMuted(page, "How is a failed email retried?"), true, "answered and read");
  assert.equal(rowMuted(page, "Alert at 80%?"), false, "waiting on you");
  assert.equal(rowMuted(page, "Expire after 7 days?"), false, "settled, but unread");
});

test("an answer moves no row while the list is shown, under either sort and every grouping, and the list sorts anew once the Inbox is left and come back to", async () => {
  const groupings = ["plan", "person", "status", "newest"] as const;
  const sorts = ["latest", "oldest"] as const;
  for (const grouping of groupings) {
    for (const sort of sorts) {
      window.localStorage.setItem(SHOW_KEY, JSON.stringify("all"));
      window.localStorage.setItem(GROUPING_KEY, JSON.stringify(grouping));
      window.localStorage.setItem(SORT_KEY, JSON.stringify(sort));
      const { page } = mount();
      await settle();
      const { answer } = gatedAnswers();
      act(() => rowNamed(page, "Alert at 80%?").click());
      await settle();
      const before = placesOf(page);

      answerWithNote(page, "Use 90%");
      await settle();
      assert.deepEqual(placesOf(page), before, `${grouping}, ${sort}: as the answer is sent`);
      await act(async () => answer({ item: THRESHOLD_ANSWERED, taken: true }));
      await settle();
      assert.deepEqual(placesOf(page), before, `${grouping}, ${sort}: once it is taken`);
      assert.equal(rowMuted(page, "Alert at 80%?"), true);

      act(() => setInboxOpen(false));
      act(() => setInboxOpen(true));
      await settle();
      assert.notDeepEqual(placesOf(page), before, `${grouping}, ${sort}: sorted anew`);

      act(() => root?.unmount());
      root = undefined;
      document.body.innerHTML = "";
    }
  }
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

test("Whose in the view's menu lists one teammate's items, by their face and name, or the reader's own as Mine; a chip over the list says so, the choice outlives a relaunch, and the chip's × lists everyone's again", async () => {
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
  assert.equal(listed(page).length, 5);
});

test("a teammate chosen in Whose with nothing in the scope shown says so, and offers everyone's items again where no scope holds any of theirs", async () => {
  listedWorkspace = SHARED_WORKSPACE;
  members = SHARED_MEMBERS;
  const { page } = mount();
  await settle();
  chooseView(page, "Whose", "Charles Pan");
  assert.deepEqual(listed(page), []);
  assert.deepEqual(listEmpty(page), [
    undefined,
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

test("an item marked read as it opened stays read once another plan's item is chosen, though the list's read of its plan, which a mark never moves, still holds it unread", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  const { page } = mount();
  await settle();
  assert.deepEqual(readMarks, [`read:${THRESHOLD.id}`]);
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  // The plan's inbox is pushed on the mark, as the host hears it, holding the item read.
  await act(async () =>
    main.push(
      { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id },
      { items: [{ ...THRESHOLD, unread: false }, RETRY] },
    ),
  );
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "the list's older read brings no dot back");
});

test("a mark another window makes later on the same item stands once the plan's push holds it, over the window's own earlier mark", async () => {
  inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  const { page } = mount();
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  // The plan's inbox is pushed as the test says: its own mark heard, then another window's.
  const billing = { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id };
  await act(async () => main.push(billing, { items: [{ ...THRESHOLD, unread: false }, RETRY] }));
  await settle();
  await act(async () => main.push(billing, { items: [{ ...THRESHOLD, unread: true }, RETRY] }));
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
});

/** The message of the agent's that asks, on the threads below. */
const ASKING_ID = "e1b2c3d4-0000-4000-8000-000000000001";

/** The agent's message that opens a thread, ending with `ask`, open unless it says otherwise. */
function askingMessage(
  ask: InboxAsk,
  {
    id = ASKING_ID,
    status = INBOX_ASK_STATUS.OPEN,
    withdrawnReason,
    createdAt = 1_000,
  }: {
    id?: string;
    status?: InboxReadAsk["status"];
    withdrawnReason?: string;
    createdAt?: number;
  } = {},
): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Invites expire after 24 hours today, which trips up teams across time zones.",
    ask: { ...ask, status, ...(withdrawnReason === undefined ? undefined : { withdrawnReason }) },
    createdAt,
  };
}

/** How long an invite lasts, the agent's choice of three. */
const EXPIRY_ASK: InboxAsk = {
  type: INBOX_ASK.DECIDE,
  options: [
    { label: "1 day", detail: "As today." },
    { label: "7 days", detail: "What most teams use." },
    { label: "30 days" },
  ],
  recommended: "7 days",
};

/** The waiting item, drawn as a thread from version 5: its question's title, no blocks, and `thread`. */
function threadItem(thread: readonly InboxMessage[], extra: Partial<InboxItem> = {}): InboxItem {
  return { ...THRESHOLD, title: "How long should invites last?", blocks: [], thread, ...extra };
}

/** The pane showing the item given, chosen from its row. */
async function mountThread(shown: InboxItem): Promise<HTMLElement> {
  inboxes = new Map([
    [BILLING.id, [shown, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, shown.title).click());
  await settle();
  return itemPane(page);
}

/** How tall the room is that a thread's board shows, as the tests below lay it out. */
const BOARD_ROOM = 400;

/** The scroll measures jsdom gives no element, which `layOutBoards` stands in for. */
const SCROLL_MEASURES = ["scrollHeight", "clientHeight", "scrollTop"] as const;

/**
 * Lays out every thread's board (the pane's log) as the window would:
 * `layout.height` tall, read anew each time, in a room `BOARD_ROOM` tall,
 * its scroll held between its top and its end as a browser holds it. Any
 * other element keeps jsdom's own measures. Taken down as the test ends.
 */
function layOutBoards(layout: { height: number }): void {
  const tops = new WeakMap<Element, number>();
  const board = (element: Element) =>
    element.getAttribute("role") === "log" && element.closest(".inbox-view-items") !== null;
  const jsdoms = SCROLL_MEASURES.map(
    (name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const,
  );
  const jsdom = (name: (typeof SCROLL_MEASURES)[number]) =>
    jsdoms.find(([held]) => held === name)?.[1] ?? assert.fail(`jsdom's ${name}`);
  Object.defineProperties(Element.prototype, {
    scrollHeight: {
      configurable: true,
      get(this: Element) {
        return board(this) ? layout.height : jsdom("scrollHeight").get?.call(this);
      },
    },
    clientHeight: {
      configurable: true,
      get(this: Element) {
        return board(this) ? BOARD_ROOM : jsdom("clientHeight").get?.call(this);
      },
    },
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return board(this) ? (tops.get(this) ?? 0) : jsdom("scrollTop").get?.call(this);
      },
      set(this: Element, to: number) {
        if (!board(this)) return jsdom("scrollTop").set?.call(this, to);
        tops.set(this, Math.max(0, Math.min(to, layout.height - BOARD_ROOM)));
      },
    },
  });
  onTestFinished(() => {
    for (const [name, descriptor] of jsdoms) {
      if (descriptor !== undefined) Object.defineProperty(Element.prototype, name, descriptor);
    }
  });
}

/** The pane's thread, its board, which scrolls. */
function boardOf(pane: HTMLElement): HTMLElement {
  return pane.querySelector<HTMLElement>('[role="log"]') ?? assert.fail("the thread's board");
}

/** Scrolls `board` to `top` as the reader would, so the pane hears it. */
function scrollBoard(board: HTMLElement, top: number): void {
  board.scrollTop = top;
  act(() => {
    board.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** The transcript's way back to the newest line, where the pane shows it. */
function scrollButton(pane: HTMLElement): HTMLButtonElement | null {
  return pane.querySelector<HTMLButtonElement>('button[aria-label="Scroll to the newest line"]');
}

test("a long thread opens at its newest message, its draft reply just over the board's foot, whether its question waits on an answer or nothing is asked", async () => {
  layOutBoards({ height: 1200 });
  for (const shown of [
    threadItem([askingMessage(EXPIRY_ASK)]),
    { ...THRESHOLD, title: "Alert at 90%?" },
    threadItem([
      threadMessage("e1b2c3d4-0000-4000-8000-000000000040", "agent", "Shipped the fix.", 1_000),
    ]),
  ]) {
    const pane = await mountThread(shown);
    assert.equal(boardOf(pane).scrollTop, 800, shown.title);
    assert.equal(scrollButton(pane), null, "at its end, no way back is offered");
    act(() => root?.unmount());
    document.body.innerHTML = "";
  }
});

test("a thread scrolled up offers the transcript's way back to its newest message, which takes it to its end and goes", async () => {
  layOutBoards({ height: 1200 });
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  const board = boardOf(pane);
  scrollBoard(board, 300);
  const back = scrollButton(pane) ?? assert.fail("scrolled up, the way back is offered");

  act(() => back.click());
  assert.equal(board.scrollTop, 800, "the thread is at its newest message again");
  assert.equal(scrollButton(pane), null, "at its end, the way back goes");
});

test("a thread that grows while the reader is at its end, a message or a picture landing late, keeps to its end; scrolled up, the reader is left where they are", async () => {
  const layout = { height: 1200 };
  layOutBoards(layout);
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  const board = boardOf(pane);
  layout.height = 1400;
  act(() => relayout());
  assert.equal(board.scrollTop, 1000, "at its end, it keeps to its end");

  scrollBoard(board, 300);
  layout.height = 1600;
  act(() => relayout());
  assert.equal(board.scrollTop, 300, "scrolled up, the reader's place stands");
});

/** Everything the thread's subject draws, a part a child: its title alone. */
function subjectParts(pane: HTMLElement): (string | null)[] {
  const subject = pane.querySelector(".inbox-subject") ?? assert.fail("the subject is drawn");
  return [...subject.children].map((part) => part.textContent);
}

/** Each ask's box on the thread: where it stands, then its head as a reader hears it; an answered ask's controls stand in its reply with no box, so they are none of these. */
function askBoxes(pane: HTMLElement): (string | null | undefined)[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-ask")].map((box) => [
    box.dataset.inboxAsk,
    wordsOf(box.querySelector(".inbox-ask-head")),
  ]);
}

/** The answered ask's controls heading a reply, as a reader hears it: their words alone, standing in the reply's body beside its words with no card around them and no head over them; none where the reply carries none. */
function answeredCard(reply: Element): string | null | undefined {
  const card = reply.querySelector("[data-inbox-answered]");
  if (card === null) return undefined;
  assert.equal(card.closest(".inbox-ask"), null, "no card stands around the controls");
  assert.ok(card.parentElement?.matches(".inbox-comment-body"), "they stand in the reply's body");
  assert.equal(card.querySelector(".inbox-ask-head"), null, "they have no head");
  return wordsOf(card);
}

/** The thread's box's one button, by its words, or by its name where it is the round Send that shows none. */
function sendWords(pane: HTMLElement): string | null {
  const button =
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("the box has its button");
  return button.textContent === "" ? button.getAttribute("aria-label") : button.textContent;
}

/** The open ask's marker ending the agent's message, as a reader hears it; none where no ask waits. */
function askMarker(pane: HTMLElement): string | null {
  return pane.querySelector("[data-inbox-marker]")?.textContent ?? null;
}

/**
 * The reader's draft reply, the thread's last comment: its head, then
 * "controls" where the open question's controls stand in its box over the
 * note, with no words of their own over them, such as what the question
 * asks or the keys that pick it, since the agent's message says it.
 */
function draftReply(pane: HTMLElement): (string | null)[] {
  const draft =
    pane.querySelector<HTMLElement>(".inbox-thread > li:last-child") ?? assert.fail("no thread");
  assert.equal(draft.dataset.inboxComment, "draft", "the draft reply ends the thread");
  const head = wordsOf(draft.querySelector(".inbox-comment-head"));
  const question = draft.querySelector("form.inbox-answer > [data-inbox-draft-ask]");
  if (question === null) return [head];
  assert.doesNotMatch(
    question.textContent ?? "",
    /Pick one|Pick any|to pick|Fill in|filled|Steps|done$/u,
    "no head stands over the controls",
  );
  return [head, "controls"];
}

/** The press of the open ask's controls, in the draft reply, whose words are `label`. */
function askPress(pane: HTMLElement, label: string): HTMLButtonElement {
  const found = [...pane.querySelectorAll<HTMLButtonElement>("[data-inbox-draft-ask] button")].find(
    (button) => button.textContent === label,
  );
  assert.ok(found, `the ask offers ${label}`);
  return found;
}

/** A reply as the service answers it: the reader's message on the thread, its answer settling the ask it names. */
function repliedOn(item: InboxItem, id: string) {
  return (params: CodingAgentInboxMessageParams): CodingAgentInboxMessagedView => {
    const { answers } = params;
    const thread = (item.thread ?? []).map((message) =>
      answers !== undefined && message.id === answers.ask && message.ask !== undefined
        ? { ...message, ask: { ...message.ask, status: INBOX_ASK_STATUS.ANSWERED } }
        : message,
    );
    const reply: InboxMessage = {
      ...threadMessage(id, { member: READER }, params.text, 9_000),
      ...(answers === undefined ? undefined : { answers }),
    };
    return {
      item: {
        ...item,
        updatedAt: 9_000,
        ...(answers === undefined
          ? undefined
          : { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: 9_000 }),
        thread: [...thread, reply],
      },
    };
  };
}

/** Each comment of the shown thread as its head draws its writer: its kind, then the kind of each face its head draws, each as the chip naming them holds it, and the faces drawn anywhere but in its head or its body. */
function commentHeads(pane: HTMLElement): (string | undefined | (string | undefined)[])[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-thread > .inbox-comment")].map(
    (comment) => [
      comment.dataset.inboxComment,
      [
        ...comment.querySelectorAll<HTMLElement>(
          ".inbox-comment-head > .inbox-comment-name > [data-actor-ref] .actor-mark",
        ),
      ].map((mark) => mark.dataset.kind),
      [...comment.querySelectorAll<HTMLElement>(".actor-mark")]
        .filter((mark) => mark.closest(".inbox-comment-head, .inbox-comment-body") === null)
        .map((mark) => mark.dataset.kind),
    ],
  );
}

test("each comment of a thread is headed by its writer's chip, their face and name as one target, its face the thread's gutter with no face drawn apart from it; the draft reply's head is the reader's chip, \"You\", with nothing after it", async () => {
  const shown = threadItem([
    askingMessage(EXPIRY_ASK),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000002",
      { member: TEAMMATE },
      "7 days, surely?",
      2_000,
    ),
  ]);
  const pane = await mountThread(shown);

  assert.deepEqual(commentHeads(pane), [
    ["message", ["agent"], []],
    ["message", ["person"], []],
    ["draft", ["person"], []],
  ]);
  const draft =
    pane.querySelector<HTMLElement>('[data-inbox-comment="draft"] .inbox-comment-head') ??
    assert.fail("the draft reply has a head");
  assert.equal(wordsOf(draft), "You", "the reader's chip alone, no draft and no time after it");
  assert.ok(
    draft.querySelector('.inbox-comment-name > [data-actor-ref][data-kind="person"] .actor-mark'),
    "the reader is named by their chip, its face and name",
  );
});

test("a thread draws every message, the agent's by its tile and name alone, no tag after its chip, and a member's by their face and name, under its title alone; its open ask is a marker ending the agent's message, its options standing in the reader's draft reply at the thread's end, over the note", async () => {
  const shown = threadItem([
    askingMessage(EXPIRY_ASK),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000002",
      { member: TEAMMATE },
      "7 days, surely?",
      2_000,
    ),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000003",
      "agent",
      "That is the default elsewhere.",
      2_500,
    ),
  ]);
  const pane = await mountThread(shown);

  assert.equal(
    pane.querySelector("[data-inbox-title]")?.textContent,
    "How long should invites last?",
  );
  assert.deepEqual(
    subjectParts(pane),
    ["How long should invites last?"],
    "no line stands under the title",
  );
  assert.deepEqual(threadOf(pane.ownerDocument.body), [
    [
      "message",
      "agent",
      "Alerts",
      "Invites expire after 24 hours today, which trips up teams across time zones.",
    ],
    ["message", "person", "Charles Pan", "7 days, surely?"],
    ["message", "agent", "Alerts", "That is the default elsewhere."],
  ]);
  assert.deepEqual(
    [...pane.querySelectorAll(".inbox-thread .inbox-comment-head")].map((head) =>
      [...head.children].map((part) => part.className),
    ),
    [
      ["inbox-comment-name", "inbox-comment-when"],
      ["inbox-comment-name", "inbox-comment-when"],
      ["inbox-comment-name", "inbox-comment-when"],
      ["inbox-comment-name"],
    ],
    "an agent's message, as a member's, is headed by its chip and when alone, with no tag after its chip, and the draft by the reader's chip alone",
  );
  assert.deepEqual(askBoxes(pane), [], "the open ask is no card in the agent's message");
  const [asked] = pane.querySelectorAll(".inbox-thread > li");
  assert.equal(
    asked?.querySelector("[data-inbox-marker]"),
    null,
    "the agent's message ends with its words, no marker saying the ask waits on the reader",
  );
  assert.equal(asked?.querySelector('[role="radio"]'), null, "and holds none of its options");
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(checkedOptions(pane), [], "nothing is picked for the reader");
  assert.deepEqual(
    openOptions(pane).map((option) => wordsOf(option)),
    ["1 day1As today.", "7 daysRecommended2What most teams use.", "30 days3"],
  );
  assert.ok(
    pane.querySelector(
      '.inbox-thread > li:last-child form.inbox-answer > [data-inbox-draft-ask] [role="radio"]',
    ),
    "the options stand in the draft's box, as its body",
  );
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "under them the note line on its own, and under it the row: +, the microphone, and Send",
  );
  assert.equal(footWords(pane), "", "and no line of help");
  // What the thread draws stands inside the pane's masked region.
  assert.ok(pane.querySelector(".ph-no-capture [data-inbox-draft-ask]"));
  assert.ok(pane.querySelector(".ph-no-capture [data-inbox-message-text]"));
});

test("a plain reply sends no answer and leaves the ask open, the box's Send held until it holds words and nothing saying the ask stays open", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const answers = heldAnswers();
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000010"));
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Add a note");
  assert.equal(sendWords(pane), "Send");
  assert.equal(answerSend(pane).disabled, true, "an empty box sends nothing");
  assert.equal(footWords(pane), "", "nothing says replying keeps the ask open");

  typeInComposer(pane, "Does it matter for SSO teams?");
  assert.equal(answerSend(pane).disabled, false, "words light Send");
  assert.equal(footWords(pane), "");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ itemId, text, answers }) => ({ itemId, text, answers })),
    [{ itemId: shown.id, text: "Does it matter for SSO teams?", answers: undefined }],
  );
  assert.deepEqual(answers, [], "the old answer path is never taken");
  assert.equal(askMarker(pane), null);
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(threadOf(pane.ownerDocument.body).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
});

/** A notice posted on a thread, asking nothing and needing no reply, as the service writes one, at revision 4. */
function noticeItem(extra: Partial<InboxItem> = {}): InboxItem {
  const said: InboxMessage = {
    id: "e1b2c3d4-0000-4000-8000-000000000020",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "The preview is up.",
    createdAt: 1_000,
  };
  return threadItem([said], {
    title: "The preview is up",
    response: { type: INBOX_RESPONSE.NONE },
    needsReply: false,
    revision: 4,
    ...extra,
  });
}

/**
 * Every answer and message the Inbox sends from now on, written down: each
 * answer refused as unanswered while `refusing` says so, the box standing
 * open again, and held unanswered otherwise; each message held unanswered.
 */
function noticeWrites(refusing: () => boolean = () => false): {
  answered: CodingAgentInboxAnswerParams[];
  messaged: CodingAgentInboxMessageParams[];
} {
  const answered: CodingAgentInboxAnswerParams[] = [];
  const messaged: CodingAgentInboxMessageParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        answered.push(request.payload);
        if (!refusing()) return new Promise(() => undefined);
        const value = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      messaged.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  return { answered, messaged };
}

/** What each answer sent says: its item, the revision it names, and the reply. */
function answersOf(answered: readonly CodingAgentInboxAnswerParams[]) {
  return answered.map(({ itemId, revision, reply }) => ({ itemId, revision, reply }));
}

test("opening the reader's own notice acknowledges it at its revision, once while it is shown, writing no message; its box offers no Got it, and opening it again after the acknowledgement was refused tries again", async () => {
  const notice = noticeItem();
  const { answered, messaged } = noticeWrites(() => true);
  const pane = await mountThread(notice);
  const acknowledged = { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED };
  assert.deepEqual(answersOf(answered), [acknowledged]);
  assert.deepEqual(messaged, [], "the agent is not messaged");

  // Refused, the notice stands open again, its box held until it holds words.
  const send =
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("the box has its button");
  assert.equal(sendWords(pane), "Send", "no Got it stands");
  assert.equal(send.disabled, true);
  assert.deepEqual(answersOf(answered), [acknowledged], "it is not tried again while it is shown");

  const page = pane.ownerDocument.body;
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  assert.deepEqual(answersOf(answered), [acknowledged, acknowledged]);
});

test("a notice shown while its plan's follow has failed reads Got it, since opening it acknowledges nothing then, and Got it answers it", async () => {
  const notice = noticeItem();
  const { answered: sent } = noticeWrites();
  inboxes = new Map([
    [BILLING.id, [notice, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  // The list's follow of the plan reads its items, and the item's own follow of it could not be read.
  const unanswered = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
  let follows = 0;
  startRead = (taskId) => {
    if (taskId !== BILLING.id) return undefined;
    follows += 1;
    return follows === 1
      ? undefined
      : Promise.resolve({ status: FAKE_ANSWER.DONE, value: unanswered });
  };
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  const pane = itemPane(page);
  assert.deepEqual(sent, [], "opening it answers nothing");
  assert.equal(sendWords(pane), "Got it");
  act(() => answerSend(pane).click());
  await settle();
  assert.deepEqual(answersOf(sent), [
    { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED },
  ]);
});

test("a notice whose box holds a draft is left open as it is opened, and its words go as a reply naming the notice's revision, no answer beside it", async () => {
  const notice = noticeItem();
  // The first acknowledgement is refused, so the box stands open to take the draft.
  let refusals = 1;
  const { answered, messaged } = noticeWrites(() => {
    refusals -= 1;
    return refusals >= 0;
  });
  const pane = await mountThread(notice);
  assert.equal(answered.length, 1);
  typeInComposer(pane, "Looks right.");
  const page = pane.ownerDocument.body;
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  assert.equal(answered.length, 1, "opened with a draft, it is not acknowledged");
  assert.equal(composerEditor(itemPane(page)).textContent, "Looks right.");
  assert.equal(sendWords(itemPane(page)), "Send");

  act(() =>
    itemPane(page)
      .querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')
      ?.click(),
  );
  await settle();
  assert.deepEqual(
    messaged.map(({ text, revision }) => ({ text, revision })),
    [{ text: "Looks right.", revision: 4 }],
  );
  assert.equal(answered.length, 1, "the reply is no second answer");
});

test("a teammate's notice is left open as it is opened, since acknowledging it settles it for them too, and its box's Send reads Got it, which answers it at its revision, with no line beside it", async () => {
  const notice = noticeItem({ startedBy: TEAMMATE });
  const { answered, messaged } = noticeWrites();
  const pane = await mountThread(notice);
  assert.deepEqual(answered, [], "opening it answers nothing");
  assert.equal(sendWords(pane), "Got it");
  assert.equal(
    footWords(pane),
    "Got it",
    "Got it is Send's own words, the foot saying nothing else",
  );
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(answersOf(answered), [
    { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED },
  ]);
  assert.deepEqual(messaged, []);
});

test("with the inbox-first sidebar, opening the reader's own notice from the sidebar acknowledges it", async () => {
  const notice = noticeItem({ id: EXPIRY.id });
  inboxes.set(INVITES.id, [notice]);
  const { answered } = noticeWrites();
  const { page } = mount([], { sidebar: true });
  await settle();
  assert.deepEqual(answered, [], "the item standing chosen is no notice");
  act(() => rowNamed(page, notice.title).click());
  await settle();
  assert.deepEqual(answersOf(answered), [
    { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED },
  ]);
});

test("a reply leaves its box the moment it is sent, the box and the ask standing empty and open while it is out, so a second Enter sends nothing; refused, its words and files come back into the box, which says why", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const sent: CodingAgentInboxMessageParams[] = [];
  const answers: ((answer: CodingAgentInboxMessagedView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      // The service answers once the test says so.
      return new Promise((resolve) =>
        answers.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
      );
    },
  });

  await handFiles(pane.ownerDocument.body, [new File(["# Notes"], "notes.md")], "pick");
  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.equal(composerEditor(pane).textContent, "", "the box lets its words go at once");
  assert.deepEqual(attachedNames(pane), [], "and its files");
  assert.equal(composerEditor(pane).getAttribute("aria-disabled"), null, "and stands open");
  assert.ok(
    openOptions(pane).every((option) => !option.disabled),
    "the ask still takes a pick",
  );
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ text }) => text),
    ["Does it matter for SSO teams?"],
    "a second Enter sends nothing again",
  );

  await act(async () => answers[0]?.({ failure: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED }));
  await settle();

  assert.equal(composerEditor(pane).textContent, "Does it matter for SSO teams?");
  assert.deepEqual(attachedNames(pane), ["notes.md"]);
  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "This task is archived. Unarchive it first.",
  );
});

test("words written in a reply's box while the reply is out stay there, whether it lands or is refused", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  // Each send waits on the test's word: the reply landing on the thread, or refused.
  const lands: ((refused: boolean) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      const { payload } = request;
      const landed = repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000020")(payload);
      return new Promise((resolve) =>
        lands.push((refused) =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: refused ? { failure: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED } : landed,
          }),
        ),
      );
    },
  });

  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  typeInComposer(pane, "And for guests?");
  await act(async () => lands[0]?.(false));
  await settle();
  assert.deepEqual(threadOf(pane.ownerDocument.body).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
  assert.equal(composerEditor(pane).textContent, "And for guests?", "a reply landing keeps them");

  pressInComposer(pane, "Enter");
  await settle();
  typeInComposer(pane, "Never mind.");
  await act(async () => lands[1]?.(true));
  await settle();
  assert.equal(
    composerEditor(pane).textContent,
    "Never mind.",
    "a refusal puts nothing back over them",
  );
});

test("words written on a reply's settled box while the reply carrying the ask's answer is out stay in the box, beside the answer, once the reply is refused and the ask stands open again", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const refuse: (() => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      return new Promise((resolve) =>
        refuse.push(() =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED },
          }),
        ),
      );
    },
  });

  act(() => openOptions(pane)[1]?.click());
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  typeInComposer(pane, "One more detail");
  await settle();
  await act(async () => refuse[0]?.());
  await settle();

  assert.equal(askMarker(pane), null);
  assert.equal(composerEditor(pane).textContent, "One more detail");
  assert.deepEqual(checkedOptions(pane), ["7 days"]);
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("words another window writes in the open ask's box while this window's reply carrying the answer is out are kept beside this window's own once the reply is refused", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const refuse: (() => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      return new Promise((resolve) =>
        refuse.push(() =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED },
          }),
        ),
      );
    },
  });

  act(() => openOptions(pane)[1]?.click());
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  typeInComposer(pane, "One more detail");
  await settle();
  // The other window, where the item still waits, writes in its open box, as storage hands it on.
  const kept: { place: { thread?: true } }[] = JSON.parse(
    window.localStorage.getItem("luke.composerDrafts") ?? "[]",
  );
  const written = kept.find((entry) => entry.place.thread === true) ?? assert.fail("the draft");
  const { thread: _, ...open } = written.place;
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([...kept, { ...written, place: open, text: "Please wait" }]),
  );
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "luke.composerDrafts" }));
  });
  await settle();
  await act(async () => refuse[0]?.());
  await settle();

  assert.deepEqual(
    [...composerEditor(pane).querySelectorAll("p")].map((line) => line.textContent),
    ["Please wait", "One more detail"],
  );
});

test("picking an option in the draft reply stands it picked and lights Send, the box saying nothing, and pressing it again takes it off; sent, the reply drops into the thread as the reader's comment leading with the answered card, and the draft stands plain at the end again", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000011"));

  act(() => openOptions(pane)[1]?.click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  assert.equal(pane.querySelector("[data-inbox-attached]"), null, "no stamp stands over the note");

  act(() => openOptions(pane)[1]?.click());
  assert.deepEqual(checkedOptions(pane), [], "pressed again, the pick is let go");
  assert.equal(answerSend(pane).disabled, true, "and Send stands held again");
  assert.equal(footWords(pane), "", "nothing says the ask stays open");

  // The number keys still pick, from wherever in the Inbox the reader stands.
  keyOn(document.body, "2");
  assert.deepEqual(checkedOptions(pane), ["7 days"]);
  typeInComposer(pane, "Most teams asked for it.");
  await settle();
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "Most teams asked for it.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
      },
    ],
  );
  const [asked, reply] = pane.querySelectorAll(".inbox-thread > li");
  assert.ok(reply, "the reply lands");
  assert.equal(answeredCard(reply), "1 dayAs today.7 daysRecommendedWhat most teams use.30 days");
  assert.deepEqual(
    [...reply.querySelectorAll('[role="radio"][aria-checked="true"] .luke-choice-label')].map(
      (label) => label.textContent,
    ),
    ["7 days"],
    "its pick says how it was answered",
  );
  assert.equal(reply.querySelector("[data-inbox-stamp]"), null, "the card marks the answer");
  assert.equal(asked?.querySelector(".inbox-ask"), null, "the ask's card left the agent's message");
  assert.equal(askMarker(pane), null, "and its marker");
  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(subjectParts(pane), ["How long should invites last?"]);
  assert.deepEqual(draftReply(pane), ["You"], "the draft stands at the end, plain");
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Reply");
  assert.deepEqual(boxParts(pane), ["line: Reply", "row: Attach files, Dictate, Send"]);
});

test("an approve-or-request-changes ask is two small buttons in the draft reply: the one pressed stands pressed, pressed again it is let go, and the reply sent with words carries it, stamped as requested changes", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DECIDE,
      options: [{ label: "Approve" }, { label: "Request changes" }],
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000012"));
  assert.deepEqual(openOptions(pane), [], "no radio list stands for a yes or no");

  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Approve").click());
  act(() => askPress(pane, "Approve").click());
  assert.equal(askPress(pane, "Approve").getAttribute("aria-pressed"), "false", "let go");
  act(() => askPress(pane, "Request changes").click());
  assert.equal(askPress(pane, "Request changes").getAttribute("aria-pressed"), "true");
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  typeInComposer(pane, "The banner overlaps the header.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "The banner overlaps the header.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["Request changes"] },
      },
    ],
  );
  const reply =
    pane.querySelector(".inbox-thread > li:nth-last-child(2)") ?? assert.fail("the reply");
  assert.equal(answeredCard(reply), "ApproveRequest changes");
  assert.equal(
    reply.querySelector('[aria-pressed="true"] .inbox-ask-pressed[data-tone="back"]')?.parentElement
      ?.textContent,
    "Request changes",
    "the press given says how it was answered",
  );
  assert.deepEqual(askBoxes(pane), []);
});

test("an ask of words alone is a plain box with no controls, its line asking for a Reply and its Send held until words are in; the words sent answer it, and the agent's message then says it was answered", async () => {
  const shown = threadItem([askingMessage({ type: INBOX_ASK.ANSWER })]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000015"));
  assert.deepEqual(draftReply(pane), ["You"], "no controls stand in the box");
  assert.equal(pane.querySelector("[data-inbox-draft-ask]"), null, "and no Answer press");
  assert.deepEqual(boxParts(pane), ["line: Reply", "row: Attach files, Dictate, Send"]);
  assert.equal(answerSend(pane).disabled, true, "an empty box sends nothing");
  assert.equal(footWords(pane), "");

  typeInComposer(pane, "Nothing needs you right now.");
  assert.equal(answerSend(pane).disabled, false, "words light Send");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "Nothing needs you right now.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED },
      },
    ],
  );
  assert.equal(askMarker(pane), null, "the ask waits no more");
  assert.equal(
    wordsOf(pane.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Answered",
  );
  assert.deepEqual(draftReply(pane), ["You"]);
});

test("a form's fields attach to the reply as they are filled, with no Submit, and a form filled in part sends what was filled, a required field left empty absent from it", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
        { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      ],
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  assert.deepEqual(
    [...pane.querySelectorAll("[data-inbox-draft-ask] button")].map((button) => button.textContent),
    ["Low", "High"],
    "the draft's box holds the ask's fields and no Submit",
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "the note line stands on its own under the form, over the row of presses",
  );
  assert.equal(sendWords(pane), "Send");

  const reason =
    [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
      (each) => each.dataset.inboxFieldLabel === "Reason",
    ) ?? assert.fail("no Reason field");
  typeInComposer(reason, "Spiked twice");
  await settle();
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: ASKING_ID,
        reply: INBOX_REPLY.SUBMITTED,
        values: [{ label: "Reason", value: "Spiked twice" }],
      },
    ],
  );
});

test("a thread's form ask wears the Recommended badge on the option its select recommends and on no other, and picks nothing for the developer", async () => {
  const pane = await mountThread(
    threadItem([
      askingMessage({
        type: INBOX_ASK.ANSWER,
        fields: [
          {
            type: INBOX_FIELD.SELECT,
            label: "Channel",
            options: ["Email", "Slack"],
            recommended: "Slack",
          },
          { type: INBOX_FIELD.SELECT, label: "Severity", options: ["Low", "High"] },
        ],
      }),
    ]),
  );
  assert.deepEqual(readSegmented(segmentedGroup(pane, "Channel")), {
    options: ["Email", "SlackRecommended"],
    checked: [],
    tabStops: ["Email"],
  });
  assert.deepEqual(readSegmented(segmentedGroup(pane, "Severity")).options, ["Low", "High"]);
});

test("a to-do's steps are ticked in the draft reply, Mark done needs none ticked and ticks every one, either press pressed again is let go, and Mark done sent carries every step; one naming no step stands its item's title as its one step", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the repository's settings", "Add the secret"],
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  const steps = () => [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")];
  assert.equal(askPress(pane, "Mark done").disabled, false, "Mark done waits for no tick");
  assert.equal(askMarker(pane), null);
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(answerSend(pane).disabled, true, "nothing ticked, nothing to send");

  act(() => steps()[0]?.click());
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Mark done").click());
  assert.deepEqual(
    steps().map((step) => step.checked),
    [true, true],
    "Mark done ticks the step left unticked",
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Couldn't do it").click());
  assert.deepEqual(
    steps().map((step) => step.checked),
    [true, false],
    "Couldn't do it after Mark done keeps only the step ticked by hand",
  );
  act(() => askPress(pane, "Couldn't do it").click());
  assert.equal(askPress(pane, "Couldn't do it").getAttribute("aria-pressed"), "false");
  assert.equal(
    answerSend(pane).disabled,
    false,
    "pressed again, it is let go, the step ticked still sent",
  );
  act(() => askPress(pane, "Mark done").click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1] }],
  );
  const reply =
    pane.querySelector(".inbox-thread > li:nth-last-child(2)") ?? assert.fail("the reply");
  assert.equal(
    answeredCard(reply),
    "Open the repository's settingsAdd the secretMark doneCouldn't do it",
  );
  assert.deepEqual(
    answeredPresses(
      reply.querySelector<HTMLElement>("[data-inbox-answered]") ?? assert.fail("the card"),
    ),
    [
      ["Mark done", true, "ahead"],
      ["Couldn't do it", false, undefined],
    ],
  );

  act(() => root?.unmount());
  root = undefined;
  const legacy = await mountThread(threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })]));
  assert.deepEqual(
    [...legacy.querySelectorAll("[data-inbox-step]")].map((step) => step.textContent),
    ["How long should invites last?"],
  );
});

test("a to-do with every step ticked by hand stands marked done and Send sends it so, letting a step go takes that back off, and steps ticked with neither press go as they stand", async () => {
  const toDo = { type: INBOX_ASK.DO, steps: ["Open the repository's settings", "Add the secret"] };
  const shown = threadItem([askingMessage(toDo)]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  const steps = () => [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")];
  const markDone = () => askPress(pane, "Mark done").getAttribute("aria-pressed");

  act(() => steps()[0]?.click());
  act(() => steps()[1]?.click());
  assert.equal(markDone(), "true", "every step ticked stands as Mark done");
  assert.equal(answerSend(pane).disabled, false, "the reply carries the answer");
  act(() => steps()[1]?.click());
  assert.equal(markDone(), "false", "letting a step go takes Mark done back off");
  assert.equal(answerSend(pane).disabled, false, "the step still ticked goes with the reply");
  act(() => steps()[0]?.click());
  assert.equal(answerSend(pane).disabled, true, "nothing ticked, nothing to send");
  assert.equal(footWords(pane), "");
  act(() => steps()[0]?.click());
  act(() => steps()[1]?.click());
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1] }],
    "Reply sends Mark done with every step, no press needed",
  );

  act(() => root?.unmount());
  root = undefined;
  const partly = threadItem([askingMessage(toDo)]);
  const second = await mountThread(partly);
  const sentPartly = heldMessages(repliedOn(partly, "e1b2c3d4-0000-4000-8000-000000000013"));
  act(() => second.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")[1]?.click());
  assert.equal(askPress(second, "Couldn't do it").getAttribute("aria-pressed"), "false");
  act(() =>
    second.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(
    sentPartly.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED, steps: [1] }],
    "the step ticked goes as it stands, never as Couldn't do it",
  );

  act(() => root?.unmount());
  root = undefined;
  const titled = threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })]);
  const third = await mountThread(titled);
  act(() => third.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  assert.equal(
    askPress(third, "Mark done").getAttribute("aria-pressed"),
    "true",
    "ticking a to-do's title, its one step, marks it done",
  );
});

test("a replaced ask draws no card: its controls as it offered them, dimmed, nothing picked and taking nothing, over a quiet marker saying a newer question replaced it, or a newer message where none asks; a withdrawn one says why, and one withdrawn with no reason names the member who closed the item", async () => {
  const shown = threadItem(
    [
      askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.REPLACED }),
      askingMessage(EXPIRY_ASK, {
        id: "e1b2c3d4-0000-4000-8000-000000000020",
        status: INBOX_ASK_STATUS.WITHDRAWN,
        withdrawnReason: "Product picked 14 days.",
        createdAt: 2_000,
      }),
      askingMessage(EXPIRY_ASK, {
        id: "e1b2c3d4-0000-4000-8000-000000000021",
        status: INBOX_ASK_STATUS.WITHDRAWN,
        createdAt: 3_000,
      }),
    ],
    { status: INBOX_STATUS.CLOSED, closedBy: TEAMMATE, settledAt: 3_500 },
  );
  const pane = await mountThread(shown);

  assert.deepEqual(askBoxes(pane), [
    ["withdrawn", "Pick oneWithdrawn: Product picked 14 days."],
    ["withdrawn", "Pick oneCharles Pan · Resolved without an answer"],
  ]);
  assert.equal(
    pane.querySelector(".inbox-ask [role='radio']"),
    null,
    "a settled ask offers nothing",
  );
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  const replaced =
    pane.querySelector(`[data-message-id="${ASKING_ID}"]`) ??
    assert.fail("the replaced ask's message");
  assert.equal(replaced.querySelector(".inbox-ask"), null, "the replaced ask draws no card");
  const offered =
    replaced.querySelector<HTMLElement>("[data-inbox-replaced] .inbox-ask-replaced-controls") ??
    assert.fail("the replaced ask keeps its controls");
  const options = [...offered.querySelectorAll<HTMLElement>("[role='radio']")];
  assert.deepEqual(
    options.map((option) =>
      ["1 day", "7 days", "30 days"].some((label) => wordsOf(option)?.includes(label)),
    ),
    [true, true, true],
    "every option it offered still reads",
  );
  assert.ok(wordsOf(offered)?.includes("What most teams use."), "with its detail");
  assert.deepEqual(
    options.map((option) => option.getAttribute("aria-checked")),
    ["false", "false", "false"],
    "none of them picked",
  );
  act(() => options[1]?.click());
  assert.equal(options[1]?.getAttribute("aria-checked"), "false", "and a press picks nothing");
  assert.equal(
    replaced
      .querySelector("[data-inbox-replaced] > :last-child")
      ?.getAttribute("data-inbox-settled"),
    "replaced",
    "the marker stands under them",
  );
  assert.deepEqual(
    [...replaced.querySelectorAll<HTMLElement>("[data-inbox-settled]")].map((marker) => [
      marker.dataset.inboxSettled,
      wordsOf(marker),
    ]),
    [["replaced", "Replaced by a newer question"]],
    "the agent's message ends with the marker saying so",
  );
  assert.equal(
    pane.querySelectorAll("[data-inbox-settled]").length,
    1,
    "no withdrawn ask wears the marker",
  );

  act(() => root?.unmount());
  root = undefined;
  const noticed = await mountThread(
    threadItem([
      askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.REPLACED }),
      threadMessage("e1b2c3d4-0000-4000-8000-000000000022", "agent", "Deploy finished.", 2_000),
    ]),
  );
  assert.equal(
    wordsOf(noticed.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Replaced by a newer message",
    "an ask replaced by a message that asks nothing names no newer question",
  );

  act(() => root?.unmount());
  root = undefined;
  const toDo = await mountThread(
    threadItem([
      askingMessage(
        { type: INBOX_ASK.DO, steps: ["Open the repository's settings", "Add the secret"] },
        { status: INBOX_ASK_STATUS.REPLACED },
      ),
    ]),
  );
  const steps = [
    ...toDo.querySelectorAll<HTMLInputElement>(
      `[data-message-id="${ASKING_ID}"] [data-inbox-replaced] [data-inbox-step] input`,
    ),
  ];
  assert.deepEqual(
    steps.map((step) => step.checked),
    [false, false],
    "a replaced to-do keeps its steps, none ticked",
  );

  act(() => root?.unmount());
  root = undefined;
  const titled = await mountThread(
    threadItem([
      askingMessage({ type: INBOX_ASK.DO, steps: [] }, { status: INBOX_ASK_STATUS.REPLACED }),
    ]),
  );
  assert.equal(
    titled.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-replaced]`),
    null,
    "a replaced to-do naming no steps keeps no controls, since the title it drew as its step may have been renamed since",
  );

  act(() => root?.unmount());
  root = undefined;
  const words = await mountThread(
    threadItem([askingMessage({ type: INBOX_ASK.ANSWER }, { status: INBOX_ASK_STATUS.REPLACED })]),
  );
  const asked = words.querySelector(`[data-message-id="${ASKING_ID}"]`);
  assert.equal(
    asked?.querySelector("[data-inbox-replaced]"),
    null,
    "an ask of words alone has no controls to keep",
  );
  assert.equal(
    wordsOf(asked?.querySelector("[data-inbox-settled]") ?? null),
    "Replaced by a newer message",
    "and ends with the marker alone",
  );
});

/** The reader's reply answering the ask the thread opens with, as the service keeps it. */
const ANSWER_ID = "e1b2c3d4-0000-4000-8000-000000000030";

/** An item whose opening ask the reader answered with `answers` and `text`, the item answered and the ask so, then any `after` it. */
function answeredThread(
  ask: InboxAsk,
  answers: Omit<NonNullable<InboxMessage["answers"]>, "ask">,
  text = "",
  after: readonly InboxMessage[] = [],
): InboxItem {
  return threadItem(
    [
      askingMessage(ask, { status: INBOX_ASK_STATUS.ANSWERED }),
      {
        ...threadMessage(ANSWER_ID, { member: READER }, text, 2_000),
        answers: { ask: ASKING_ID, ...answers },
      },
      ...after,
    ],
    { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: 2_000 },
  );
}

/** The answered ask's card's controls, as the answer left them, heading the reply that answered it. */
function answeredBox(pane: HTMLElement): HTMLElement {
  return (
    pane.querySelector<HTMLElement>(
      `[data-message-id="${ANSWER_ID}"] .inbox-comment-body > [data-inbox-answered]`,
    ) ?? assert.fail("the reply leads with the ask's controls filled in")
  );
}

/** Each press of an answered box, by its words, whether it was the one given, and its glyph's tone where it wears one; every one read-only. */
function answeredPresses(box: HTMLElement): (string | boolean | undefined)[][] {
  return [...box.querySelectorAll<HTMLButtonElement>(".inbox-ask-presses button")].map((press) => {
    assert.equal(press.disabled, true, "a press given takes no press");
    assert.equal(press.dataset.readOnly, "true", "and stands at full strength, not faded");
    return [
      press.textContent ?? "",
      press.getAttribute("aria-pressed") === "true",
      press.querySelector<HTMLElement>(".inbox-ask-pressed")?.dataset.tone,
    ];
  });
}

test("an answered decide's card leaves the agent's message for the head of the reply that answered it, under the answerer's name: its options as they were offered, read-only, the pick checked and no head over them, in place of the reply's stamp; a number key still picks the open ask's option below it", async () => {
  const later = "e1b2c3d4-0000-4000-8000-000000000031";
  const shown = answeredThread(EXPIRY_ASK, { reply: INBOX_REPLY.CHOSE, choices: ["7 days"] }, "", [
    askingMessage(EXPIRY_ASK, { id: later, createdAt: 3_000 }),
  ]);
  const pane = await mountThread({ ...shown, status: INBOX_STATUS.OPEN });

  assert.deepEqual(askBoxes(pane), []);
  assert.equal(askMarker(pane), null, "the later ask waits on the reader, which draws no marker");
  const asked =
    pane.querySelector(`[data-message-id="${ASKING_ID}"]`) ?? assert.fail("the agent's message");
  assert.equal(asked.querySelector(".inbox-ask"), null, "the agent's message ends with its words");
  const reply = pane.querySelector(`[data-message-id="${ANSWER_ID}"]`) ?? assert.fail("the reply");
  assert.equal(wordsOf(reply.querySelector(".inbox-comment-name")), "You", "the answerer heads it");
  const box = answeredBox(pane);
  const rows = [...box.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(
    rows.map((row) => [wordsOf(row), row.getAttribute("aria-checked"), row.disabled]),
    [
      ["1 dayAs today.", "false", true],
      ["7 daysRecommendedWhat most teams use.", "true", true],
      ["30 days", "false", true],
    ],
    "each row as offered, unnumbered, the pick checked and none pressable",
  );
  assert.equal(box.querySelector<HTMLElement>(".luke-choice-list")?.dataset.readOnly, "true");
  assert.equal(
    reply.querySelector("[data-inbox-stamp]"),
    null,
    "the card stands in the stamp's place",
  );

  keyOn(document.body, "3");
  const open = pane.querySelector("[data-inbox-draft-ask]") ?? assert.fail("the open ask");
  const openRows = [...open.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.equal(openRows[2]?.getAttribute("aria-checked"), "true", "3 picks the open ask's third");
  assert.equal(document.activeElement, openRows[2], "and takes the keyboard there");
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-checked")),
    ["false", "true", "false"],
    "the answered box stands as it was",
  );
});

test("an answered yes-or-no heads its reply with its two small buttons, the one pressed marked in its tone and neither pressable", async () => {
  const pane = await mountThread(
    answeredThread(
      { type: INBOX_ASK.DECIDE, options: [{ label: "Approve" }, { label: "Request changes" }] },
      { reply: INBOX_REPLY.CHOSE, choices: ["Request changes"] },
      "The banner overlaps the header.",
    ),
  );

  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(answeredPresses(answeredBox(pane)), [
    ["Approve", false, undefined],
    ["Request changes", true, "back"],
  ]);
  assert.equal(answeredBox(pane).querySelector('[role="radio"]'), null, "no radio list stands");
});

test("an answered do heads its reply with its steps ticked as they were sent, over Mark done and Couldn't do it with the one pressed marked, none of them taking a press; one naming no step ticks its title's where it was marked done", async () => {
  const pane = await mountThread(
    answeredThread(
      {
        type: INBOX_ASK.DO,
        steps: ["Open the repository's settings", "Add the secret", "Re-run the deploy"],
      },
      { reply: INBOX_REPLY.NOT_DONE, steps: [0] },
      "The secret page 404s.",
    ),
  );
  const box = answeredBox(pane);
  const steps = () =>
    [...box.querySelectorAll<HTMLElement>("[data-inbox-step]")].map((step) => {
      const tick = step.querySelector<HTMLInputElement>("input") ?? assert.fail("a step's box");
      assert.equal(tick.getAttribute("aria-readonly"), "true");
      return [step.textContent, tick.checked];
    });

  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(steps(), [
    ["Open the repository's settings", true],
    ["Add the secret", false],
    ["Re-run the deploy", false],
  ]);
  act(() => box.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")[1]?.click());
  assert.deepEqual(steps()[1], ["Add the secret", false], "a press ticks nothing");
  assert.deepEqual(answeredPresses(box), [
    ["Mark done", false, undefined],
    ["Couldn't do it", true, "back"],
  ]);

  act(() => root?.unmount());
  root = undefined;
  const legacy = await mountThread(
    answeredThread({ type: INBOX_ASK.DO, steps: [] }, { reply: INBOX_REPLY.DONE, steps: [] }),
  );
  const legacyBox = answeredBox(legacy);
  assert.deepEqual(
    [...legacyBox.querySelectorAll<HTMLElement>("[data-inbox-step]")].map((step) => [
      step.textContent,
      step.querySelector("input")?.checked,
    ]),
    [["How long should invites last?", true]],
  );
  assert.deepEqual(answeredPresses(legacyBox), [
    ["Mark done", true, "ahead"],
    ["Couldn't do it", false, undefined],
  ]);
});

test("an answered form heads its reply with its fields, each holding what it was given and one left empty standing empty, a text field's mention as its chip, with no Submit and no list on the reply repeating the values", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const pane = await mountThread(
    answeredThread(
      {
        type: INBOX_ASK.ANSWER,
        fields: [
          { type: INBOX_FIELD.SELECT, label: "Effort", options: ["high", "xhigh"], required: true },
          { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
          { type: INBOX_FIELD.NUMBER, label: "Retries", required: true },
          { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        ],
      },
      {
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Effort", value: "xhigh" },
          { label: "Reason", value: `See ${file}` },
          { label: "Page on-call", value: true },
        ],
      },
    ),
  );
  const box = answeredBox(pane);

  assert.deepEqual(answeredFields(box), [
    ["select", "Effort", "xhigh"],
    ["text", "Reason", "See rollout-store.ts"],
    ["number", "Retries", ""],
    ["boolean", "Page on-call", "checked"],
  ]);
  assert.equal(box.querySelector("[data-mention-ref]")?.textContent, "rollout-store.ts");
  assert.equal(box.querySelector(".inbox-ask-presses"), null, "no Submit stands");
  assert.equal(pane.querySelector("[data-inbox-values]"), null, "the reply lists no values");
  assert.deepEqual(askBoxes(pane), []);
  assert.equal(pane.querySelector("[data-inbox-stamp]"), null);
});

test("an answered ask of words alone draws no card, its reply just its words and the agent's message ending with a small Answered marker, among other replies; one whose reply the thread read no longer carries stays in the agent's message saying it was answered, and an answer whose ask it no longer carries leads with its stamp and lists its values", async () => {
  const words = await mountThread(
    answeredThread(
      { type: INBOX_ASK.ANSWER },
      { reply: INBOX_REPLY.ANSWERED },
      "Use the staging bucket.",
      [threadMessage("e1b2c3d4-0000-4000-8000-000000000032", { member: READER }, "Thanks!", 3_000)],
    ),
  );
  assert.deepEqual(askBoxes(words), [], "no card stands anywhere");
  const reply =
    words.querySelector(`[data-message-id="${ANSWER_ID}"]`) ?? assert.fail("the answering reply");
  assert.equal(
    wordsOf(reply.querySelector(".inbox-comment-body")),
    "Use the staging bucket.",
    "the reply is just its words",
  );
  assert.equal(
    wordsOf(words.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Answered",
    "the agent's message says its ask was answered",
  );
  assert.equal(words.querySelectorAll("[data-inbox-settled]").length, 1, "and no reply does");

  act(() => root?.unmount());
  root = undefined;
  const cut = await mountThread(
    threadItem([askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.ANSWERED })], {
      status: INBOX_STATUS.ANSWERED,
      answeredBy: READER,
      settledAt: 2_000,
    }),
  );
  assert.deepEqual(askBoxes(cut), [["answered", "Pick oneAnswered"]]);
  assert.ok(
    cut.querySelector(`[data-message-id="${ASKING_ID}"] .inbox-ask`),
    "in the agent's message",
  );
  assert.equal(cut.querySelector("[data-inbox-answered]"), null, "nothing is drawn filled in");

  act(() => root?.unmount());
  root = undefined;
  const orphan = await mountThread(
    threadItem([
      threadMessage("e1b2c3d4-0000-4000-8000-000000000040", "agent", "Thanks.", 1_000),
      {
        ...threadMessage(ANSWER_ID, { member: READER }, "", 2_000),
        answers: {
          ask: "e1b2c3d4-0000-4000-8000-000000000099",
          reply: INBOX_REPLY.SUBMITTED,
          values: [{ label: "Effort", value: "high" }],
        },
      },
      askingMessage(EXPIRY_ASK, { createdAt: 3_000 }),
    ]),
  );
  assert.equal(
    wordsOf(orphan.querySelector(`[data-message-id="${ANSWER_ID}"] [data-inbox-values]`)),
    "Efforthigh",
  );
  assert.equal(
    orphan.querySelector(`[data-message-id="${ANSWER_ID}"] [data-inbox-stamp]`)?.textContent,
    "Submitted",
  );
});

test("an ask of a type this build does not know reads as a line naming a newer Luke, saying which teammate it waits on while open and nothing more where it waits on the reader, and the box still replies", async () => {
  const poll = Schema.decodeUnknownSync(inboxReadAskSchema)({ type: "poll", status: "open" });
  const asking = { ...askingMessage(EXPIRY_ASK), ask: poll };
  const pane = await mountThread(threadItem([asking]));
  assert.deepEqual(askBoxes(pane), [["newer", "Answer this in a newer Luke."]]);
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  assert.equal(sendWords(pane), "Send");
});

test("an ask of a type this build does not know, open on a teammate's item, names the teammate it waits on", async () => {
  const poll = Schema.decodeUnknownSync(inboxReadAskSchema)({ type: "poll", status: "open" });
  const pane = await mountThread(
    threadItem([{ ...askingMessage(EXPIRY_ASK), ask: poll }], { startedBy: TEAMMATE }),
  );
  assert.deepEqual(askBoxes(pane), [
    ["newer", "Answer this in a newer Luke.Waiting on Charles Pan"],
  ]);
});

test("an item from before version 5, its question in its blocks and its thread asking nothing, still draws its question and is answered as before", async () => {
  const note = threadMessage(
    "e1b2c3d4-0000-4000-8000-000000000030",
    { member: TEAMMATE },
    "Is 80% too eager?",
    2_500,
  );
  const shown: InboxItem = {
    ...THRESHOLD,
    blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Usage alerts fire at a threshold." }],
    messages: [note],
    thread: [note],
  };
  const pane = await mountThread(shown);
  const answers = heldAnswers();
  assert.deepEqual(threadOf(pane.ownerDocument.body), [
    ["asked", "agent", "Alerts", null],
    ["message", "person", "Charles Pan", "Is 80% too eager?"],
  ]);
  assert.equal(pane.querySelector(".inbox-ask"), null);
  assert.equal(askMarker(pane), null);
  assert.deepEqual(draftReply(pane), ["You", "controls"]);

  act(() => openOptions(pane)[1]?.click());
  act(() => answerSend(pane).click());
  await settle();
  assert.deepEqual(
    answers.map(({ reply, choices }) => ({ reply, choices })),
    [{ reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] }],
  );
});

test("the steps ticked and the answer pressed are the item's draft, standing again when the reader comes back to it from another item", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the repository's settings", "Add the secret"],
    }),
  ]);
  const pane = await mountThread(shown);
  const page = pane.ownerDocument.body;
  const ticked = () =>
    [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")].map(
      (box) => box.checked,
    );
  act(() => pane.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  act(() => askPress(pane, "Couldn't do it").click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, shown.title).click());
  await settle();

  assert.deepEqual(ticked(), [true, false]);
  assert.equal(askPress(pane, "Couldn't do it").getAttribute("aria-pressed"), "true");
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("the reader's own open ask draws no waiting marker anywhere in the thread, its draft reply holding the ask's controls", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  assert.equal(askMarker(pane), null);
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  assert.doesNotMatch(
    pane.querySelector(".inbox-thread")?.textContent ?? assert.fail("the thread"),
    /Waiting on/u,
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
});

test("a teammate's open ask says on its marker that it waits on them, rather than on you, and still takes your answer in your draft reply", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)], { startedBy: TEAMMATE }));
  assert.deepEqual(subjectParts(pane), ["How long should invites last?"]);
  assert.equal(askMarker(pane), "Waiting on Charles Pan");
  act(() => openOptions(pane)[0]?.click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("a thread's row says the ask itself while one is open, led by its kind's glyph: the steps left and the next as the reader ticks them in its box, the fields, or an answer to write; a teammate's waits on them with no mark, and an answer reads as its stamp, led by a tick", async () => {
  const STEPS = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the settings", "Add the secret", "Redeploy"],
    }),
  ]);
  const FIELDS: InboxItem = {
    ...threadItem([
      askingMessage(
        { type: INBOX_ASK.ANSWER, fields: [{ type: INBOX_FIELD.TEXT, label: "Host" }] },
        { id: "e1b2c3d4-0000-4000-8000-000000000021" },
      ),
    ]),
    id: "a1b2c3d4-0000-4000-8000-000000000021",
    title: "Which SMTP host?",
    startedBy: TEAMMATE,
  };
  const asked = askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.ANSWERED });
  const CHOSEN: InboxItem = {
    ...threadItem([
      asked,
      {
        ...threadMessage(
          "e1b2c3d4-0000-4000-8000-000000000022",
          { member: READER },
          "and say so in the docs",
          2_000,
        ),
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
      },
    ]),
    id: "a1b2c3d4-0000-4000-8000-000000000022",
    title: "Invite window?",
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
  };
  inboxes = new Map([
    [BILLING.id, [STEPS, FIELDS, CHOSEN]],
    [
      INVITES.id,
      [threadItem([askingMessage({ type: INBOX_ASK.ANSWER })], { ...EXPIRY, blocks: [] })],
    ],
  ]);
  const { page } = mount();
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "3 steps left · Open the settings"]);
  assert.deepEqual(rowLines(page, FIELDS.title), [true, "Fill in Host"]);
  assert.deepEqual(rowLines(page, EXPIRY.title), [true, "Write an answer"]);
  assert.deepEqual(rowLines(page, CHOSEN.title), [
    true,
    "You: Chose 7 days · and say so in the docs",
  ]);
  const glyphOf = (title: string) =>
    rowNamed(page, title).querySelector(".inbox-row-line")?.getAttribute("data-line");
  assert.deepEqual([STEPS.title, FIELDS.title, CHOSEN.title].map(glyphOf), [
    "do",
    "answer",
    "settled",
  ]);
  assert.equal(needsYouMark(rowNamed(page, STEPS.title)), "*");
  assert.equal(needsYouMark(rowNamed(page, FIELDS.title)), "", "a teammate's ask needs them");
  assert.equal(
    rowNamed(page, FIELDS.title)
      .querySelector(".luke-list-row-meta .actor-mark")
      ?.getAttribute("data-kind"),
    "person",
  );
  assert.equal(needsYouMark(rowNamed(page, CHOSEN.title)), "", "an answered ask waits on nobody");

  // A step ticked in the item's box is counted on its row once another item is chosen.
  act(() => rowNamed(page, STEPS.title).click());
  await settle();
  act(() => itemPane(page).querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  act(() => rowNamed(page, CHOSEN.title).click());
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "2 steps left · Add the secret"]);

  // Mark done pressed in the box ticks every step on the row and its card, as the box shows them.
  act(() => rowNamed(page, STEPS.title).click());
  await settle();
  act(() => askPress(itemPane(page), "Mark done").click());
  act(() => rowNamed(page, CHOSEN.title).click());
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "Every step ticked · Mark done"]);
  hoveredCard(rowNamed(page, STEPS.title), "[data-inbox-row-card]");
  assert.deepEqual(
    [
      ...document.querySelectorAll(
        '.luke-tooltip-card [data-inbox-row-card] ul[aria-label="Steps"] > li',
      ),
    ].map((step) => step.getAttribute("data-done")),
    ["true", "true", "true"],
  );
});

test("an item's card shows a to-do naming no steps of its own its title as its one step, as its box does", async () => {
  const ROTATE = threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })], {
    title: "Rotate the deployment key",
  });
  inboxes = new Map([[BILLING.id, [ROTATE]]]);
  const { page } = mount();
  await settle();
  hoveredCard(rowNamed(page, ROTATE.title), "[data-inbox-row-card]");
  assert.deepEqual(
    [
      ...document.querySelectorAll(
        '.luke-tooltip-card [data-inbox-row-card] ul[aria-label="Steps"] > li',
      ),
    ].map((step) => step.textContent),
    ["Rotate the deployment key"],
  );
});

test("with the inbox-first sidebar the sidebar lists the Inbox's items, read once with the page, and the page shows the chosen item alone, a press on a row choosing it", async () => {
  const { page } = mount([], { sidebar: true });
  await settle();
  const sidebar =
    page.querySelector("aside.desktop-sidebar") ?? assert.fail("the sidebar is drawn");
  assert.ok(
    sidebar.querySelector('.inbox-tasks[data-placement="sidebar"]'),
    "the sidebar lists the Inbox",
  );
  assert.equal(
    page.querySelector("main .inbox-tasks"),
    null,
    "the page draws no list of its own beside the item",
  );
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?"]);
  assert.equal(
    rowNamed(page, "Expire after 7 days?").getAttribute("aria-current"),
    "page",
    "the item shown is the sidebar's current row",
  );
  assert.equal(
    page.querySelector('main .inbox-view-items header button[aria-label="Back to Inbox"]'),
    null,
    "the item offers no way back to a list that stays in sight",
  );
});

test("with the inbox-first sidebar the item shown stands alone for the window's history and links, and an item a link names that no read holds is not found in the place, the sidebar's list choosing nothing", async () => {
  toldSingle = [];
  const { page } = mount([], { sidebar: true });
  await settle();
  // Note that before an item stands the Inbox is told no column, since a list step there would be one no column shows, and Back would land on it.
  assert.equal(toldSingle[0], false, "no list step stands before the first item");
  assert.equal(toldSingle.at(-1), true, "the item stands alone, whatever the room's width");
  act(() =>
    chooseFromOutside({
      taskId: "0f0e0d0c-0000-4000-8000-00000000dead",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();
  const place = page.querySelector<HTMLElement>("main .inbox-view-items");
  assert.ok(place !== null && !place.hidden, "the place stands in sight");
  assert.match(place.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

/** Types `words` into the list's search, as a reader's keys put them in its field. */
function searchList(page: HTMLElement, words: string): void {
  const input = page.querySelector<HTMLInputElement>(
    '.inbox-tasks input[aria-label="Search inbox"]',
  );
  assert.ok(input, "the search stands open");
  // Note that the value goes in through the prototype's setter, because React tracks the field's own.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The magnifier in the list's head that opens its search. */
function magnifier(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>('.inbox-tasks button[aria-label="Search inbox"]');
}

/** The title of the item the pane shows. */
function paneTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items .inbox-subject-title")?.textContent;
}

test("the list's magnifier opens a search in the Inbox's name that narrows the list to the items saying every word typed, the item open leaving the list but not the pane; Escape empties and folds it, handing the keyboard back to the magnifier", async () => {
  const { page } = mount();
  await settle();
  const title = headTitle(page);
  const button = magnifier(page);
  assert.ok(button, "the head offers the search");

  act(() => button.click());
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Search inbox");
  assert.equal(headTitle(page), undefined, "the field stands in the name");

  // Note that the retry question is found by its answer's note, which only its thread holds.
  searchList(page, "on-call");
  assert.deepEqual(listed(page), ["# Billing usage alerts", "How is a failed email retried?"]);
  assert.equal(paneTitle(page), "Alert at 80%?", "the pane keeps the item open");

  searchList(page, "zzz");
  assert.deepEqual(listed(page), []);
  assert.ok(page.querySelector(".inbox-tasks")?.textContent?.includes("No items match “zzz”."));

  const input = document.activeElement;
  assert.ok(input instanceof HTMLInputElement);
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(headTitle(page), title);
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "How is a failed email retried?",
    "▸ *Alert at 80%?",
    "# Invites",
    "*Expire after 7 days?",
  ]);
  assert.equal(document.activeElement, magnifier(page));
});

test("with the inbox-first sidebar, the sidebar's list head offers the same search, which narrows the sidebar's list", async () => {
  const { page } = mount([], { sidebar: true });
  await settle();
  const button = page.querySelector<HTMLButtonElement>(
    '.desktop-sidebar .sidebar-section-head button[aria-label="Search inbox"]',
  );
  assert.ok(button, "the sidebar's head offers the search");

  act(() => button.click());
  searchList(page, "expire");

  assert.deepEqual(listed(page), ["# Invites", "*Expire after 7 days?"]);
});

test("with the inbox-first sidebar, a press on View options while the search stands empty folds the search and opens the menu at once", async () => {
  const { page } = mount([], { sidebar: true });
  await settle();
  const button = page.querySelector<HTMLButtonElement>(
    '.desktop-sidebar .sidebar-section-head button[aria-label="Search inbox"]',
  );
  assert.ok(button, "the sidebar's head offers the search");
  act(() => button.click());
  const options = page.querySelector<HTMLButtonElement>(
    '.desktop-sidebar .sidebar-section-head button[aria-label="View options"]',
  );
  assert.ok(options, "the head keeps the view's menu beside the field");

  // Note that the press moves the focus first, which folds the empty search before the click lands.
  act(() => options.focus());
  act(() => options.click());

  assert.equal(options.isConnected, true, "the button pressed is the one still standing");
  assert.equal(viewItem("To do").getAttribute("role")?.startsWith("menuitem"), true);
});
