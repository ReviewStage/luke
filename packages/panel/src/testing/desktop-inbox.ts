/**
 * desktop-inbox.ts -- the window every `desktop-inbox-*.test.ts` stands the Inbox in: its fakes, `mount`, and the helpers more than one of those files reads.
 *
 * Importing it registers the `beforeEach` that answers the Inbox's acts and
 * main's follows from `world`, and the `afterEach` that unmounts what a test
 * drew, as `announcer.ts` registers its own, so each file of the Inbox's
 * tests meets the same window. What one file alone reads stays in that file,
 * beside the assertions it serves.
 */

import type { AutomationSummary } from "@luke/features/automation-wire";
import type { Channel } from "@luke/features/channel-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAccountItems,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxMessageParams,
  type CodingAgentInboxScope,
  type CodingAgentListAnswer,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAsk,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
} from "@luke/features/inbox-wire";
import { answeredNow, closedNow } from "@luke/features/inbox-writes";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import { TASK_SKILL_SOURCE, TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import type { TasksFileParams } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type {
  AppInboxAgentHolding,
  AppInboxTask,
  AppInboxTaskHolding,
  AppInboxTasklessItem,
} from "@luke/host/app-state";
import { AGENT_INBOX_ACT_KIND } from "@luke/host/contract";
import { isTranscriptTab } from "@luke/ui/tab-strip-model";
import type { TaskMark } from "@luke/ui/tasks-model";
import { AsyncIteratorClass } from "@orpc/client";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeEach, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { useAppKeymap } from "../app-commands.js";
import { useDraftsOwner } from "../composer-drafts.js";
import { DesktopInbox } from "../desktop/desktop-inbox.js";
import { DesktopSidebar } from "../desktop/desktop-sidebar.js";
import { DRAFT_WORD } from "../draft-mark.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { HeldInboxesProvider } from "../tasks/held-inboxes.js";
import { chooseChannel, leaveChannel } from "../tasks/use-channels.js";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice } from "../tasks/use-tasks-tab.js";
import { ToastHost } from "../toast.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  type FakeActPort,
  fakeActPort,
  fakeActPortCalls,
  fakeActs,
  fakeActsAnswer,
} from "./app-bridge.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "./app-platform.js";
import { attachmentChipName } from "./attachment-chip.js";
import {
  composerEditor,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "./composer.js";
import { onRegistry } from "./copy-feedback.js";
import { sidebarProps } from "./desktop-sidebar.js";
import { followedInboxes } from "./followed-inboxes.js";
import { restOn } from "./hint-rest.js";
import { relayout } from "./resize-observer.js";
import { installScrollIntoView } from "./scroll-into-view.js";
import { agentHoldingsOf, tasksControl, waitingOf } from "./tasks-control.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Where the window's Inbox keeps the scope it shows. */
export const SHOW_KEY = "luke.inboxShow";

/** Where the window's Inbox keeps how it sorts, and how it groups. */
export const SORT_KEY = "luke.inboxSort";
export const GROUPING_KEY = "luke.inboxGrouping";

export const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Alerts",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
};

export const BILLING: TaskSummary = {
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
export const INVITES: TaskSummary = {
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
export function askIdOf(itemId: string): string {
  return `f${itemId.slice(1)}`;
}

/** An item of the agent's, open, its thread the agent's one message asking a choice, as the service answers one. */
export function item(id: string, title: string, updatedAt: number): InboxItem {
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

export const THRESHOLD = item("a1b2c3d4-0000-4000-8000-000000000001", "Alert at 80%?", 3_000);
/** The account reading the Inbox, who answered the retry question themselves. */
export const READER = { userId: "user-reader", name: "Dana Reyes" };

/** The item given answered by the member given, their reply picking `choice` with the words given, at `at`. */
export function answeredBy(
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

export const RETRY: InboxItem = answeredBy(
  item("a1b2c3d4-0000-4000-8000-000000000002", "How is a failed email retried?", 5_000),
  READER,
  "Retry 3 times over an hour",
  "And page on-call if all three fail.",
  5_000,
);
export const EXPIRY = item("a1b2c3d4-0000-4000-8000-000000000003", "Expire after 7 days?", 4_000);

/** The Billing item chosen, as a press on its row chooses it. */
export const ON_THRESHOLD = { taskId: BILLING.id, itemId: THRESHOLD.id } as const;

/** The Invites item chosen. */
export const ON_EXPIRY = { taskId: INVITES.id, itemId: EXPIRY.id } as const;

/** The item given as a notice: its opening message asking nothing. */
export function noticeOf(asked: InboxItem): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  const { ask: _ask, ...said } = opening;
  return { ...asked, thread: [said, ...rest] };
}

/** The item given with its opening message asking `ask` instead, open. */
export function asking(asked: InboxItem, ask: InboxAsk): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  return {
    ...asked,
    thread: [{ ...opening, ask: { ...ask, status: INBOX_ASK_STATUS.OPEN } }, ...rest],
  };
}

/** The item given with its opening message's words, and the files it carried, as given; its ask as it was. */
export function saying(asked: InboxItem, text: string, files?: InboxMessage["files"]): InboxItem {
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
export const FUNNEL = {
  id: "3c4d5e6f-0000-4000-8000-000000000001",
  title: "Invite funnel",
  version: 2,
  at: 1_000,
};

/**
 * What the Inbox's fakes answer and record, and the hands a test moves the
 * window by, set again before each test. They are one object's fields rather
 * than bindings of their own, because a test file cannot assign a binding it
 * imports.
 */
class InboxWorld {
  root: Root | undefined;
  /** Each task's pages as a read of them answers. */
  taskPages = new Map<string, readonly (typeof FUNNEL)[]>();
  /** Each agent with no task's own pages as a read of them answers, none for an agent the reader cannot reach. */
  agentPages = new Map<string, readonly PageLine[]>();
  /** The task's agents as the service lists them, archived ones among them. */
  listedAgents: readonly CodingAgentSummary[] = [AGENT];
  /** Each task's inbox as the service answers a read of it from the start. */
  inboxes = new Map<string, readonly InboxItem[]>();
  /** Moves main's list of the tasks holding items, as its read of the account would. */
  setHolding: (holding: readonly AppInboxTaskHolding[]) => void = () => undefined;
  /** Moves the account's list of tasks, as an archive on another Mac would. */
  setTasks: (tasks: readonly TaskSummary[]) => void = () => undefined;
  /** Lands the account's first read of its task list, where a test mounted the Inbox before it. */
  setListRead: (read: boolean) => void = () => undefined;
  /** Leaves the Inbox for another place and comes back to it, as the window's sidebar does. */
  setInboxOpen: (open: boolean) => void = () => undefined;
  /** Chooses an item from outside the list, as a notification's click does. */
  chooseFromOutside: (chosen: InboxChoice) => void = () => undefined;
  /** Moves main's read of what waits on the agents with no task, and of the agents holding items, those it names unless given, as main does when an item opens or is answered. */
  setTaskless: (
    taskless: readonly AppInboxTasklessItem[],
    agents?: readonly AppInboxAgentHolding[],
  ) => void = () => undefined;
  /** Whether an agent's own inbox read answers that it could not be read. */
  agentReadFails = false;
  /** Whether the account's feed answers that it is not answering, rather than with every task's items. */
  feedRefused = false;
  /** Whether a read of a plan's agents is held open, never answering. */
  agentListHeld = false;
  /** Holds the next agent read's answer, handing the test what lands it, where a test asks. */
  holdAgentRead: ((respond: () => void) => void) | undefined;
  /** How a read of a task from the start answers, where a test holds it in its own hands. */
  startRead: ((taskId: string) => Promise<ReadOutcome> | undefined) | undefined;
  /** Each agent with no task's items, as its own inbox read answers them. */
  agentInboxes = new Map<string, readonly InboxItem[]>();
  /** Every agent whose own inbox was read from the start, in order. */
  agentReads: string[] = [];
  /** The workspace the Inbox lists, and its automations as a read of them answers. */
  listedWorkspace: Workspace | undefined;
  automations: readonly AutomationSummary[] = [];
  /** What the window copied, in order. */
  copied: string[] = [];
  /** Each agent with no plan as a read of its own page answers it. */
  pageAgents = new Map<string, CodingAgentSummary>();
  /** Main's follows for the window, each followed inbox pushed as the knobs above say. */
  main = followedInboxes(() => undefined);
  /** The reads of an item's images, each held until the test lands it with a PNG's first bytes. */
  imageReads: (() => void)[] = [];
  /** Every read mark the Inbox sent, in order: `read:<item>`, `unread:<item>`, or `all:<workspace>`. */
  readMarks: string[] = [];
  /** Whether the service refuses a read mark, as one for an item it no longer holds. */
  readMarkRefused = false;
  /** The listed workspace's members, as a read of them answers. */
  members: readonly WorkspaceMember[] = [];
  /** Every read of a file's lines, in order, each answered with as many numbered lines as it asks for. */
  fileReads: TasksFileParams[] = [];
}

export const world = new InboxWorld();

/** A read of a task's inbox as the act answers it: done, carrying the view the service answered. */
export interface ReadOutcome {
  readonly status: typeof FAKE_ANSWER.DONE;
  readonly value: CodingAgentInboxAnswerView;
}

/** A read's answer as main pushes it: the items, or why there are none. */
export function pushedOf(answer: CodingAgentInboxAnswerView) {
  return "failure" in answer ? { failure: answer.failure } : { items: answer.items };
}

/** A task's inbox as main pushes it now: as `startRead` settles it, where it holds one, or as `inboxes` holds it. */
function answerTask(taskId: string) {
  const held = world.startRead?.(taskId);
  if (held === undefined) return { items: world.inboxes.get(taskId) ?? [] };
  void held.then((outcome) =>
    world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: taskId }, pushedOf(outcome.value)),
  );
  return undefined;
}

/** An agent's inbox as main pushes it now, the push counted: refused, held in the test's hands, or as `agentInboxes` holds it. */
function answerAgent(agentId: string) {
  world.agentReads.push(agentId);
  if (world.agentReadFails) return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
  const items = world.agentInboxes.get(agentId) ?? [];
  const hold = world.holdAgentRead;
  if (hold === undefined) return { items };
  hold(() => world.main.push({ kind: INBOX_SCOPE_KIND.AGENT, id: agentId }, { items }));
  return undefined;
}

/**
 * Every held item `drawn` changes, and every followed inbox holding one
 * pushed so, as the host draws a write into every inbox it follows the
 * moment it is asked, reading none of them again; none where it leaves an
 * item alone.
 */
function drawnByHost(drawn: (item: InboxItem) => InboxItem | undefined): void {
  const draw = (kind: CodingAgentInboxScope["kind"], held: Map<string, readonly InboxItem[]>) => {
    for (const [id, items] of held) {
      if (!items.some((item) => drawn(item) !== undefined)) continue;
      const next = items.map((item) => drawn(item) ?? item);
      held.set(id, next);
      const scope = { kind, id };
      if (world.main.isFollowed(scope)) world.main.push(scope, { items: next });
    }
  };
  draw(INBOX_SCOPE_KIND.PLAN, world.inboxes);
  draw(INBOX_SCOPE_KIND.AGENT, world.agentInboxes);
}

/** Each held item named marked read or unread, as the host draws a mark. */
function marked(itemIds: ReadonlySet<string>, unread: boolean): void {
  drawnByHost((item) => (itemIds.has(item.id) ? { ...item, unread } : undefined));
}

/** Every followed inbox pushed again as it now stands, as main pushes a change. */
export function pushAgain(): void {
  for (const taskId of [...world.inboxes.keys(), BILLING.id, INVITES.id]) {
    const scope = { kind: INBOX_SCOPE_KIND.PLAN, id: taskId };
    if (!world.main.isFollowed(scope)) continue;
    const inbox = answerTask(taskId);
    if (inbox !== undefined) world.main.push(scope, inbox);
  }
  for (const agentId of world.agentInboxes.keys()) {
    const scope = { kind: INBOX_SCOPE_KIND.AGENT, id: agentId };
    if (!world.main.isFollowed(scope)) continue;
    const inbox = answerAgent(agentId);
    if (inbox !== undefined) world.main.push(scope, inbox);
  }
}

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
  world.inboxes = new Map([
    [BILLING.id, [THRESHOLD, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  world.startRead = undefined;
  world.taskPages = new Map([[BILLING.id, [FUNNEL]]]);
  world.agentPages = new Map();
  world.listedAgents = [AGENT];
  world.agentInboxes = new Map();
  world.agentReads = [];
  world.agentReadFails = false;
  world.feedRefused = false;
  world.agentListHeld = false;
  world.holdAgentRead = undefined;
  world.listedWorkspace = undefined;
  world.automations = [];
  world.copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(world.copied), ...DESKTOP_LINKS, pageFrameUrl });
  world.pageAgents = new Map();
  world.imageReads = [];
  world.readMarks = [];
  world.readMarkRefused = false;
  world.members = [];
  world.fileReads = [];
  world.main = followedInboxes((scope) =>
    scope.kind === INBOX_SCOPE_KIND.PLAN ? answerTask(scope.id) : answerAgent(scope.id),
  );
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { automations: world.automations },
        });
      }
      if (request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: [] });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: world.members });
      }
      const done = (value: CodingAgentListAnswer) =>
        Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
        return world.agentListHeld
          ? Promise.withResolvers<never>().promise
          : done({ agents: world.listedAgents });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        const agent = world.pageAgents.get(request.payload.agentId);
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
      if (request.kind === ACT_KIND.TASKS_FILE) {
        world.fileReads.push(request.payload);
        const { path, firstLine, lastLine } = request.payload;
        const lines = Array.from(
          { length: lastLine - firstLine + 1 },
          (_, at) => `line ${firstLine + at}`,
        );
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: {
            file: {
              path,
              repository: "acme/relay",
              branch: "main",
              firstLine,
              lineCount: 40,
              lines,
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
                ? (world.taskPages.get(request.payload.taskId) ?? [])
                : (world.agentPages.get(request.payload.agentId) ?? []),
          },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_STATE) {
        const { itemId, unread } = request.payload;
        world.readMarks.push(`${unread ? "unread" : "read"}:${itemId}`);
        // Note that the host draws a mark into every inbox it follows as it is asked, and takes it back where the service refused it.
        if (!world.readMarkRefused) marked(new Set([itemId]), unread);
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: world.readMarkRefused
            ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
            : { id: itemId, unread },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_ALL) {
        world.readMarks.push(`all:${request.payload.workspaceId ?? "every workspace"}`);
        marked(new Set(request.payload.itemIds), false);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { marked: 2 } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) {
        const read = Promise.withResolvers<FakeActAnswer>();
        world.imageReads.push(() =>
          read.resolve({
            status: FAKE_ANSWER.DONE,
            value: { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
          }),
        );
        return read.promise;
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  fakeActPort({ ...fakeActPortCalls(), ...world.main.procedures });
});

afterEach(() => {
  act(() => world.root?.unmount());
  world.root = undefined;
  leaveChannel();
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

/** Main's word of what waits on the reader on each task: the one open question on each. */
const MAIN_WAITING: readonly AppInboxTask[] = [
  { taskId: BILLING.id, items: [waitingOf(THRESHOLD)] },
  { taskId: INVITES.id, items: [waitingOf(EXPIRY)] },
];

/** The account's feed of every item, as the host streams it: each task's and each agent with no task's items whole, then nothing more until the window lets it go. */
const ACCOUNT_FEED: Pick<
  FakeActPort,
  typeof AGENT_INBOX_ACT_KIND.CODING_AGENTS_ACCOUNT_ITEMS_FOLLOW
> = {
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_ACCOUNT_ITEMS_FOLLOW]: () => {
    let sent = false;
    const closed = Promise.withResolvers<void>();
    const next = async (): Promise<IteratorResult<CodingAgentAccountItems, undefined>> => {
      if (sent) {
        await closed.promise;
        return { done: true, value: undefined };
      }
      sent = true;
      if (world.feedRefused) {
        return { done: false, value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } };
      }
      const scopes = [
        ...[...world.inboxes].map(([id, items]) => ({
          scope: { kind: INBOX_SCOPE_KIND.PLAN, id },
          items,
        })),
        ...[...world.agentInboxes].map(([id, items]) => ({
          scope: { kind: INBOX_SCOPE_KIND.AGENT, id },
          items,
        })),
      ];
      return { done: false, value: { whole: true, scopes } };
    };
    return Promise.resolve(
      new AsyncIteratorClass<CodingAgentAccountItems, undefined, void>(next, async () => {
        closed.resolve();
      }),
    );
  },
};

/** The Inbox over the two tasks, and the items of agents with no task given, its own view real, as the tasks tab holds it, and every press that leaves it recorded, on nothing chosen or on `chosen`; or, `listUnread`, opened before the account's task list is first read; or over the tasks given; or, `room`, under the side panel itself in that room, as the tasks tab holds it while the Inbox has chosen nothing. */
export function mount(
  firstTaskless: readonly AppInboxTasklessItem[] = [],
  {
    listUnread = false,
    standing = [BILLING, INVITES],
    room,
    panel,
    holding: firstHolding = HOLDING,
    waiting = MAIN_WAITING,
    withSidebar = false,
    readerKnown = true,
    toasts = false,
    channels = false,
    chosen: firstChosen,
    windowRoot = false,
    accountFeed = false,
    agents: firstAgents = agentHoldingsOf(firstTaskless),
  }: {
    listUnread?: boolean;
    standing?: readonly TaskSummary[];
    room?: ShellRoom;
    /** The side panel the Inbox opens what its item names in, where the test records what it opened. */
    panel?: SidePanelControl;
    /** Main's first word of the tasks holding items. */
    holding?: readonly AppInboxTaskHolding[];
    /** Main's word of each task's items that wait on the reader. */
    waiting?: readonly AppInboxTask[];
    /** Whether the window's sidebar stands beside the Inbox page, its Inbox row counting. */
    withSidebar?: boolean;
    /** Whether the window knows the reader's own account id, as an account stored without one does not. */
    readerKnown?: boolean;
    /** Whether the window's toasts stand beside the Inbox, where the test presses one's action. */
    toasts?: boolean;
    /** Whether the Inbox is narrowed to #general, chosen as the sidebar's row chooses it. */
    channels?: boolean;
    /** The item the Inbox opens on, as a row's press chose it before; none where nothing is chosen yet. */
    chosen?: InboxChoice;
    /** Whether the Inbox stands under the window's root, holding the window's inboxes, and is drawn only while open, as the shell draws it. */
    windowRoot?: boolean;
    /** Whether the account's feed of every item answers, pushing each task's items as the service answers a read of it. */
    accountFeed?: boolean;
    /** Main's first word of the agents with no task holding items; those the items given name where none are given. */
    agents?: readonly AppInboxAgentHolding[];
  } = {},
) {
  // Note that the host's inbox streams are answered beside whatever acts the test answers by now.
  fakeActPort({
    ...fakeActPortCalls(),
    ...world.main.procedures,
    ...(accountFeed ? ACCOUNT_FEED : undefined),
  });
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
    const [chosen, setChosen] = useState<InboxChoice | undefined>(firstChosen);
    const [inboxOpen, setOpen] = useState(true);
    world.setInboxOpen = setOpen;
    world.chooseFromOutside = setChosen;
    const [holding, setHeld] = useState(firstHolding);
    const [listed, setListed] = useState<readonly TaskSummary[]>(listUnread ? [] : standing);
    const [listRead, setRead] = useState(!listUnread);
    world.setListRead = setRead;
    // Note that main's word of a change comes with the change pushed, as the host follows both.
    world.setHolding = (next) => {
      setHeld(next);
      pushAgain();
    };
    const [taskless, setWaiting] = useState(firstTaskless);
    const [agents, setAgents] = useState(firstAgents);
    world.setTaskless = (next, holding = agentHoldingsOf(next)) => {
      setWaiting(next);
      setAgents(holding);
      pushAgain();
    };
    world.setTasks = setListed;
    const control = tasksControl({
      ...(readerKnown ? { me: READER.userId } : {}),
      workspace: world.listedWorkspace,
      tasks: listed,
      listRead,
      sidePanel: sidePanel ?? {
        ...tasksControl().sidePanel,
        onPreview: (tab) => {
          if (isTranscriptTab(tab)) asked.previewedAgents.push(tab.transcript);
        },
      },
      inbox: waiting,
      inboxTasks: holding,
      inboxTaskless: taskless,
      inboxAgents: agents,
      inboxView: {
        open: inboxOpen,
        chosen,
        onOpen: () => undefined,
        onClose: () => {
          asked.closed += 1;
        },
        onChoose: setChosen,
        onOpenItem: setChosen,
        onOpenChannel: chooseChannel,
        onClear: () => setChosen(undefined),
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
    const inbox =
      windowRoot && !inboxOpen
        ? null
        : createElement(DesktopInbox, { tasks: control, room: room ?? SHELL_ROOM.WIDE });
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
      at,
    );
    return createElement(Page, { sidePanel });
  }
  const container = document.createElement("div");
  document.body.append(container);
  world.root = createRoot(container);
  // Note that a panel handed in stands as handed, in whatever room, so a test can stand one open where a bare panel cannot open.
  const inbox =
    room === undefined || panel !== undefined
      ? createElement(Page, { sidePanel: panel })
      : createElement(Panelled, { at: room });
  const page = toasts ? createElement(Fragment, null, inbox, createElement(ToastHost)) : inbox;
  if (channels) chooseChannel(GENERAL.id);
  const rooted = windowRoot
    ? createElement(HeldInboxesProvider, { account: READER.userId }, page)
    : page;
  act(() => world.root?.render(onRegistry(AtomRegistry.make(), rooted)));
  return { page: container, asked };
}

/** Lets every promise settled so far run its continuations. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
  });
}

/** A row's title, as its ListRow draws it. */
export const ROW_TITLE = ".luke-list-row-title";

/**
 * What marks a row as needing the developer: `*` where it says "Needs you"
 * to a reader and draws no attention mark, which its card says instead,
 * nothing where it does neither, and `?` where it draws the mark, so a mark
 * drawn on every open row again fails every listing.
 */
export function needsYouMark(row: HTMLElement): string {
  const mark = row.querySelector(".luke-list-row-meta .attention-mark") !== null;
  const said = [...row.querySelectorAll(".luke-list-row-meta .luke-visually-hidden")].some(
    (each) => each.textContent === "Needs you",
  );
  if (mark) return "?";
  return said ? "*" : "";
}

/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
export function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");
  return heard?.textContent ?? "";
}

/** The list as a reader hears it: each group's name, then its rows, `▸ ` where chosen and `*` where marked as needing the developer. */
export function listed(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  const fold = ".luke-group-header-head button[aria-expanded]:not([aria-haspopup])";
  return [...list.querySelectorAll(`${fold}, li button.luke-list-row-main`)].map((node) => {
    if (node.matches(fold) || !(node instanceof HTMLButtonElement)) return `# ${heardName(node)}`;
    const name = node.querySelector(ROW_TITLE)?.textContent ?? "";
    return `${node.getAttribute("aria-current") === "page" ? "▸ " : ""}${needsYouMark(node)}${name}`;
  });
}

/** What an element says to a reader, the discs beside the names in it left out; nothing for no element. */
export function wordsOf(element: Element | null | undefined): string | null {
  if (element === null || element === undefined) return null;
  const copy = element.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const disc of copy.querySelectorAll(".actor-mark")) disc.remove();
  return copy.textContent;
}

export function rowNamed(page: HTMLElement, title: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main"),
  ].find((each) => each.querySelector(ROW_TITLE)?.textContent === title);
  assert.ok(row, `no row for ${title}`);
  return row;
}

/** Opens the list's View options. */
export function openViewOptions(page: HTMLElement): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
}

/** The scopes the view's menu may offer, in their order, and Archived, which it offered while tasks were archived, so a menu offering it again is heard. */
export const SCOPE_NAMES = ["For you", "All", "Archived"] as const;

/** The Inbox's name as the list's head says it. */
export function headTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-tasks .luke-toolbar-title")?.textContent;
}

/** Shows the scope `name` from the list's View options. */
export function showScope(page: HTMLElement, name: (typeof SCOPE_NAMES)[number]): void {
  openViewOptions(page);
  act(() => viewItem(name).click());
}

/** Chooses `choice` under `submenu` in the list's View options. */
export function chooseView(page: HTMLElement, submenu: string, choice: string): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
  act(() => viewItem(submenu).click());
  act(() => viewItem(choice).click());
}

/** The item of the menus open now whose label ends in `label`, a choice or a submenu, after any face's initial. */
export function viewItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].findLast((each) =>
    (each.querySelector(".luke-menu-item-label") ?? each).textContent?.endsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

/** The shown item's subject as a reader meets it: everything under the thread's subject, which is its title alone. */
export function subjectOf(page: HTMLElement): string[] {
  const subject =
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-subject") ??
    assert.fail("the thread leads with its subject");
  return [...subject.children].map((child) => child.textContent ?? "");
}

/** Every close the Inbox sends, answered as the service takes it: the item closed by the reader. */
export function takenCloses(): { itemId: string; revision: number }[] {
  const sent: { itemId: string; revision: number }[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_CLOSE) return previous(request);
      sent.push({ itemId: request.payload.itemId, revision: request.payload.revision });
      const asked = [...world.inboxes.values()]
        .flat()
        .find((each) => each.id === request.payload.itemId);
      // The close withdraws the ask it leaves open, with no reason, and reads the item, as the service closes it.
      const closed = closedNow(asked ?? THRESHOLD, READER, 6_000);
      // Note that the host lands the item as the service answered it in every inbox it follows before the close answers.
      drawnByHost((each) => (each.id === closed.id ? closed : undefined));
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { item: closed, taken: true },
      });
    },
  });
  return sent;
}

/** The question Resolve asks, answered Resolve. */
export async function confirmClose(): Promise<void> {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Resolve asks first");
  assert.strictEqual(document.activeElement?.textContent, "Cancel", "Cancel takes the keyboard");
  const resolve = [...question.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Resolve",
  );
  await act(async () => (resolve ?? assert.fail("the question offers Resolve")).click());
  await settle();
}

/** The open item's options, a choice's radios or checkboxes, in order. */
export function openOptions(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      '[data-inbox-options] [role="radio"], [data-inbox-options] [role="checkbox"]',
    ),
  ];
}

/** The labels of the open item's options that stand checked. */
export function checkedOptions(pane: HTMLElement): (string | null | undefined)[] {
  return openOptions(pane)
    .filter((option) => option.getAttribute("aria-checked") === "true")
    .map((option) => option.querySelector(".luke-choice-label")?.textContent);
}

/** The open item's Send, at its box's foot. */
export function answerSend(pane: HTMLElement): HTMLButtonElement {
  return (
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("no Send")
  );
}

/** Whether the open item's Send sends nothing as it stands: taking no press, or refusing it to say why (`aria-disabled`). */
export function sendHeld(pane: HTMLElement): boolean {
  const send = answerSend(pane);
  return send.disabled || send.getAttribute("aria-disabled") === "true";
}

/**
 * What the open item's box says outside its controls, its files, and its
 * note line, its presses' words among it: nothing but a notice's Got it, or
 * what an unfinished answer lacks once a send of it was refused, since the
 * box carries no helper text, its Send held until it holds something to send.
 */
export function footWords(pane: HTMLElement): string {
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
export function boxParts(pane: HTMLElement): string[] {
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
export function keyOn(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    const presses = key === "Enter" || key === " ";
    if (presses && !event.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  });
}

/** The card standing in the window, as a reader hears it: the agent's name, then what its corner says, nothing for an agent at work whose start is not known. */
/** The buttons of the card standing in the window that offer to open something, by what they say: none, since the control the card hangs from opens what it is about. */
export function openings(card: string): string[] {
  const standing = document.querySelector(`.luke-tooltip-card ${card}`);
  assert.ok(standing, "a card is hung");
  return [...standing.querySelectorAll("button")]
    .map((button) => button.textContent ?? "")
    .filter((words) => words.startsWith("Open"));
}

/** Whether a reference wears an agent's tile, the solid rounded square every agent is drawn on. */
export function wearsAgentTile(element: Element): boolean {
  return element.querySelector('.actor-mark[data-kind="agent"]') !== null;
}

/** Lays the Inbox out this wide, as the window would, and tells it so. */
export function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".inbox-view");
  assert.ok(view, "the Inbox is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

/** The edge the list is resized by, while it stands. */
export function listEdge(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>('.inbox-tasks [role="separator"]');
}

/** Which of the Inbox's columns a reader finds standing: the list, the item, or both. */
export function columnsShown(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  const item = page.querySelector(".inbox-view-items");
  return [
    ...(list === null || list.hasAttribute("hidden") ? [] : ["list"]),
    ...(item === null || item.hasAttribute("hidden") ? [] : ["item"]),
  ];
}

/** The item's bar's press named Inbox, the way back to the list, where there is one. */
export function wayBack(page: HTMLElement): HTMLButtonElement | undefined {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-view-items > .luke-toolbar button"),
  ].find((button) => button.textContent === "Inbox");
}

/** The way back from the item standing alone to the list. */
export function backToList(page: HTMLElement): HTMLButtonElement {
  const back = wayBack(page);
  assert.ok(back, "the item standing alone has a way back");
  return back;
}

/** The window's keymap, standing beside the Inbox as the shell stands it; the root it is drawn in, to unmount. */
export function standKeymap(): Root {
  function Keymap() {
    useAppKeymap(true);
    return null;
  }
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => keys.render(createElement(Keymap)));
  return keys;
}

/** A key pressed alone where the keyboard stands, or into the target given. */
export function pressKey(key: string, target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The pager at the end of the item's bar, as it reads: "2 of 3", or none where it is not drawn. */
export function pagerOf(page: HTMLElement): string | null {
  return (
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-pager-count")?.textContent ?? null
  );
}

/** One of the pager's arrows, by its name. */
export function arrowNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const arrow = page.querySelector<HTMLButtonElement>(`.inbox-pager button[aria-label="${name}"]`);
  assert.ok(arrow, `the pager offers ${name}`);
  return arrow;
}

/** The title of the item the pane reads. */
export function readTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]")?.textContent;
}

/** The open item's pane, where its box stands. */
export function itemPane(page: HTMLElement): HTMLElement {
  return page.querySelector<HTMLElement>(".inbox-view-items") ?? assert.fail("the pane is drawn");
}

/** The names of the files attached in `within`, as each chip names its file. */
export function attachedNames(within: Element): (string | null)[] {
  return [...within.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName);
}

/** Whether an item's row wears the Draft pencil. */
export function rowDrafted(page: HTMLElement, title: string): boolean {
  return rowNamed(page, title).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null;
}

/** Hands `files` to the open item's box: picked in its hidden picker, or dropped on its card. */
export async function handFiles(page: HTMLElement, files: readonly File[], how: "pick" | "drop") {
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

/** The repository's one skill read for the box, and every GitHub page a press opened, written down. */
export function skillReads(): string[] {
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

/** An agent with no task an automation started, and the question it asked. */
export const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
export const QUARANTINE: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000009", "Quarantine the flaky test?", 6_000),
  agentId: SWEEP_AGENT,
};

/** An agent with no task no automation the reader may read names, and its question. */
export const STRAY_AGENT = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
export const BUMP: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000c", "Bump the Node image?", 1_500),
  agentId: STRAY_AGENT,
};

/** The header of a group in the list, by its name. */
export function headerNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const header = [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .luke-group-header-head button[aria-expanded]:not([aria-haspopup])",
    ),
  ].find((each) => heardName(each) === name);
  assert.ok(header, `no header for ${name}`);
  return header;
}

/** Hovers a control as a resting pointer does, and answers the words of the card it hangs, its discs left out. */
export function hoveredCard(control: Element, card: string): string | null {
  restOn(control);
  return wordsOf(document.querySelector(`.luke-tooltip-card ${card}`));
}

/** One waiting item of an agent with no task, as main's read lists it. */
export function waitingTaskless(asked: InboxItem): AppInboxTasklessItem {
  return {
    id: asked.id,
    agentId: asked.agentId,
    title: asked.title,
    postedAt: asked.postedAt,
    updatedAt: asked.updatedAt,
    agentTitle: null,
    agentModel: "anthropic/claude-opus-5.5",
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
  };
}

/** A teammate of the reader's, who writes on a thread. */
export const TEAMMATE = { userId: "user-teammate", name: "Charles Pan" };

/** One message on a thread, by `author`, its words and when. */
export function threadMessage(
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
export function inOrder(on: InboxItem, messages: readonly InboxMessage[]): InboxMessage[] {
  return [...(on.thread ?? []), ...messages].toSorted((a, b) => a.createdAt - b.createdAt);
}

/** The kind of writer a comment's face draws, as its avatar's outline says it: a person's circle, or an agent's square. */
export function faceKind(face: Element | null | undefined): string | undefined {
  const disc = face?.querySelector<HTMLElement>(".luke-avatar");
  if (disc === null || disc === undefined) return undefined;
  return disc.dataset.shape === "square" ? "agent" : "person";
}

/** Every message the pane sends, written down and answered by `answer`, the item as the service would hand it back by default. */
export function heldMessages(
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
      const value = answer(request.payload);
      // Note that the host lands the item as the service answered it in every inbox it follows before the message answers.
      if (!("failure" in value))
        drawnByHost((each) => (each.id === value.item.id ? value.item : undefined));
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
    },
  });
  return sent;
}

/** The message as the service answers it: written on the thread by the reader, the item otherwise as it stood. */
export function writtenOn(item: InboxItem, id: string) {
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

/** A row's two lines as a reader meets them: whether its first holds its title and its time, and the muted words of its second. */
export function rowLines(page: HTMLElement, title: string): [boolean, string | null | undefined] {
  const row = rowNamed(page, title);
  const head = row.querySelector(".luke-list-row-head");
  const first =
    head?.querySelector(ROW_TITLE)?.textContent === title && head.querySelector("time") !== null;
  return [first, row.querySelector(".luke-list-row-description")?.textContent];
}

/** A row's right-click menu as it reads: each item's words, its key where it names one, a rule between groups. */
export function rowMenu(page: HTMLElement, title: string): string[] {
  act(() => {
    rowNamed(page, title).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  return menuWords();
}

/** The menu open now as it reads: each item's words, its key where it names one, and a rule between its groups. */
export function menuWords(): string[] {
  const menu = [...document.querySelectorAll('[role="menu"]')].at(-1);
  assert.ok(menu, "a menu is open");
  return [...menu.querySelectorAll('[role^="menuitem"], .luke-menu-rule')].map((each) =>
    each.classList.contains("luke-menu-rule") ? "—" : (each.textContent ?? ""),
  );
}

/** The menu item whose words start with `label`, in the menu open now. */
export function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
    each.textContent?.startsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

/** The workspace the marking tests list, whose Mark all as read names it. */
export const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** The replies the pane sent, and how the test answers the oldest still out, as the service would. */
interface GatedAnswers {
  readonly sent: CodingAgentInboxMessageParams[];
  readonly answer: (view: CodingAgentInboxMessagedView) => void;
}

/** Every reply the pane sends, held until the test answers it as the service would. */
export function gatedAnswers(): GatedAnswers {
  const sent: CodingAgentInboxMessageParams[] = [];
  const waiting: ((view: CodingAgentInboxMessagedView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      const { itemId, clientKey: key, text, answers } = request.payload;
      const before = [...world.inboxes.values(), ...world.agentInboxes.values()]
        .flat()
        .find((each) => each.id === itemId);
      // Note that the host draws a reply carrying an answer settled the moment it is sent, and a plain one read.
      drawnByHost((each) =>
        each.id !== itemId
          ? undefined
          : answers === undefined
            ? { ...each, unread: false }
            : answeredNow(each, { key, text, answers }, READER, Date.now()),
      );
      const reply = Promise.withResolvers<FakeActAnswer>();
      waiting.push((value) => {
        // Note that the host takes back what it drew where the service refused it, and lands the item as the service answered it where it took it.
        const landed = "failure" in value ? before : value.item;
        drawnByHost((each) => (each.id === itemId ? landed : undefined));
        reply.resolve({ status: FAKE_ANSWER.DONE, value });
      });
      return reply.promise;
    },
  });
  return { sent, answer: (view) => waiting.shift()?.(view) };
}

/** Each plan's header as the list folds it: its name and what in it needs you. */
export function foldedCounts(page: HTMLElement): (string | null)[] {
  const headers = () => [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .luke-group-header-head button[aria-expanded]:not([aria-haspopup])",
    ),
  ];
  for (const header of headers()) {
    if (header.getAttribute("aria-expanded") === "true") act(() => header.click());
  }
  const counts = headers().map((header) => header.textContent);
  for (const header of headers()) act(() => header.click());
  return counts;
}

/** Sends a reply from the open item's box carrying its first option as its answer, with the words given. */
export function answerWithNote(page: HTMLElement, note: string): void {
  const pane = itemPane(page);
  act(() => openOptions(pane)[0]?.click());
  typeInComposer(pane, note);
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
}

/** The workspace the Whose tests list, shared with Charles, and its members as read. */
export const SHARED_WORKSPACE: Workspace = { ...ACME, memberCount: 2 };
export const SHARED_MEMBERS: readonly WorkspaceMember[] = [
  { ...READER, email: "dana@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...TEAMMATE, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

/** The message of the agent's that asks, on the threads below. */
export const ASKING_ID = "e1b2c3d4-0000-4000-8000-000000000001";

/** The agent's message that opens a thread, ending with `ask`, open unless it says otherwise. */
export function askingMessage(
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
export const EXPIRY_ASK: InboxAsk = {
  type: INBOX_ASK.DECIDE,
  options: [
    { label: "1 day", detail: "As today." },
    { label: "7 days", detail: "What most teams use." },
    { label: "30 days" },
  ],
  recommended: "7 days",
};

/** The waiting item, drawn as a thread from version 5: its question's title, no blocks, and `thread`. */
export function threadItem(
  thread: readonly InboxMessage[],
  extra: Partial<InboxItem> = {},
): InboxItem {
  return { ...THRESHOLD, title: "How long should invites last?", thread, ...extra };
}

/** The pane showing the item given, chosen from its row. */
export async function mountThread(shown: InboxItem): Promise<HTMLElement> {
  world.inboxes = new Map([
    [BILLING.id, [shown, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, shown.title).click());
  await settle();
  return itemPane(page);
}

/** Everything the thread's subject draws, a part a child: its title alone. */
export function subjectParts(pane: HTMLElement): (string | null)[] {
  const subject = pane.querySelector(".inbox-subject") ?? assert.fail("the subject is drawn");
  return [...subject.children].map((part) => part.textContent);
}

/** Each ask's box on the thread: where it stands, then its head as a reader hears it; an answered ask's controls stand in its reply with no box, so they are none of these. */
export function askBoxes(pane: HTMLElement): (string | null | undefined)[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-ask")].map((box) => [
    box.dataset.inboxAsk,
    wordsOf(box.querySelector(".luke-card-head")),
  ]);
}

/** The thread's box's one button, by its words, or by its name where it is the round Send that shows none. */
export function sendWords(pane: HTMLElement): string | null {
  const button =
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("the box has its button");
  return button.textContent === "" ? button.getAttribute("aria-label") : button.textContent;
}

/** The open ask's marker ending the agent's message, as a reader hears it; none where no ask waits. */
export function askMarker(pane: HTMLElement): string | null {
  return pane.querySelector("[data-inbox-marker]")?.textContent ?? null;
}

/**
 * The reader's draft reply, the thread's last comment: its head, then
 * "controls" where the open question's controls stand in its box over the
 * note, with no words of their own over them, such as what the question
 * asks or the keys that pick it, since the agent's message says it.
 */
export function draftReply(pane: HTMLElement): (string | null)[] {
  const draft =
    pane.querySelector<HTMLElement>(".inbox-thread > li:last-child") ?? assert.fail("no thread");
  assert.strictEqual(draft.dataset.inboxComment, "draft", "the draft reply ends the thread");
  const head = wordsOf(draft.querySelector(".luke-comment-head"));
  const question = draft.querySelector("form.inbox-answer > [data-inbox-draft-ask]");
  if (question === null) return [head];
  assert.notMatch(
    question.textContent ?? "",
    /Pick one|Pick any|to pick|Fill in|filled|Steps|done$/u,
    "no head stands over the controls",
  );
  return [head, "controls"];
}

/** The press of the open ask's controls, in the draft reply, whose own words, a badge beside them aside, are `label`. */
export function askPress(pane: HTMLElement, label: string): HTMLButtonElement {
  const found = [...pane.querySelectorAll<HTMLButtonElement>("[data-inbox-draft-ask] button")].find(
    (button) => button.querySelector(".luke-button-words")?.textContent === label,
  );
  assert.ok(found, `the ask offers ${label}`);
  return found;
}

/** A reply as the service answers it: the reader's message on the thread, its answer settling the ask it names. */
export function repliedOn(item: InboxItem, id: string) {
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

/** The workspace's #general, which every thread naming no channel lives in. */
export const GENERAL: Channel = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  name: "general",
  purpose: "Everything the agents post",
  project: false,
  createdAt: 1,
  waiting: 0,
};
