// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AutomationSummary } from "@luke/features/automation-wire";
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
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAsk,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  inboxReadAskSchema,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import { TASK_SKILL_SOURCE, TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import { pasteCutWords } from "@luke/features/words";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { DocumentIcon } from "@luke/ui";
import { isTranscriptTab } from "@luke/ui/tab-strip-model";
import type { TaskMark } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Effect, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, onTestFinished, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { useAppKeymap } from "../app-commands.js";
import { useDraftsOwner } from "../composer-drafts.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  firstChoice,
  INBOX_SHOW,
  type InboxShow,
  inboxList,
  taskHolder,
  tasklessGroups,
} from "../tasks/inbox-model.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice } from "../tasks/use-tasks-tab.js";
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
import { attachmentChipName } from "../testing/attachment-chip.js";
import { CHANNEL_PROCEDURES } from "../testing/channels.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pasteInComposer,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { readSegmented, segment, segmentedGroup } from "../testing/segmented.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { ToastHost } from "../toast.js";
import { DesktopInbox } from "./desktop-inbox.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Where the window's Inbox keeps the scope it shows, and where its Needs you button kept its press before the tabs that stood before its scopes. */
const SHOW_KEY = "luke.inboxShow";
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

/** The retry choice the agent asks on its items, two options, the first recommended. */
const RETRY_ASK: InboxAsk = {
  type: INBOX_ASK.DECIDE,
  options: [
    { label: "Retry 3 times over an hour", detail: "Backs off 5, 15, then 40 minutes." },
    { label: "Retry once" },
  ],
  recommended: "Retry 3 times over an hour",
};

/** The id of the agent's message opening the item given, which asks its choice. */
function askIdOf(itemId: string): string {
  return `f${itemId.slice(1)}`;
}

/** An item of the agent's, open, its thread the agent's one message asking a choice, as the service answers one. */
function item(id: string, title: string, updatedAt: number): InboxItem {
  return {
    id,
    agentId: AGENT.id,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: askIdOf(id),
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "A failed email is retried as the agent sets it up.",
        ask: { ...RETRY_ASK, status: INBOX_ASK_STATUS.OPEN },
        createdAt: 1_000,
      },
    ],
    postedAt: 1_000,
    updatedAt,
  };
}

const THRESHOLD = item("a1b2c3d4-0000-4000-8000-000000000001", "Alert at 80%?", 3_000);
/** The account reading the Inbox, who answered the retry question themselves. */
const READER = { userId: "user-reader", name: "Dana Reyes" };

/** The item given answered by the member given, their reply picking `choice` with the words given, at `at`. */
function answeredBy(
  asked: InboxItem,
  member: typeof READER,
  choice: string,
  text: string,
  at: number,
): InboxItem {
  const [asking] = asked.thread ?? [];
  assert.ok(asking?.ask !== undefined, "the item opens with its ask");
  return {
    ...asked,
    status: INBOX_STATUS.ANSWERED,
    settledAt: at,
    answeredBy: member,
    thread: [
      { ...asking, ask: { ...asking.ask, status: INBOX_ASK_STATUS.ANSWERED } },
      {
        id: `d${asked.id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.MEMBER,
        member,
        text,
        answers: { ask: asking.id, reply: INBOX_REPLY.CHOSE, choices: [choice] },
        createdAt: at,
      },
    ],
  };
}

const RETRY: InboxItem = answeredBy(
  item("a1b2c3d4-0000-4000-8000-000000000002", "How is a failed email retried?", 5_000),
  READER,
  "Retry 3 times over an hour",
  "And page on-call if all three fail.",
  5_000,
);
const EXPIRY = item("a1b2c3d4-0000-4000-8000-000000000003", "Expire after 7 days?", 4_000);

/** The item given as a notice: its opening message asking nothing. */
function noticeOf(asked: InboxItem): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  const { ask: _ask, ...said } = opening;
  return { ...asked, thread: [said, ...rest] };
}

/** The item given with its opening message asking `ask` instead, open. */
function asking(asked: InboxItem, ask: InboxAsk): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  return {
    ...asked,
    thread: [{ ...opening, ask: { ...ask, status: INBOX_ASK_STATUS.OPEN } }, ...rest],
  };
}

/** The item given with its opening message's words, and the files it carried, as given; its ask as it was. */
function saying(asked: InboxItem, text: string, files?: InboxMessage["files"]): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  return {
    ...asked,
    thread: [{ ...opening, text, ...(files === undefined ? undefined : { files }) }, ...rest],
  };
}

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
/** Chooses an item from outside the list, as a notification's click does. */
let chooseFromOutside: (chosen: InboxChoice) => void = () => undefined;

/**
 * The thread a mount opens first, as a notification of it would: the first
 * item For you lists of the holder whose item changed latest, of the tasks
 * listed and the agents with no task given, else the first listed; none
 * where nothing is held.
 */
function firstOpened(
  tasks: readonly TaskSummary[],
  taskless: readonly AppInboxTasklessItem[],
  readerId: string | undefined,
): InboxChoice | undefined {
  const groups = [
    ...tasks.map((task) => ({ holder: taskHolder(task), items: inboxes.get(task.id) ?? [] })),
    ...tasklessGroups(taskless, agentInboxes, undefined),
  ];
  // Note that the holder whose item changed latest comes first, as the window's list grouped them.
  const latest = (group: (typeof groups)[number]) =>
    Math.max(0, ...group.items.map((item) => item.updatedAt));
  const first = (show: InboxShow) =>
    groups
      .toSorted((a, b) => latest(b) - latest(a))
      .map((group) => firstChoice(inboxList([group], { show, chosen: undefined, readerId })))
      .find((listed) => listed !== undefined);
  const opened = first(INBOX_SHOW.TO_DO) ?? first(INBOX_SHOW.ALL);
  return opened === undefined ? undefined : { ...choiceOf(opened), opened: true };
}

/** Opens the thread of the item so titled beside the channel's stream, as a link to it does, by the task or the agent with no task that holds it. */
function openItem(title: string): void {
  const held = (reads: ReadonlyMap<string, readonly InboxItem[]>) =>
    [...reads].flatMap(([holder, items]) =>
      items.filter((item) => item.title === title).map((item) => ({ holder, item })),
    )[0];
  const task = held(inboxes);
  const agent = task === undefined ? held(agentInboxes) : undefined;
  const choice: InboxChoice | undefined =
    task !== undefined
      ? { taskId: task.holder, itemId: task.item.id, opened: true }
      : agent !== undefined
        ? { agentId: agent.holder, itemId: agent.item.id, opened: true }
        : undefined;
  assert.ok(choice, `no item titled ${title}`);
  act(() => chooseFromOutside(choice));
}
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
  // Note that it groups by task here too, so the tests of a task's group meet its header; a
  // fresh profile groups by nothing.
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("plan"));
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
  listedWorkspace = ACME;
  automations = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), ...DESKTOP_LINKS, pageFrameUrl });
  pageAgents = new Map();
  imageReads = [];
  readMarks = [];
  readMarkRefused = false;
  members = [
    { ...READER, email: "dana@example.com", role: WORKSPACE_ROLE.OWNER },
    { ...TEAMMATE, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
  ];
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
  fakeActPort({ ...fakeActPortCalls(), ...main.procedures, ...CHANNEL_PROCEDURES });
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
  /** The agents whose transcripts it was asked to show beside the item, as the panel's preview. */
  readonly previewedAgents: string[];
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
    panel,
    holding: firstHolding = HOLDING,
    readerKnown = true,
    toasts = false,
  }: {
    listUnread?: boolean;
    standing?: readonly TaskSummary[];
    room?: ShellRoom;
    /** The side panel the Inbox opens what its item names in, where the test records what it opened. */
    panel?: SidePanelControl;
    /** Main's first word of the tasks holding items. */
    holding?: readonly AppInboxTaskHolding[];
    /** Whether the window knows the reader's own account id, as an account stored without one does not. */
    readerKnown?: boolean;
    /** Whether the window's toasts stand beside the Inbox, where the test presses one's action. */
    toasts?: boolean;
  } = {},
) {
  // Note that the host's inbox streams are answered beside whatever acts the test answers by now.
  fakeActPort({ ...fakeActPortCalls(), ...main.procedures, ...CHANNEL_PROCEDURES });
  const asked: Asked = {
    shownTasks: [],
    shownAgents: [],
    previewedAgents: [],
    shownAutomations: [],
    closed: 0,
    marks: [],
    newTasks: 0,
  };
  function Page({ sidePanel }: { sidePanel?: SidePanelControl | undefined }) {
    // The drafts are handed to the account signed in, none here, as the panel's root hands them.
    useDraftsOwner(undefined);
    const [chosen, setChosen] = useState<InboxChoice | undefined>(() =>
      listUnread
        ? undefined
        : firstOpened(standing, firstTaskless, readerKnown ? READER.userId : undefined),
    );
    // Whether the list was asked for, which the window keeps as the Tasks tab does.
    const [listAsked, setListAsked] = useState(false);
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
      ...(readerKnown ? { me: READER.userId } : {}),
      workspace: listedWorkspace,
      tasks: listed,
      listRead,
      sidePanel: sidePanel ?? {
        ...tasksControl().sidePanel,
        onPreview: (tab) => {
          if (isTranscriptTab(tab)) asked.previewedAgents.push(tab.transcript);
        },
      },
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
        onOpenItem: setChosen,
        listed: listAsked,
        onListed: setListAsked,
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
    return createElement(DesktopInbox, { tasks: control, room: room ?? SHELL_ROOM.WIDE });
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
  // Note that a panel handed in stands as handed, in whatever room, so a test can stand one open where a bare panel cannot open.
  const inbox =
    room === undefined || panel !== undefined
      ? createElement(Page, { sidePanel: panel })
      : createElement(Panelled, { at: room });
  const page = toasts ? createElement(Fragment, null, inbox, createElement(ToastHost)) : inbox;
  act(() => root?.render(onRegistry(AtomRegistry.make(), page)));
  return { page: container, asked };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
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

test("a thread leads with its item's title alone as its subject, whether the item waits, is answered, or was taken back by its agent", async () => {
  const [asking] = EXPIRY.thread ?? [];
  assert.ok(asking?.ask !== undefined, "the item opens with its ask");
  const WITHDRAWN: InboxItem = {
    ...EXPIRY,
    status: INBOX_STATUS.CLOSED,
    closedReason: "The plan now says 7 days.",
    thread: [
      {
        ...asking,
        ask: {
          ...asking.ask,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The plan now says 7 days.",
        },
      },
    ],
  };
  inboxes.set(INVITES.id, [WITHDRAWN]);
  const { page } = mount();
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  openItem("How is a failed email retried?");
  await settle();
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
  openItem("Expire after 7 days?");
  await settle();
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?"]);
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
      const shown = asked ?? THRESHOLD;
      // The close withdraws the ask it leaves open, with no reason, as the service closes it.
      const thread = (shown.thread ?? []).map((message) =>
        message.ask?.status === INBOX_ASK_STATUS.OPEN
          ? { ...message, ask: { ...message.ask, status: INBOX_ASK_STATUS.WITHDRAWN } }
          : message,
      );
      const closed: InboxItem = {
        ...shown,
        status: INBOX_STATUS.CLOSED,
        closedBy: READER,
        thread,
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

test("an open item's ⋯ menu in the pane's bar offers Mark as read or unread, Copy link, and Resolve without answering, which asks first and then settles it at the revision drawn, its ask saying who resolved it; a settled item's menu offers Copy link alone", async () => {
  listedWorkspace = ACME;
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  const ellipsis = () =>
    itemPane(page).querySelector<HTMLButtonElement>(
      '.luke-toolbar button[aria-label="Item actions"]',
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
  assert.match(
    wordsOf(itemPane(page).querySelector('[data-inbox-settled="withdrawn"]')) ?? "",
    /Resolved without an answer$/u,
    "the ask it left open says it was resolved",
  );
  act(() => ellipsis().click());
  assert.deepEqual(
    menuWords(),
    ["Mark as unreadU", "—", "Copy link"],
    "a settled item offers no Close",
  );
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
      '.luke-toolbar button[aria-label="Item actions"]',
    ) ?? assert.fail("the pane's bar ends in its ⋯ menu");
  act(() => ellipsis.click());
  act(() => menuItem("Resolve without answering").click());
  await settle();
  await confirmClose();
}

test("a paste past an item's reply cap is cut to the room left and its note line says so, until the words change, with the counter standing from four fifths of the cap", async () => {
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  const cap = INBOX_BOUNDS.MAX_MESSAGE_CHARS;
  const note = () => pane.querySelector(".luke-composer-foot-note")?.textContent;
  assert.equal(pane.querySelector(".luke-length-counter"), null);

  pasteInComposer(pane, "x".repeat(cap + 100));
  await settle();
  assert.equal(composerEditor(pane).textContent?.length, cap);
  assert.equal(note(), pasteCutWords(cap));
  assert.equal(pane.querySelector(".luke-length-counter")?.textContent, `${cap}/${cap}`);

  const editor = composerEditor(pane).editor ?? assert.fail("the editor is running");
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(1, 2));
  });
  await settle();
  assert.equal(note(), undefined, "the note goes once the words change again");
});

test("a close the agent changed its item before is not taken: the item stands as the agent now asks it, though no read holds the newer revision yet", async () => {
  const { page } = mount();
  await settle();
  const changed = { ...THRESHOLD, revision: 2, title: "Alert at 85%?", updatedAt: 6_000 };
  const sent = answeredCloses(() => ({ item: changed, taken: false }));

  await closeFromPane(page);

  assert.deepEqual(sent, [THRESHOLD.id]);
  assert.deepEqual(subjectOf(page), ["Alert at 85%?"], "it stands as the agent now asks it");
});

test("a teammate's open item leads with its title alone, and its box still takes your answer", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: CHARLES }, RETRY]);
  const { page } = mount();
  await settle();
  openItem("Alert at 80%?");
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
  const ask: InboxAsk = {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Retry 3 times over an hour" }, { label: "Retry once" }],
  };
  inboxes.set(BILLING.id, [asking(THRESHOLD, ask), RETRY]);
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
    ":scope > :is([data-inbox-draft-ask], .agent-composer-field), .attached-files, .luke-composer-foot-note",
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
    if (part.matches(".luke-composer-foot")) {
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

test("a waiting choice of one is a radio list, each option led by its radio and numbered at its right: a number key picks its option from outside the box and takes the keyboard there, Space picks the focused one, and a number typed in the box picks nothing", async () => {
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

  pressKey("2", document.body);
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
  act(() => keys.unmount());
});

test("Enter on a focused option sends the reply carrying the pick and never presses the option; with nothing picked, Send stands held and Enter sends nothing", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(repliedOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000090"));
  const pane = itemPane(page);

  assert.equal(footWords(pane), "", "the box says nothing of what is missing");
  assert.equal(answerSend(pane).disabled, true, "Send stands held");
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "the note line stands on its own under the options, over the row of presses",
  );
  keyOn(openOptions(pane)[0] ?? assert.fail("no option"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "a reply holding nothing goes nowhere");
  assert.deepEqual(checkedOptions(pane), [], "and Enter picked nothing");

  const once = openOptions(pane)[1] ?? assert.fail("no second option");
  act(() => once.click());
  assert.equal(answerSend(pane).disabled, false, "the pick lights Send");
  keyOn(once, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: askIdOf(THRESHOLD.id), reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] }],
  );
  // The answer stands at once, as sent: the pick Enter was on, never pressed off.
  assert.deepEqual(answeredPicks(page), ["Retry once"], "Enter left the pick standing");
});

test("a waiting choice of several is a checkbox list whose box counts nothing on its foot: the arrows move along it picking nothing, a number key toggles its option, and Enter on a picked option sends every pick and lets none go", async () => {
  const several = asking(THRESHOLD, {
    type: INBOX_ASK.DECIDE,
    multiple: true,
    options: [{ label: "Email" }, { label: "Slack" }, { label: "Pager" }],
  });
  inboxes.set(BILLING.id, [several, RETRY]);
  const { page } = mount();
  await settle();
  const sent = heldMessages(repliedOn(several, "c1b2c3d4-0000-4000-8000-000000000091"));
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
    sent.map(({ answers }) => answers),
    [{ ask: askIdOf(THRESHOLD.id), reply: INBOX_REPLY.CHOSE, choices: ["Pager", "Email"] }],
  );
  // The answer stands at once, as sent: every pick, Enter's own among them.
  assert.deepEqual(answeredPicks(page), ["Email", "Pager"], "Enter let no pick go");
});

test("Enter anywhere in a form of several fields, in its number field or its text field's composer, sends what is filled, a required field left empty absent from it, and with nothing filled sends nothing, the box naming nothing; Shift+Enter in a text field is a new line, an @ there picks a mention written in as its link, and an input method's Enter sends nothing", async () => {
  const form = asking(EXPIRY, {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Retries" },
      { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
    ],
  });
  inboxes.set(INVITES.id, [form]);
  const { page } = mount();
  await settle();
  openItem("Expire after 7 days?");
  await settle();
  const sent = heldMessages(repliedOn(form, "c1b2c3d4-0000-4000-8000-000000000092"));
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
  assert.equal(footWords(pane), "");

  // Note that the composer types each newline as Shift+Enter, so the line in the value sent is Shift+Enter's.
  typeInComposer(field("Reason"), "Spiked twice\nSee @roll");
  await settle();
  pressInComposer(field("Reason"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "the first Enter picks the mention");
  pressInComposer(field("Reason"), "Enter", { isComposing: true, keyCode: 229 });
  await settle();
  assert.deepEqual(sent, [], "an input method's Enter finishes its words and sends nothing");
  pressInComposer(field("Reason"), "Enter");
  await settle();
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: askIdOf(EXPIRY.id),
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Reason", value: `Spiked twice\nSee ${file}` },
          { label: "Page on-call", value: false },
        ],
      },
    ],
  );
});

test("in a form of three fields Enter on a focused option sends the form and picks nothing, an input method's Enter sends nothing, and Send names no chord", async () => {
  const form = asking(EXPIRY, {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      { type: INBOX_FIELD.NUMBER, label: "Retries" },
      { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
    ],
  });
  inboxes.set(INVITES.id, [form]);
  const { page } = mount();
  await settle();
  const sent = heldMessages(repliedOn(form, "c1b2c3d4-0000-4000-8000-000000000093"));
  openItem("Expire after 7 days?");
  await settle();
  const pane = itemPane(page);
  const option = (label: string) =>
    [...pane.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((each) =>
      each.textContent?.includes(label),
    ) ?? assert.fail(`no ${label} option`);
  assert.equal(answerSend(pane).hasAttribute("aria-keyshortcuts"), false);

  act(() => option("High").click());
  const retries =
    pane.querySelector<HTMLInputElement>('[data-inbox-field-label="Retries"] input') ??
    assert.fail("no Retries input");
  act(() => retries.focus());
  // Note that Safari's last composing key comes as code 229 with isComposing already false.
  keyOn(retries, "Enter", { keyCode: 229 });
  await settle();
  assert.deepEqual(sent, [], "an input method's Enter sends nothing");
  const low = option("Low");
  act(() => low.focus());
  keyOn(low, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: askIdOf(EXPIRY.id),
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Severity", value: "High" },
          { label: "Page on-call", value: false },
        ],
      },
    ],
  );
});

test("a settled choice whose pick is not the one recommended marks each apart: the pick checked, and the recommended option by its badge", async () => {
  inboxes.set(BILLING.id, [
    THRESHOLD,
    answeredBy(item(RETRY.id, RETRY.title, 5_000), READER, "Retry once", "", 5_000),
  ]);
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
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

test("a teammate's answer names them by their disc and name, their pick checked in the card heading their reply, and their name hangs their card", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  members = [{ ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER }];
  inboxes.set(BILLING.id, [
    THRESHOLD,
    answeredBy(
      item(RETRY.id, RETRY.title, 5_000),
      CHARLES,
      "Retry 3 times over an hour",
      "And page on-call if all three fail.",
      5_000,
    ),
  ]);
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
  await settle();

  assert.deepEqual(answeredPicks(page), ["Retry 3 times over an hour"]);
  const reply =
    answeredControls(page).closest<HTMLElement>(".inbox-comment") ?? assert.fail("their answer");
  assert.match(wordsOf(reply.querySelector(".luke-comment-head")) ?? "", /^Charles Pan/u);
  assert.equal(faceKind(reply.querySelector(".luke-comment-face")), "person");

  const answerer = reply.querySelector("[data-actor-ref]") ?? assert.fail("the answerer is named");
  restOn(answerer);
  const card = document.querySelector(".luke-tooltip-card [data-actor-card='person']");
  assert.match(card?.textContent ?? "", /Charles Pan/u);
});

test("a form stacks its fields, each its name over its control, \"Optional\" after the name of one that may be left empty and \"Required\" nowhere: a select's options are pills, any one's pick taken back by pressing it again, a required one's too since a field left empty sends without it, a yes-or-no a checkbox beside its name, a number a short field, and a text field the composer's own field", async () => {
  inboxes.set(INVITES.id, [
    asking(EXPIRY, {
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.SELECT, label: "Channel", options: ["Email", "Slack"] },
        { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
        { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        { type: INBOX_FIELD.NUMBER, label: "Retries" },
        { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
      ],
    }),
  ]);
  const { page } = mount();
  await settle();
  openItem("Expire after 7 days?");
  await settle();
  const pane = itemPane(page);
  const channel = () => segmentedGroup(pane, "Channel");
  const severity = () => segmentedGroup(pane, "Severity");
  const onCall = () =>
    pane.querySelector<HTMLElement>('[data-inbox-field="boolean"] [role="checkbox"]') ??
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
      each
        .querySelector(".luke-field-label, .luke-checkbox-words")
        ?.textContent?.endsWith("Optional") === true,
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
  assert.equal(onCall().getAttribute("aria-checked"), "true");
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

test("the pane's crumbs lead with its channel, then their tabs' glyphs, the plan's document and the agent's mark, and open the item's plan, leaving the Inbox, and its agent's transcript beside the item, and its × the one way back to the stream", async () => {
  const { page, asked } = mount();
  await settle();
  const crumbs = [
    ...page.querySelectorAll<HTMLButtonElement>('.inbox-view-items nav[aria-label="Path"] button'),
  ].slice(1);
  assert.deepEqual(
    [...page.querySelectorAll('.inbox-view-items nav[aria-label="Path"] button')].map(
      (crumb) => crumb.textContent,
    ),
    ["#general", "Billing usage alerts", "Alerts"],
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
    [...page.querySelectorAll(".inbox-view-items .luke-toolbar button")]
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .slice(3),
    ["Item actions", "Close thread"],
    "beside the crumbs the bar holds the item's ⋯ menu and the thread's ×",
  );
  act(() => crumbs[0]?.click());
  act(() => crumbs[1]?.click());
  assert.deepEqual(asked.shownTasks, [BILLING.id]);
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
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

/** The words of the item's bar's path after its channel, crumb by crumb, as a reader meets them. */
function pathWords(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll('.inbox-view-items:not([hidden]) nav[aria-label="Path"] li')]
    .map((crumb) => crumb.textContent)
    .slice(1);
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
  openItem("How is a failed email retried?");
  await settle();
  assert.deepEqual(
    pathWords(page),
    ["Billing usage alerts", "Alerts"],
    "another item opens with its own heading in view",
  );
});

test("an image that lands before its item's own read does is drawn all the same", async () => {
  const shot = inboxAttachmentAddress(
    { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c71",
    "acme",
  );
  inboxes.set(BILLING.id, [saying(THRESHOLD, `![The sandbox's window](${shot})`), RETRY]);
  // The list's read of the plan answers, while the pane's own read of it is held.
  let billingReads = 0;
  startRead = (taskId) =>
    taskId === BILLING.id && billingReads++ > 0 ? new Promise(() => undefined) : undefined;
  const { page } = mount();
  await settle();
  assert.ok(
    page.querySelector("[data-inbox-message-text]"),
    "the item is drawn from the list's read",
  );
  for (const land of imageReads.splice(0)) land();
  await settle();
  assert.equal(
    page.querySelector<HTMLImageElement>("[data-inbox-message-text] img")?.alt,
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
  const words = [
    `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`,
    "https://github.com/acme/relay/pull/42",
  ].join("\n\n");
  inboxes.set(BILLING.id, [saying(THRESHOLD, words), RETRY]);
  const { page } = mount();
  await settle();
  // The pictures land once their item's own read does, which keeps them as the item's.
  for (const land of imageReads.splice(0)) land();
  await settle();
  const pair = page.querySelectorAll("[data-inbox-message-text] .transcript-pictures");
  assert.equal(pair.length, 1, "the two pictures stand side by side in one row");
  assert.deepEqual(
    [...(pair[0]?.querySelectorAll("img") ?? [])].map((image) => image.alt),
    ["The form before", "The form after"],
  );
  assert.equal(
    page.querySelector(
      '[data-inbox-message-text] [data-lone-link="pull-request"] .luke-list-row-title',
    )?.textContent,
    "#42",
  );
  // What the item's words draw stands inside the pane's masked region.
  assert.ok(page.querySelector(".ph-no-capture [data-lone-link]"));
});

test("a picture of an item opens a viewer the arrow keys walk across every picture of the item, its Markdown's pair and a picture it carried alike, in the order they are drawn", async () => {
  const before = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c74";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c75";
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const words = `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`;
  const shot = {
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c76",
    name: "The pull request tab.png",
    mediaType: INBOX_IMAGE_TYPE.PNG,
  };
  inboxes.set(BILLING.id, [saying(THRESHOLD, words, [shot]), RETRY]);
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
      card.querySelector<HTMLImageElement>(".luke-zoom-image")?.alt,
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
  // The picture the message carried is drawn over its words, so the viewer walks it first.
  assert.deepEqual(viewer(), ["The form after.png", "3 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The pull request tab.png", "1 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The form before.png", "2 of 3"]);
  key("ArrowLeft");
  assert.deepEqual(viewer(), ["The pull request tab.png", "1 of 3"]);
});

test("a recording an agent's words draw plays where it stands, left out of the replay, and its Expand opens the viewer a picture does, which plays it and walks on to the picture drawn with it", async () => {
  const [still, video] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c90",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c91",
  ];
  const address = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const created: string[] = [];
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob.type);
    return `blob:video-${String(created.length)}`;
  };
  URL.revokeObjectURL = () => undefined;
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return previous(request);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value:
          request.payload.attachmentId === video
            ? { contentType: INBOX_FILE_TYPE.WEBM, base64: "GkXfow==" }
            : { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      });
    },
  });
  try {
    const message: InboxMessage = {
      ...threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000060",
        "agent",
        `The invite, and how it is sent.\n\n![The email](${address(still)}) ![Inviting a member](${address(video)} "The invite flow")`,
        1_000,
      ),
      files: [
        { attachmentId: still, name: "email.png", mediaType: INBOX_IMAGE_TYPE.PNG },
        { attachmentId: video, name: "flow.webm", mediaType: INBOX_FILE_TYPE.WEBM },
      ],
    };
    const pane = await mountThread(threadItem([message]));
    await settle();

    const inline = pane.querySelector("video");
    assert.ok(inline, "the recording plays where its words draw it");
    assert.equal(inline.getAttribute("src"), "blob:video-1");
    assert.deepEqual(
      [...(inline.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Expand", "Full screen"],
      "under Luke's own bar, with an Expand into the viewer",
    );
    assert.equal(inline.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(inline.getAttribute("aria-label"), "Video: Inviting a member");
    assert.ok(inline.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.equal(pane.querySelectorAll("video").length, 1, "the recording stands once");
    assert.deepEqual(
      [...pane.querySelectorAll('[aria-label="Attached files"] > *')].map(
        (each) => each.textContent,
      ),
      [],
      "the recording the words draw is not named again as a file over them",
    );
    assert.equal(
      pane.querySelector('button[aria-label="Enlarge Inviting a member"]'),
      null,
      "a press on the recording plays it rather than enlarging it",
    );
    const expand = inline
      .closest(".picture-block")
      ?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
    assert.ok(expand, "the recording's Expand opens the viewer");
    act(() => expand.click());
    await settle();

    const card = document.querySelector('[role="dialog"]');
    const player = card?.querySelector("video");
    assert.ok(player, "the viewer plays the recording");
    assert.deepEqual(
      [...(player.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Full screen"],
      "under Luke's own bar",
    );
    assert.equal(player.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(player.getAttribute("aria-label"), "Video: Inviting a member.webm");
    assert.equal(player.getAttribute("src"), "blob:video-2");
    assert.ok(player.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.deepEqual(created, [INBOX_FILE_TYPE.WEBM, INBOX_FILE_TYPE.WEBM]);
    assert.equal(card?.querySelector(".attachment-viewer-place")?.textContent, "2 of 2");
    act(() =>
      card?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(
      document.querySelector('[role="dialog"] .luke-zoom-image')?.getAttribute("alt"),
      "The email.png",
      "the walk goes on to the picture drawn with it",
    );
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
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
      card.querySelector<HTMLImageElement>(".luke-zoom-image")?.alt,
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

test("the thread names its agent as one button wherever it does, its message's comment: it hangs the agent's tab's card, which offers no Open agent, and opens its transcript beside the item", async () => {
  const { page, asked } = mount();
  await settle();
  const [comment, ...more] = threadRefs(page);
  assert.ok(comment, "the agent's comment names the agent");
  assert.equal(comment.textContent, "Alerts");
  assert.deepEqual(more, [], "nothing over the thread names the agent again");
  const asking =
    page.querySelector('[data-inbox-comment="message"]') ??
    assert.fail("the agent's message is a comment");
  assert.equal(
    faceKind(asking.querySelector(".luke-comment-face")),
    "agent",
    "the agent's tile leads its comment",
  );
  reach(comment);
  assert.deepEqual(standingCard(), ["Alerts", undefined]);
  assert.deepEqual(openings("[data-tab-card]"), [], "the name is the way to the tab");
  act(() => comment.click());
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
});

test("an archived agent is still named by its name, its card saying it was archived, and an agent the plan does not list goes by Coding agent, its card saying it is not found; each opens its tab on its task, which shows the plan where its tab is gone, an agent the task does not list being drawn there alone", async () => {
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
  const crumb = page.querySelectorAll<HTMLButtonElement>('nav[aria-label="Path"] button')[2];
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
  // An agent the task does not list, as an archived one, is drawn on its task alone, so its name goes there.
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
  assert.deepEqual(asked.previewedAgents, []);
});

/** Lays the Inbox out this wide, as the window would, and tells it so. */
function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".inbox-view");
  assert.ok(view, "the Inbox is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

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
  assert.equal(readTitle(page), "Expire after 7 days?");
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

/** The title of the item the pane reads. */
function readTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]")?.textContent;
}

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
  return [...within.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName);
}

test("an item's box is the agent's message box: it takes no caret as the item opens, so K and J stay the list's; Enter sends its note, Shift+Enter is a new line, and Escape leaves the box but not the item", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000093"));
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
    sent.map(({ itemId, text, answers }) => ({ itemId, text, answers })),
    [{ itemId: THRESHOLD.id, text: "Use 90%\ninstead", answers: undefined }],
  );
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

test("files picked or dropped in an item's box are drawn as chips and go with its reply, standing for the developer's own words where they wrote none", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000094"));
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");

  await handFiles(page, [new File(["threshold: 0.9\n"], "alerts.yml", { type: "" })], "pick");
  await handFiles(page, [new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" })], "drop");
  assert.deepEqual(attachedNames(pane), ["alerts.yml", "spec.pdf"]);

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ text, answers, attachments }) => ({ text, answers, attachments })),
    [
      {
        text: "",
        answers: undefined,
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

test("files still being read as the agent posts on the item again land in its box", async () => {
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
  assert.deepEqual(attachedNames(itemPane(page)), ["trace.txt"]);
});
test("a message's file whose read failed says so under the files, and Retry reads it again", async () => {
  const written = threadItem([
    askingMessage(EXPIRY_ASK),
    {
      ...threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000095",
        { member: READER },
        "See the spec.",
        2_000,
      ),
      files: [
        {
          attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f2",
          name: "spec.pdf",
          mediaType: "application/pdf",
        },
      ],
    },
  ]);
  inboxes = new Map([[BILLING.id, [written]]]);
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
    itemPane(page).querySelector('[data-message-id="c1b2c3d4-0000-4000-8000-000000000095"]') ??
    assert.fail("the message is drawn");
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
    [BILLING.id, [{ ...asking(THRESHOLD, { type: INBOX_ASK.DO, steps: [] }), needsReply: false }]],
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

test("in the window's Inbox an @ in an item's box offers its plan's repository's files, and the file picked reaches the agent in the reply as its link", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000096"));
  const pane = itemPane(page);

  typeInComposer(pane, "See @roll");
  await settle();
  const offered = [...pane.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (name) => name.textContent,
  );
  pressInComposer(pane, "Enter");
  await settle();
  const chips = [...composerEditor(pane).querySelectorAll("[data-mention-ref]")].map(
    (chip) => chip.querySelector(".luke-inline-ref-label")?.textContent,
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
    sent.map(({ text }) => text),
    [`See ${file}`],
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
    const name = field.querySelector(".luke-field-label, .luke-checkbox-words")?.firstChild
      ?.textContent;
    const box = field.querySelector<HTMLElement>('[role="checkbox"]');
    const number = field.querySelector<HTMLInputElement>('input[type="number"]');
    const words = field.querySelector('[role="textbox"]');
    const pills = field.querySelector<HTMLElement>(".luke-choice-list");
    if (box !== null) {
      assert.equal(box.getAttribute("aria-readonly"), "true");
      return [kind, name, box.getAttribute("aria-checked") === "true" ? "checked" : "unchecked"];
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
  openItem("Expire after 7 days?");
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
          source: TASK_SKILL_SOURCE.REPOSITORY,
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

/** The chip of the skill the thread's last reply names, pressed. */
async function pressNoteSkill(page: HTMLElement, name: string): Promise<void> {
  await settle();
  const note = [
    ...itemPane(page).querySelectorAll('[data-inbox-comment="message"] [data-inbox-message-text]'),
  ].at(-1);
  const chip = [...(note?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.querySelector(".luke-inline-ref-label")?.textContent === name,
  );
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());
}

/** Where the release skill's file stands on GitHub. */
const RELEASE_ON_GITHUB = "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md";

test("in the window's Inbox a skill an answer's words name is the chip a sent message draws, which opens its SKILL.md in the panel beside it as its preview, as a file the item names does", async () => {
  const answered = answeredBy(
    item(RETRY.id, RETRY.title, 5_000),
    READER,
    "Retry 3 times over an hour",
    "Run /release first.",
    5_000,
  );
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
  openItem("How is a failed email retried?");
  await pressNoteSkill(page, "/release");

  assert.deepEqual(files, [".agents/skills/release/SKILL.md"]);
  assert.deepEqual(opened, [], "nothing leaves for GitHub");
});

test("a skill named by a settled item of an agent with no plan that a link reached opens in the agent's own repository, which its group names none of", async () => {
  const settled = answeredBy(BUMP, READER, "Retry once", "Run /release first.", 2_000);
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

test("a notice addressed to the reader whose agent waits to hear back offers Got it, which reaches the agent, so the window reads its agents again; one that needs no reply is nodded to as it opens, which moves nothing about the agent", async () => {
  const notice = (id: string, title: string, needsReply: boolean): InboxItem => ({
    ...noticeOf(item(id, title, 2_000)),
    waitsOn: READER,
    addressed: true,
    needsReply,
  });
  const heard = notice("a1b2c3d4-0000-4000-8000-000000000012", "Turn on the flag", true);
  const quiet = notice("a1b2c3d4-0000-4000-8000-000000000013", "Add the secret", false);
  inboxes = new Map([
    [BILLING.id, [heard, quiet]],
    [INVITES.id, [EXPIRY]],
  ]);
  const listReads: AnyAct[] = [];
  const nods: CodingAgentInboxAnswerParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      // Note that only the answered items' task's agents are counted, because the item chosen next reads its own task's for its card.
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST && request.payload.taskId === BILLING.id) {
        listReads.push(request);
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        nods.push(request.payload);
        const asked = request.payload.itemId === heard.id ? heard : quiet;
        const answered = { ...asked, status: INBOX_STATUS.ANSWERED, answeredBy: READER };
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { item: answered, taken: true },
        });
      }
      return previous(request);
    },
  });

  const { page } = mount();
  await settle();
  openItem("Add the secret");
  await settle();
  const beforeHeard = listReads.length;
  assert.deepEqual(
    nods.map(({ itemId }) => itemId),
    [quiet.id],
    "the quiet notice is nodded to as it opens",
  );

  openItem("Turn on the flag");
  await settle();
  assert.equal(sendWords(itemPane(page)), "Got it");
  await act(async () => answerSend(itemPane(page)).click());
  await settle();
  assert.ok(listReads.length > beforeHeard, "the agent heard the nod, so its list is read again");
  assert.deepEqual(
    nods.map(({ clientKey: _key, ...nod }) => nod),
    [
      { itemId: quiet.id, revision: quiet.revision, reply: INBOX_REPLY.ACKNOWLEDGED },
      { itemId: heard.id, revision: heard.revision, reply: INBOX_REPLY.ACKNOWLEDGED },
    ],
  );
});

/** An agent with no task an automation started, and the question it asked. */
const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
const QUARANTINE: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000009", "Quarantine the flaky test?", 6_000),
  agentId: SWEEP_AGENT,
};

test("an item of an agent with no plan opens on its agent's own read under the crumb of the automation that started it", async () => {
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

  openItem("Quarantine the flaky test?");
  await settle();

  const crumbs = page.querySelector(".inbox-crumbs")?.textContent ?? "";
  assert.match(crumbs, /Nightly flake sweep/u);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Quarantine the flaky test?");
  assert.deepEqual(asked.shownTasks, [], "the automation's crumb opens no plan");
});

test("a link alone on its line to a page an agent with no plan showed stands as the page's row, hanging the card a plan's page hangs, its title, version and the agent that showed it, read as it is first hung; one of an agent the reader cannot reach says it can't be read", async () => {
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
  const words = [shown, `[@Their ledger](${hidden})`].join("\n\n");
  agentInboxes = new Map([[SWEEP_AGENT, [saying(QUARANTINE, words)]]]);
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
  openItem("Quarantine the flaky test?");
  await settle();

  const rows = [...page.querySelectorAll('[data-inbox-message-text] [data-lone-link="page"]')];
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
    card.querySelector(".luke-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ agentId: SWEEP_AGENT, pageId: ledger.id, version: 3 }),
  );
  act(() => {
    mine.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });

  restOn(theirs);
  await settle();
  const refused = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.deepEqual(
    [
      refused?.querySelector(".luke-hover-card-name")?.textContent,
      refused?.querySelector(".luke-hover-card-note")?.textContent,
    ],
    ["Their ledger", "Luke cannot read this page."],
  );
});

/** An agent with no task no automation the reader may read names, and its question. */
const STRAY_AGENT = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const BUMP: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000c", "Bump the Node image?", 1_500),
  agentId: STRAY_AGENT,
};

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
  assert.equal(readTitle(page), "Bump the Node image?");
});

test("an item a link names is not found though another task's read failed, its notice standing in the thread's place with a way back to the channel", async () => {
  startRead = (taskId) =>
    taskId === BILLING.id
      ? Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
        })
      : undefined;
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
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");

  assert.match(pane?.textContent ?? "", /Not found/u);
  const back = [...(pane?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Back to channel",
  );
  assert.ok(back, "the notice leads back to the channel");
  act(() => back.click());
  assert.equal(page.querySelector(".inbox-view-items"), null, "the stream stands alone again");
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
  assert.equal(readTitle(page), "Page on-call too?");
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
  assert.equal(readTitle(page), "Retry the flaky job?");
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

/** The item's thread with the messages given among it, every message in the order it was written. */
function inOrder(on: InboxItem, messages: readonly InboxMessage[]): InboxMessage[] {
  return [...(on.thread ?? []), ...messages].toSorted((a, b) => a.createdAt - b.createdAt);
}

/** The kind of writer a comment's face draws, as its avatar's outline says it: a person's circle, or an agent's square. */
function faceKind(face: Element | null | undefined): string | undefined {
  const disc = face?.querySelector<HTMLElement>(".luke-avatar");
  if (disc === null || disc === undefined) return undefined;
  return disc.dataset.shape === "square" ? "agent" : "person";
}

/** The shown item's thread as a reader meets it: each comment's kind, its writer's face, its writer by name, and a message's words. */
function threadOf(page: HTMLElement): (string | null | undefined)[][] {
  return [
    ...itemPane(page).querySelectorAll<HTMLElement>(
      '.inbox-thread > li:not([data-inbox-comment="draft"])',
    ),
  ].map((entry) => [
    entry.dataset.inboxComment ?? (entry.dataset.inboxEarlier === undefined ? "?" : "earlier"),
    faceKind(entry.querySelector(".luke-comment-face")),
    wordsOf(entry.querySelector(".luke-comment-name")),
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
      thread: [
        ...(item.thread ?? []),
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
    thread: inOrder(RETRY, [
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
    ]),
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
  await settle();

  assert.deepEqual(threadOf(page), [
    ["message", "agent", "Alerts", "A failed email is retried as the agent sets it up."],
    ["message", "person", "Charles Pan", "Should it page at night too?"],
    ["message", "person", "You", "And page on-call if all three fail."],
    ["message", "agent", "Alerts", "Only in business hours."],
    ["message", "person", "You", "See file rollout-store.ts"],
  ]);
  const mine = itemPane(page).querySelectorAll('[data-inbox-comment="message"]')[4];
  assert.equal(
    mine?.querySelector("[data-mention-ref] .luke-inline-ref-label")?.textContent,
    "rollout-store.ts",
  );
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
    thread: inOrder(RETRY, [
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
    ]),
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
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

test("words selected in an open item's question quote into its box, its reply carries the quote, and Reply stands down while the reply is out", async () => {
  const asked = saying(THRESHOLD, "Usage alerts fire at 80% of the plan's quota.");
  inboxes = new Map([
    [BILLING.id, [asked]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  openItem("Alert at 80%?");
  await settle();
  const sent: CodingAgentInboxMessageParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  const pane = itemPane(page);

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  const reply = replyPress() ?? assert.fail("Reply stands over the agent's question");
  act(() => reply.click());
  await settle();
  typeInComposer(pane, "Make it 90%.");
  pressInComposer(pane, "Enter");
  await settle();

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  assert.equal(replyPress(), undefined, "no quote is offered while the reply is out");
  assert.deepEqual(
    sent.map(({ itemId, text }) => ({ itemId, text })),
    [
      {
        itemId: THRESHOLD.id,
        text: "> Usage alerts fire at 80% of the plan's quota.\n\nMake it 90%.",
      },
    ],
  );
});

test("a message written on a settled item's thread from its box goes as a message, never an answer, and lands on the thread in place, scrolled into view with the draft reply under it, the item still answered and the box emptied", async () => {
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
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
  openItem("How is a failed email retried?");
  await settle();
  heldMessages(() => ({ failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED }));
  const pane = itemPane(page);

  typeInComposer(pane, "Page on-call at night too.");
  act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
  );
  assert.equal(
    threadOf(page).some(([, , , words]) => words === "Page on-call at night too."),
    false,
    "nothing lands on the thread",
  );
  assert.equal(composerEditor(pane).textContent, "Page on-call at night too.");
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
});

test("a message refused as naming no agent says the agent is archived where it is, with Unarchive after it, which brings the agent back and lets the note go, the box keeping its words; one whose agent is gone says it no longer exists", async () => {
  listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
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
    [...pane.querySelectorAll<HTMLButtonElement>(".luke-composer-foot-note button")].find(
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
  openItem("How is a failed email retried?");
  await settle();
  const goneItem = itemPane(gone);
  typeInComposer(goneItem, "Page on-call at night too.");
  act(() => goneItem.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    goneItem.querySelector('.agent-composer [role="alert"]')?.textContent,
    "This agent no longer exists.",
  );
  assert.equal(
    goneItem.querySelector(".luke-composer-foot-note button"),
    null,
    "nothing to unarchive",
  );
});

test("an Unarchive that lands after another send was refused lets only the archived note go, so the newer refusal still says why", async () => {
  listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  openItem("How is a failed email retried?");
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
    ...pane.querySelectorAll<HTMLButtonElement>(".luke-composer-foot-note button"),
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
  openItem("How is a failed email retried?");
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
    pane.querySelector('[data-message-id="c1b2c3d4-0000-4000-8000-000000000020"]') ??
    assert.fail("the message is drawn");
  assert.deepEqual(attachedNames(message), ["trace.txt"]);
  assert.equal(message.querySelector("[data-inbox-message-text]"), null, "no empty words");
});

test("a thread read cut to its latest messages says the earlier ones are in the agent's tab, the agent's name opening its transcript beside the item", async () => {
  const long: InboxItem = {
    ...RETRY,
    thread: inOrder(
      RETRY,
      Array.from({ length: INBOX_BOUNDS.MAX_MESSAGES_READ }, (_, at) =>
        threadMessage(
          `b1b2c3d4-0000-4000-8000-${String(at).padStart(12, "0")}`,
          { member: TEAMMATE },
          `Note ${String(at)}`,
          5_001 + at,
        ),
      ),
    ),
  };
  inboxes = new Map([
    [BILLING.id, [THRESHOLD, long]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page, asked } = mount();
  await settle();
  openItem("How is a failed email retried?");
  await settle();

  const earlier =
    itemPane(page).querySelector<HTMLElement>("[data-inbox-earlier]") ??
    assert.fail("the cut is said");
  assert.equal(wordsOf(earlier), "Earlier messages are in Alerts’s tab");
  assert.equal(threadOf(page)[1]?.[0], "earlier", "the line stands before the messages");
  act(() => earlier.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
});

test("what an item's box holds unsent, its words and its files, outlasts every message landing on the item: a teammate's answer settling it, then the agent asking on it again", async () => {
  const deliver = (items: readonly InboxItem[], cursor: string) =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, pushedOf({ items, cursor }));
  const { page } = mount();
  await settle();
  assert.equal(readTitle(page), "Alert at 80%?");
  typeInComposer(itemPane(page), "Use 90%");
  await handFiles(page, [new File(["threshold: 0.9\n"], "alerts.yml", { type: "" })], "pick");
  const box = () => [composerEditor(itemPane(page)).textContent, attachedNames(itemPane(page))];

  const answered: InboxItem = {
    ...answeredBy(THRESHOLD, TEAMMATE, "Retry once", "", 3_500),
    updatedAt: 3_500,
  };
  act(() => deliver([answered, RETRY], "2"));
  await settle();
  assert.equal(composerEditor(itemPane(page)).getAttribute("aria-label"), "Reply");
  assert.deepEqual(box(), ["Use 90%", ["alerts.yml"]], "a teammate's answer takes nothing");

  const asked: InboxItem = {
    ...answered,
    revision: 2,
    status: INBOX_STATUS.OPEN,
    thread: [...(answered.thread ?? []), askingMessage(EXPIRY_ASK, { createdAt: 4_000 })],
    updatedAt: 4_000,
  };
  act(() => deliver([asked, RETRY], "3"));
  await settle();
  assert.deepEqual(box(), ["Use 90%", ["alerts.yml"]], "nor does the agent asking again");
});

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

test("an item marked unread while it is shown stays unread until it is opened again, as a mail app keeps it", async () => {
  const keys = standKeymap();
  mount();
  await settle();
  pressKey("u");
  await settle();
  openItem("Expire after 7 days?");
  await settle();
  assert.deepEqual(readMarks, [`unread:${THRESHOLD.id}`], "leaving it leaves it unread");
  openItem("Alert at 80%?");
  await settle();
  assert.deepEqual(
    readMarks,
    [`unread:${THRESHOLD.id}`, `read:${THRESHOLD.id}`],
    "opening it again reads it",
  );
  act(() => keys.unmount());
});

/** The replies the pane sent, and how the test answers the oldest still out, as the service would. */
interface GatedAnswers {
  readonly sent: CodingAgentInboxMessageParams[];
  readonly answer: (view: CodingAgentInboxMessagedView) => void;
}

/** Every reply the pane sends, held until the test answers it as the service would. */
function gatedAnswers(): GatedAnswers {
  const sent: CodingAgentInboxMessageParams[] = [];
  const waiting: ((view: CodingAgentInboxMessagedView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      return new Promise((resolve) =>
        waiting.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
      );
    },
  });
  return { sent, answer: (view) => waiting.shift()?.(view) };
}

/** Sends a reply from the open item's box carrying its first option as its answer, with the words given. */
function answerWithNote(page: HTMLElement, note: string): void {
  const pane = itemPane(page);
  act(() => openOptions(pane)[0]?.click());
  typeInComposer(pane, note);
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
}

// One test per grouping and sort, each mounting the Inbox once, so a loaded shard times a
// quarter-second mount rather than the eight of them together.
test("an answer the service refuses brings its item back as it was, with its box's words and why it did not go", async () => {
  const { page } = mount();
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();

  await act(async () => answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
  await settle();
  const pane = itemPane(page);
  assert.equal(composerEditor(pane).textContent, "Use 90%", "the box keeps its words");
  assert.ok(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "the box says why the answer did not go",
  );
});

test("a nod on a notice the agent posted over first is not taken: the notice stands open again, and the box says so", async () => {
  const notice: InboxItem = {
    ...noticeOf(THRESHOLD),
    waitsOn: READER,
    addressed: true,
    needsReply: true,
  };
  inboxes.set(BILLING.id, [notice, RETRY]);
  const { page } = mount();
  await settle();
  const waiting: ((view: CodingAgentInboxAnsweredView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return previous(request);
      return new Promise((resolve) =>
        waiting.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
      );
    },
  });
  openItem("Alert at 80%?");
  await settle();
  assert.equal(sendWords(itemPane(page)), "Got it");
  await act(async () => answerSend(itemPane(page)).click());
  await settle();

  const asked = { ...notice, revision: 2, title: "Alert at 85%?", updatedAt: 6_000 };
  await act(async () => waiting.shift()?.({ item: asked, taken: false }));
  await settle();
  assert.equal(sendWords(itemPane(page)), "Got it", "the notice stands open, to nod to again");
  assert.equal(
    itemPane(page).querySelector('.agent-composer [role="alert"]')?.textContent,
    "The agent changed this item before your answer landed. Answer it as it stands now.",
  );
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
  return { ...THRESHOLD, title: "How long should invites last?", thread, ...extra };
}

/** The pane showing the item given, chosen from its row. */
async function mountThread(shown: InboxItem): Promise<HTMLElement> {
  inboxes = new Map([
    [BILLING.id, [shown, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  openItem(shown.title);
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
  act(() => {
    board.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: top - board.scrollTop }));
  });
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

/** Selects the words drawn under `within` as `words`, from `from` through `to`, as a drag lets them go. */
function selectWithin(within: Element, words: string, from: string, to: string): void {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
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

/** The quotes the item's box holds, in order. */
function boxQuotes(pane: HTMLElement): (string | null)[] {
  const box = pane.querySelector(".inbox-answer") ?? assert.fail("the box is drawn");
  return [...box.querySelectorAll(".composer-editor .composer-quote-words")].map(
    (quote) => quote.textContent,
  );
}

test("words selected in what an open ask offers, an option's words, quote into its box as the agent's message's do", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));

  selectWithin(pane, "What most teams use.", "What", "use.");
  const reply = replyPress() ?? assert.fail("Reply stands over an option's words");
  act(() => reply.click());
  await settle();

  assert.deepEqual(boxQuotes(pane), ["What most teams use."]);
  assert.equal(replyPress() === undefined, true, "Reply goes once pressed");
});

test("a field's name in an open ask quotes into its box, and words typed into a field offer no Reply, being the reader's own", async () => {
  const pane = await mountThread(
    threadItem([
      askingMessage({
        type: INBOX_ASK.ANSWER,
        fields: [{ type: INBOX_FIELD.TEXT, label: "Reason for the change", required: true }],
      }),
    ]),
  );
  const field = pane.querySelector(".inbox-field-composer") ?? assert.fail("the field is drawn");
  typeInComposer(field, "Teams abroad miss the window");

  selectWithin(field, "Teams abroad", "Teams", "abroad");
  assert.equal(
    replyPress() === undefined,
    true,
    "the reader's own typing is not the agent's words",
  );

  selectWithin(pane, "Reason for the change", "Reason", "change");
  const reply = replyPress() ?? assert.fail("Reply stands over a field's name");
  act(() => reply.click());
  await settle();
  assert.deepEqual(boxQuotes(pane), ["Reason for the change"]);
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
    wordsOf(box.querySelector(".luke-card-head")),
  ]);
}

/** The answered ask's controls heading a reply, as a reader hears it: their words alone, standing in the reply's body beside its words with no card around them and no head over them; none where the reply carries none. */
function answeredCard(reply: Element): string | null | undefined {
  const card = reply.querySelector("[data-inbox-answered]");
  if (card === null) return undefined;
  assert.equal(card.closest(".inbox-ask"), null, "no card stands around the controls");
  assert.ok(card.parentElement?.matches(".inbox-comment-body"), "they stand in the reply's body");
  assert.equal(card.querySelector(".luke-card-head"), null, "they have no head");
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
  const head = wordsOf(draft.querySelector(".luke-comment-head"));
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

/** Each comment of the shown thread as its head draws its writer: its kind, then the kind of each face it draws, and the marks drawn anywhere but in its head or its body. */
function commentHeads(pane: HTMLElement): (string | undefined | (string | undefined)[])[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-thread > .inbox-comment")].map(
    (comment) => [
      comment.dataset.inboxComment,
      [...comment.querySelectorAll<HTMLElement>(".luke-comment-face")].map(faceKind),
      [...comment.querySelectorAll<HTMLElement>(".actor-mark")]
        .filter((mark) => mark.closest(".luke-comment-head, .inbox-comment-body") === null)
        .map((mark) => mark.dataset.kind),
    ],
  );
}

test("each comment of a thread is headed by its writer's face and name, its face the thread's gutter with no face drawn apart from it; the draft reply's head is the reader's, \"You\", with nothing after it", async () => {
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
    pane.querySelector<HTMLElement>('[data-inbox-comment="draft"] .luke-comment-head') ??
    assert.fail("the draft reply has a head");
  assert.equal(wordsOf(draft), "You", "the reader's name alone, no draft and no time after it");
  assert.ok(
    draft.querySelector('.luke-comment-name > [data-actor-ref][data-kind="person"]'),
    "the reader is named by their ref",
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
    [...pane.querySelectorAll(".inbox-thread .luke-comment-head")].map((head) =>
      [...head.children].map((part) =>
        [...part.classList].find((name) => name.startsWith("luke-comment-")),
      ),
    ),
    [
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name"],
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

/** A notice posted on a thread, addressed to the reader, asking nothing and needing no reply, as the service writes one, at revision 4. */
function noticeItem(extra: Partial<InboxItem> = {}): InboxItem {
  const said: InboxMessage = {
    id: "e1b2c3d4-0000-4000-8000-000000000020",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "The preview is up.",
    createdAt: 1_000,
  };
  return threadItem([said], {
    title: "The preview is up",
    needsReply: false,
    waitsOn: READER,
    addressed: true,
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

  openItem("Expire after 7 days?");
  await settle();
  openItem(notice.title);
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
  openItem(notice.title);
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
  openItem("Expire after 7 days?");
  await settle();
  openItem(notice.title);
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

test("a notice addressed to a teammate is left open as it is opened, and its box offers no Got it, the notice being theirs to settle", async () => {
  const notice = noticeItem({ startedBy: TEAMMATE, waitsOn: TEAMMATE });
  const { answered } = noticeWrites();
  const pane = await mountThread(notice);
  assert.deepEqual(answered, [], "opening it answers nothing");
  assert.notEqual(sendWords(pane), "Got it");
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
  assert.deepEqual(attachedNames(draftReplyIn(pane)), [], "and its files");
  assert.deepEqual(
    [...pane.querySelectorAll('.inbox-thread > li:not([data-inbox-comment="draft"])')].flatMap(
      attachedNames,
    ),
    ["notes.md"],
    "which go up with the reply on the thread",
  );
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

  await act(async () => answers[0]?.({ failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED }));
  await settle();

  assert.equal(composerEditor(pane).textContent, "Does it matter for SSO teams?");
  assert.deepEqual(attachedNames(pane), ["notes.md"]);
  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
  );
});

/** The reader's draft reply at the thread's end, which holds the box. */
function draftReplyIn(pane: HTMLElement): Element {
  return pane.querySelector('[data-inbox-comment="draft"]') ?? assert.fail("the draft reply");
}

/** The words at the head's end of each comment of the thread that says its reply is on its way. */
function sendingMarks(page: HTMLElement): (string | undefined)[] {
  return [...itemPane(page).querySelectorAll(".inbox-thread .luke-comment-trailing")]
    .map((trailing) => wordsOf(trailing))
    .filter((words) => words === "Sending");
}

test("a plain reply stands at the thread's end marked Sending the moment it is sent, and once a read or its answer holds it, the message stands in its place once; refused, it leaves the thread as its words go back into the box, which says why", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const page = pane.ownerDocument.body;
  // Each send waits on the test's word: the reply landing on the thread, or refused.
  const lands: ((refused: boolean) => void)[] = [];
  const landed: InboxItem[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      const answer = repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000021")(request.payload);
      if (!("failure" in answer)) landed.push(answer.item);
      return new Promise((resolve) =>
        lands.push((refused) =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: refused ? { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED } : answer,
          }),
        ),
      );
    },
  });

  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(threadOf(page).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
  assert.deepEqual(sendingMarks(page), ["Sending"], "the reply says it is on its way");

  // The push holding the reply lands before the reply's own answer does.
  const held = landed[0] ?? assert.fail("the reply is answered");
  await act(async () =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, { items: [held, RETRY] }),
  );
  await settle();
  await act(async () => lands[0]?.(false));
  await settle();
  assert.deepEqual(
    threadOf(page).filter(([, , , words]) => words === "Does it matter for SSO teams?"),
    [["message", "person", "You", "Does it matter for SSO teams?"]],
    "the message stands once, in the reply's place",
  );
  assert.deepEqual(sendingMarks(page), [], "and says nothing of sending");

  typeInComposer(pane, "Never mind.");
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(threadOf(page).at(-1), ["message", "person", "You", "Never mind."]);
  assert.deepEqual(sendingMarks(page), ["Sending"]);
  await act(async () => lands[1]?.(true));
  await settle();
  assert.equal(
    threadOf(page).some(([, , , words]) => words === "Never mind."),
    false,
    "a refused reply leaves the thread",
  );
  assert.deepEqual(sendingMarks(page), []);
  assert.equal(composerEditor(pane).textContent, "Never mind.", "its words are back in the box");
  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
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
            value: refused ? { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED } : landed,
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
            value: { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED },
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
    reply.querySelector('[aria-pressed="true"] .inbox-ask-pressed[data-tone="neutral"]')
      ?.parentElement?.textContent,
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
      ["Mark done", true, "complete"],
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

test("a replaced or withdrawn ask draws no card: its controls as it offered them, stepped back, nothing picked and taking nothing, over a quiet marker saying a newer question replaced it, or a newer message where none asks, or that it was withdrawn with why under it, or the member who closed the item where no reason was said", async () => {
  const withdrawnId = "e1b2c3d4-0000-4000-8000-000000000020";
  const closedId = "e1b2c3d4-0000-4000-8000-000000000021";
  const shown = threadItem(
    [
      askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.REPLACED }),
      askingMessage(EXPIRY_ASK, {
        id: withdrawnId,
        status: INBOX_ASK_STATUS.WITHDRAWN,
        withdrawnReason: "Product picked 14 days.",
        createdAt: 2_000,
      }),
      askingMessage(EXPIRY_ASK, {
        id: closedId,
        status: INBOX_ASK_STATUS.WITHDRAWN,
        createdAt: 3_000,
      }),
    ],
    { status: INBOX_STATUS.CLOSED, closedBy: TEAMMATE, settledAt: 3_500 },
  );
  const pane = await mountThread(shown);

  assert.deepEqual(askBoxes(pane), [], "no settled ask draws a card");
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  for (const [id, settled, words, why] of [
    [ASKING_ID, "replaced", "Replaced by a newer question", null],
    [withdrawnId, "withdrawn", "Withdrawn", "Product picked 14 days."],
    [closedId, "withdrawn", "Charles Pan · Resolved without an answer", null],
  ] as const) {
    const message =
      pane.querySelector(`[data-message-id="${id}"]`) ??
      assert.fail(`the ${settled} ask's message`);
    const offered =
      message.querySelector<HTMLElement>(
        "[data-inbox-replaced] .inbox-ask-replaced-controls [data-stepped-back]",
      ) ?? assert.fail(`the ${settled} ask keeps its controls, stepped back`);
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
      message
        .querySelector("[data-inbox-replaced] > :last-child")
        ?.getAttribute("data-inbox-settled"),
      settled,
      "the marker stands under them",
    );
    assert.deepEqual(
      [...message.querySelectorAll<HTMLElement>("[data-inbox-settled]")].map((marker) => [
        marker.dataset.inboxSettled,
        wordsOf(marker.querySelector(".luke-badge")),
      ]),
      [[settled, words]],
      "the agent's message ends with the marker saying so",
    );
    assert.equal(
      wordsOf(message.querySelector("[data-inbox-settled] [data-inbox-withdrawn-why]")),
      why,
      "with why it was withdrawn under the pill, where its agent said",
    );
  }

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

  act(() => root?.unmount());
  root = undefined;
  const taken = await mountThread(
    threadItem([
      askingMessage(
        { type: INBOX_ASK.ANSWER },
        { status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: "Found it in the README." },
      ),
    ]),
  );
  const takenBack = taken.querySelector(`[data-message-id="${ASKING_ID}"]`);
  assert.equal(
    takenBack?.querySelector(".inbox-ask"),
    null,
    "a withdrawn ask of words alone draws no card",
  );
  assert.deepEqual(
    [
      wordsOf(takenBack?.querySelector('[data-inbox-settled="withdrawn"] .luke-badge')),
      wordsOf(
        takenBack?.querySelector('[data-inbox-settled="withdrawn"] [data-inbox-withdrawn-why]'),
      ),
    ],
    ["Withdrawn", "Found it in the README."],
    "and ends with the withdrawn marker alone, why under its pill",
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
  assert.equal(wordsOf(reply.querySelector(".luke-comment-name")), "You", "the answerer heads it");
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
    ["Request changes", true, "neutral"],
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
      const tick =
        step.querySelector<HTMLElement>('[role="checkbox"]') ?? assert.fail("a step's box");
      assert.equal(tick.getAttribute("aria-readonly"), "true");
      return [step.textContent, tick.getAttribute("aria-checked") === "true"];
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
    ["Couldn't do it", true, "neutral"],
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
    ["Mark done", true, "complete"],
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
    ["text", "Reason", "See file rollout-store.ts"],
    ["number", "Retries", ""],
    ["boolean", "Page on-call", "checked"],
  ]);
  assert.equal(
    box.querySelector("[data-mention-ref] .luke-inline-ref-label")?.textContent,
    "rollout-store.ts",
  );
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

test("the steps ticked and the answer pressed are the item's draft, standing again when the reader comes back to it from another item", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the repository's settings", "Add the secret"],
    }),
  ]);
  const pane = await mountThread(shown);
  const ticked = () =>
    [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")].map(
      (box) => box.checked,
    );
  act(() => pane.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  act(() => askPress(pane, "Couldn't do it").click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");

  openItem("Expire after 7 days?");
  await settle();
  openItem(shown.title);
  await settle();

  assert.deepEqual(ticked(), [true, false]);
  assert.equal(askPress(pane, "Couldn't do it").getAttribute("aria-pressed"), "true");
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("the reader's own open ask draws no waiting marker anywhere in the thread, its draft reply holding the ask's controls", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  assert.equal(
    pane.querySelector(".inbox-thread")?.getAttribute("aria-label"),
    "Messages",
    "an item's messages are a list named Messages",
  );
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

test("on a phone a thread is headed by its way back to its channel, its title centred, and one ⋯ that holds what the crumbs opened, the panel, and the item's own actions", async () => {
  const { page, asked } = mount([], { room: SHELL_ROOM.NARROW });
  await settle();
  layOut(page, 390);
  openItem("Expire after 7 days?");
  await settle();
  const head = page.querySelector<HTMLElement>(".inbox-item-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["#general", "Item actions"],
    "one control a corner",
  );
  assert.equal(head.querySelector("h1")?.textContent, "Expire after 7 days?");
  assert.equal(page.querySelector('nav[aria-label="Path"]'), null, "no crumbs under it");

  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Item actions"]')?.click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.ok(menu, "the ⋯ opens");
  const labels = [...menu.querySelectorAll(".luke-menu-item-label")].map(
    (each) => each.textContent,
  );
  for (const offered of ["Open task", "Open agent", "Show panel", "Copy link"]) {
    assert.ok(labels.includes(offered), `the ⋯ offers ${offered}`);
  }
  const openTask = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === "Open task",
  );
  act(() => openTask?.click());
  assert.deepEqual(
    asked.shownTasks,
    [INVITES.id],
    "Open task opens the item's task, as its crumb did",
  );

  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.equal(page.querySelector(".inbox-view-items"), null, "the way back stands the stream");
});

test("on a phone the panel open over an item heads itself: the way back to the item, what it shows centred, and one ⋯ listing its tabs, in place of its bar", async () => {
  let shut = 0;
  const panel: SidePanelControl = {
    ...tasksControl().sidePanel,
    open: true,
    fullScreen: true,
    fullScreenOnly: true,
    onToggle: () => {
      shut += 1;
    },
  };
  const { page } = mount([], { room: SHELL_ROOM.NARROW, panel });
  await settle();
  layOut(page, 390);
  openItem("Expire after 7 days?");
  await settle();
  const head = page.querySelector<HTMLElement>(".side-panel .panel-head");
  assert.ok(head, "the panel heads itself");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Expire after 7 days?", "Panel actions"],
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]')?.click());
  assert.ok(
    [...document.querySelectorAll(".luke-menu-item-label")].some(
      (each) => each.textContent === "Tabs",
    ),
    "the ⋯ lists the panel's tabs",
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]')?.click());
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.equal(shut, 1, "the way back shuts the panel");
});
