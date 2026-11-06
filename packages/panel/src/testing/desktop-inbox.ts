import {
  AGENT_CALL_FAILURE,
  type AgentInboxAnswerView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxScope,
  type AgentListAnswer,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import type { AutomationSummary } from "@repo/features/automation-wire";
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
} from "@repo/features/inbox-wire";
import { answeredNow, closedNow } from "@repo/features/inbox-writes";
import { pageFrameUrl } from "@repo/features/page-frame";
import type { PageLine } from "@repo/features/page-wire";
import { TASK_SKILL_SOURCE, TASK_TREE_ENTRY, type TaskSummary } from "@repo/features/task-wire";
import type { TasksFileParams } from "@repo/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type {
  AppHolderInbox,
  AppHolderInboxes,
  AppHostRead,
  AppInboxAgentHolding,
  AppInboxItems,
  AppInboxTask,
  AppInboxTaskHolding,
  AppInboxTasklessItem,
} from "@repo/host/app-state";
import { NO_HOLDER_INBOXES, UNREAD } from "@repo/host/app-state";
import { AGENT_INBOX_ACT_KIND, type PortActResult } from "@repo/host/contract";
import { isTranscriptTab } from "@repo/ui/tab-strip-model";
import type { TaskMark } from "@repo/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, beforeEach, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { useAppKeymap } from "../app-commands.js";
import type { SideBundles } from "../bundle-loader.js";
import { useDraftsOwner } from "../composer-drafts.js";
import { DesktopInbox } from "../desktop/desktop-inbox.js";
import { DesktopSidebar } from "../desktop/desktop-sidebar.js";
import { DRAFT_WORD } from "../draft-mark.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
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
import { handHostReads, holdAutomations, holdMembers, holdPages } from "./app-state.js";
import { attachmentChipName } from "./attachment-chip.js";
import {
  composerEditor,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "./composer.js";
import { onRegistry, settleQueries } from "./copy-feedback.js";
import { sidebarProps } from "./desktop-sidebar.js";
import { holdFrames, settleFrames } from "./frames.js";
import { heardWords } from "./heard-words.js";
import { restOn } from "./hint-rest.js";
import { relayout } from "./resize-observer.js";
import { installScrollIntoView } from "./scroll-into-view.js";
import { onSideBundles } from "./side-bundles.js";
import { agentHoldingsOf, listedAgent, tasksControl, waitingOf } from "./tasks-control.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

export const SHOW_KEY = "app.inboxShow";

export const WHOSE_KEY = "app.inboxWhose";

export const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Alerts",
  createdAt: 3,
  status: AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
};

export const BILLING: TaskSummary = {
  id: TASK_ID,
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
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

const RETRY_ASK: InboxAsk = {
  type: INBOX_ASK.DECIDE,
  options: [
    { label: "Retry 3 times over an hour", detail: "Backs off 5, 15, then 40 minutes." },
    { label: "Retry once" },
  ],
  recommended: "Retry 3 times over an hour",
};

export function askIdOf(itemId: string): string {
  return `f${itemId.slice(1)}`;
}

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
export const READER = { userId: "user-reader", name: "Dana Reyes" };

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

export const ON_THRESHOLD = { taskId: BILLING.id, itemId: THRESHOLD.id } as const;

export const ON_EXPIRY = { taskId: INVITES.id, itemId: EXPIRY.id } as const;

export function noticeOf(asked: InboxItem): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  const { ask: _ask, ...said } = opening;
  return { ...asked, thread: [said, ...rest] };
}

export function asking(asked: InboxItem, ask: InboxAsk): InboxItem {
  const [opening, ...rest] = asked.thread ?? [];
  assert.ok(opening !== undefined, "the item opens with the agent's message");
  return {
    ...asked,
    thread: [{ ...opening, ask: { ...ask, status: INBOX_ASK_STATUS.OPEN } }, ...rest],
  };
}

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

export const FUNNEL = {
  id: "3c4d5e6f-0000-4000-8000-000000000001",
  title: "Invite funnel",
  version: 2,
  at: 1_000,
};

class InboxWorld {
  root: Root | undefined;
  taskPages = new Map<string, readonly (typeof FUNNEL)[]>();
  agentPages = new Map<string, readonly PageLine[]>();
  listedAgents: readonly AgentSummary[] = [AGENT];
  inboxes = new Map<string, readonly InboxItem[]>();
  setHolding: (holding: readonly AppInboxTaskHolding[]) => void = () => undefined;
  setTasks: (tasks: readonly TaskSummary[]) => void = () => undefined;
  setListRead: (read: boolean) => void = () => undefined;
  setInboxOpen: (open: boolean) => void = () => undefined;
  chooseFromOutside: (chosen: InboxChoice) => void = () => undefined;
  setTaskless: (
    taskless: readonly AppInboxTasklessItem[],
    agents?: readonly AppInboxAgentHolding[],
  ) => void = () => undefined;
  agentReadFails = false;
  feedRefused = false;
  feedUnread = false;
  feedLeavesOut: ReadonlySet<string> = new Set();
  deliverFeed: (read: AppHostRead<AppInboxItems>) => void = () => undefined;
  deliverHolders: (held: AppHolderInboxes) => void = () => undefined;
  agentListHeld = false;
  holdAgentRead: ((respond: () => void) => void) | undefined;
  startRead: ((taskId: string) => Promise<ReadOutcome> | undefined) | undefined;
  agentInboxes = new Map<string, readonly InboxItem[]>();
  agentReads: string[] = [];
  listedWorkspace: Workspace | undefined;
  automations: readonly AutomationSummary[] = [];
  copied: string[] = [];
  tasklessAgents = new Map<string, AgentSummary>();
  main = heldInboxes();
  imageReads: (() => void)[] = [];
  readMarks: string[] = [];
  readMarkRefused = false;
  members: readonly WorkspaceMember[] = [];
  fileReads: TasksFileParams[] = [];
}

export const world = new InboxWorld();

export interface ReadOutcome {
  readonly status: typeof FAKE_ANSWER.DONE;
  readonly value: AgentInboxAnswerView;
}

export function pushedOf(answer: AgentInboxAnswerView) {
  return "failure" in answer ? { failure: answer.failure } : { items: answer.items };
}

type Pushed = { readonly items: readonly InboxItem[] } | { readonly failure: string };

function heldInboxes() {
  let held: AppHolderInboxes = NO_HOLDER_INBOXES;
  const open: string[] = [];
  const asked: string[] = [];
  const keyOf = (scope: AgentInboxScope) => `${scope.kind}:${scope.id}`;
  const set = (scope: AgentInboxScope, read: AppHolderInbox) => {
    held = { ...held, [scope.kind]: { ...held[scope.kind], [scope.id]: read } };
    world.deliverHolders(held);
  };
  const push = (scope: AgentInboxScope, pushed: Pushed) => {
    if ("items" in pushed) return set(scope, { rows: pushed.items });
    if (held[scope.kind][scope.id]?.rows === undefined) set(scope, { failed: true });
  };
  const isFollowed = (scope: AgentInboxScope) => open.includes(keyOf(scope));
  const isHeld = (scope: AgentInboxScope) => held[scope.kind][scope.id] !== undefined;
  const read = (scope: AgentInboxScope) => {
    const pushed =
      scope.kind === INBOX_SCOPE_KIND.PLAN ? answerTask(scope.id) : answerAgent(scope.id);
    if (pushed !== undefined) push(scope, pushed);
  };
  const procedures: Pick<
    FakeActPort,
    typeof AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW | typeof AGENT_INBOX_ACT_KIND.AGENTS_INBOX_RETRY
  > = {
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW]: (scope) => {
      asked.push(keyOf(scope));
      open.push(keyOf(scope));
      void Promise.resolve().then(() => {
        if (isFollowed(scope) && !isHeld(scope)) read(scope);
      });
      const ended = Promise.withResolvers<IteratorReturnResult<undefined>>();
      const close = () => {
        const at = open.indexOf(keyOf(scope));
        if (at >= 0) open.splice(at, 1);
        ended.resolve({ done: true, value: undefined });
      };
      const stream: AsyncIteratorObject<never, undefined, unknown> = {
        next: () => ended.promise,
        return: async () => {
          close();
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]: () => stream,
        [Symbol.asyncDispose]: async () => {
          close();
        },
      };
      return Promise.resolve(
        stream as unknown as PortActResult<typeof AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW>,
      );
    },
    [AGENT_INBOX_ACT_KIND.AGENTS_INBOX_RETRY]: (scope) => {
      if (held[scope.kind][scope.id]?.failed === true) set(scope, UNREAD);
      read(scope);
      return Promise.resolve();
    },
  };
  return {
    asked,
    push,
    isFollowed,
    isHeld,
    heldScopes: (): AgentInboxScope[] =>
      [INBOX_SCOPE_KIND.PLAN, INBOX_SCOPE_KIND.AGENT].flatMap((kind) =>
        Object.keys(held[kind]).map((id) => ({ kind, id })),
      ),
    now: () => held,
    procedures,
  };
}

function answerTask(taskId: string): Pushed | undefined {
  const held = world.startRead?.(taskId);
  if (held === undefined) return { items: world.inboxes.get(taskId) ?? [] };
  void held.then((outcome) =>
    world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: taskId }, pushedOf(outcome.value)),
  );
  return undefined;
}

function answerAgent(agentId: string): Pushed | undefined {
  world.agentReads.push(agentId);
  if (world.agentReadFails) return { failure: AGENT_CALL_FAILURE.UNANSWERED };
  const items = world.agentInboxes.get(agentId) ?? [];
  const hold = world.holdAgentRead;
  if (hold === undefined) return { items };
  hold(() => world.main.push({ kind: INBOX_SCOPE_KIND.AGENT, id: agentId }, { items }));
  return undefined;
}

function drawnByHost(drawn: (item: InboxItem) => InboxItem | undefined): void {
  const draw = (kind: AgentInboxScope["kind"], held: Map<string, readonly InboxItem[]>) => {
    for (const [id, items] of held) {
      if (!items.some((item) => drawn(item) !== undefined)) continue;
      const next = items.map((item) => drawn(item) ?? item);
      held.set(id, next);
      const scope = { kind, id };
      if (world.main.isHeld(scope)) world.main.push(scope, { items: next });
    }
  };
  draw(INBOX_SCOPE_KIND.PLAN, world.inboxes);
  draw(INBOX_SCOPE_KIND.AGENT, world.agentInboxes);
  deliverFeed();
}

function marked(itemIds: ReadonlySet<string>, unread: boolean): void {
  drawnByHost((item) => (itemIds.has(item.id) ? { ...item, unread } : undefined));
}

export function pushAgain(): void {
  deliverFeed();
  for (const scope of world.main.heldScopes()) {
    const inbox =
      scope.kind === INBOX_SCOPE_KIND.PLAN ? answerTask(scope.id) : answerAgent(scope.id);
    if (inbox !== undefined) world.main.push(scope, inbox);
  }
}

function feedNow(): AppHostRead<AppInboxItems> {
  if (world.feedUnread) return UNREAD;
  if (world.feedRefused) return { failed: true };
  const holding = (held: ReadonlyMap<string, readonly InboxItem[]>) =>
    Object.fromEntries(
      [...held].filter(([id, items]) => items.length > 0 && !world.feedLeavesOut.has(id)),
    );
  return {
    rows: {
      [INBOX_SCOPE_KIND.PLAN]: holding(world.inboxes),
      [INBOX_SCOPE_KIND.AGENT]: holding(world.agentInboxes),
    },
  };
}

function deliverFeed(): void {
  world.deliverFeed(feedNow());
}

beforeEach(() => {
  installEditorLayout();
  installScrollIntoView();
  holdFrames();
  window.localStorage.clear();
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("all"));
  window.localStorage.setItem(WHOSE_KEY, JSON.stringify({ kind: "everyone" }));
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
  world.feedUnread = false;
  world.feedLeavesOut = new Set();
  world.deliverFeed = () => undefined;
  world.agentListHeld = false;
  world.holdAgentRead = undefined;
  world.listedWorkspace = undefined;
  world.automations = [];
  world.copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(world.copied), ...DESKTOP_LINKS, pageFrameUrl });
  world.tasklessAgents = new Map();
  world.imageReads = [];
  world.readMarks = [];
  world.readMarkRefused = false;
  world.members = [];
  world.fileReads = [];
  world.main = heldInboxes();
  world.deliverHolders = () => undefined;
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AGENTS_INBOX_ITEMS_RETRY) {
        deliverFeed();
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      const done = (value: AgentListAnswer) => Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      if (request.kind === ACT_KIND.AGENTS_LIST) {
        return world.agentListHeld
          ? Promise.withResolvers<never>().promise
          : done({ agents: world.listedAgents });
      }
      if (request.kind === ACT_KIND.AGENTS_PAGE) {
        const agent = world.tasklessAgents.get(request.payload.agentId);
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value:
            agent === undefined
              ? { failure: AGENT_CALL_FAILURE.NOT_FOUND }
              : {
                  agent: {
                    ...agent,
                    planId: null,
                    automationId: null,
                    workspaceId: ACME.id,
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
      if (request.kind === ACT_KIND.AGENTS_INBOX_READ_STATE) {
        const { itemId, unread } = request.payload;
        world.readMarks.push(`${unread ? "unread" : "read"}:${itemId}`);
        if (!world.readMarkRefused) marked(new Set([itemId]), unread);
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: world.readMarkRefused
            ? { failure: AGENT_CALL_FAILURE.NOT_FOUND }
            : { id: itemId, unread },
        });
      }
      if (request.kind === ACT_KIND.AGENTS_INBOX_READ_ALL) {
        world.readMarks.push(`all:${request.payload.workspaceId ?? "every workspace"}`);
        marked(new Set(request.payload.itemIds), false);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { marked: 2 } });
      }
      if (request.kind === ACT_KIND.AGENTS_INBOX_ATTACHMENT) {
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
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Asked {
  readonly shownTasks: string[];
  readonly shownAgents: [string, string][];
  readonly previewedAgents: string[];
  readonly shownAutomations: string[];
  closed: number;
  readonly marks: [string, TaskMark][];
  newTasks: number;
}

const MAIN_WAITING: readonly AppInboxTask[] = [
  { taskId: BILLING.id, items: [waitingOf(THRESHOLD)] },
  { taskId: INVITES.id, items: [waitingOf(EXPIRY)] },
];

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
    chosen: firstChosen,
    drawnWhileOpen = false,
    agents: firstAgents = agentHoldingsOf(firstTaskless),
    bundles,
  }: {
    listUnread?: boolean;
    standing?: readonly TaskSummary[];
    room?: ShellRoom;
    panel?: SidePanelControl;
    holding?: readonly AppInboxTaskHolding[];
    waiting?: readonly AppInboxTask[];
    withSidebar?: boolean;
    readerKnown?: boolean;
    toasts?: boolean;
    chosen?: InboxChoice;
    drawnWhileOpen?: boolean;
    agents?: readonly AppInboxAgentHolding[];
    bundles?: SideBundles;
  } = {},
) {
  world.main = heldInboxes();
  fakeActPort({ ...fakeActPortCalls(), ...world.main.procedures });
  const reads = handHostReads({
    items: feedNow(),
    holders: world.main.now(),
  });
  world.deliverFeed = reads.deliverItems;
  world.deliverHolders = reads.deliverHolders;
  holdAutomations(reads.deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: () => ({ rows: world.automations }),
  });
  holdMembers(reads.deliverMembers, () => ({ rows: { members: world.members } }));
  holdPages(reads.deliverPages, (place) => ({
    rows:
      "taskId" in place
        ? (world.taskPages.get(place.taskId) ?? [])
        : (world.agentPages.get(place.agentId) ?? []),
  }));
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
    useDraftsOwner(undefined);
    const [chosen, setChosen] = useState<InboxChoice | undefined>(firstChosen);
    const [inboxOpen, setOpen] = useState(true);
    world.setInboxOpen = setOpen;
    world.chooseFromOutside = setChosen;
    const [holding, setHeld] = useState(firstHolding);
    const [listed, setListed] = useState<readonly TaskSummary[]>(listUnread ? [] : standing);
    const [listRead, setRead] = useState(!listUnread);
    world.setListRead = setRead;
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
    const { listedAgents, tasklessAgents } = world;
    const liveAgents = useMemo(
      () =>
        [
          ...listedAgents,
          ...[...tasklessAgents.values()]
            .filter((agent) => !listedAgents.some((each) => each.id === agent.id))
            .map((agent) => ({ ...agent, planId: null })),
        ].map((agent) => listedAgent(agent, { workspaceId: ACME.id, repository: "acme/relay" })),
      [listedAgents, tasklessAgents],
    );
    const control = tasksControl({
      ...(readerKnown ? { me: READER.userId } : {}),
      workspace: world.listedWorkspace,
      tasks: listed,
      liveAgents: world.agentListHeld ? undefined : liveAgents,
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
      drawnWhileOpen && !inboxOpen
        ? null
        : createElement(DesktopInbox, { tasks: control, room: room ?? SHELL_ROOM.WIDE });
    return withSidebar
      ? createElement(Fragment, null, createElement(DesktopSidebar, sidebarProps(control)), inbox)
      : inbox;
  }
  function Paneled({ at }: { at: ShellRoom }) {
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
  const inbox =
    room === undefined || panel !== undefined
      ? createElement(Page, { sidePanel: panel })
      : createElement(Paneled, { at: room });
  const shown = toasts ? createElement(Fragment, null, inbox, createElement(ToastHost)) : inbox;
  const page = bundles === undefined ? shown : onSideBundles(bundles, shown);
  act(() => world.root?.render(onRegistry(AtomRegistry.make(), page)));
  return { page: container, asked };
}

export async function settle(): Promise<void> {
  await settleFrames();
  await settleQueries(settleFrames);
}

export async function landImageReads(page: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    for (const land of world.imageReads.splice(0)) act(() => land());
    assert.equal(page.querySelector('.picture-block[data-state="reading"]') === null, true);
  });
  await settle();
}

export const ROW_TITLE = ".ui-list-row-title";

export function titleOf(row: Element): string {
  const title = row.querySelector(ROW_TITLE)?.cloneNode(true);
  if (!(title instanceof Element)) return "";
  for (const hidden of title.querySelectorAll(".ui-visually-hidden")) hidden.remove();
  return title.textContent ?? "";
}

export function heardOf(ids: string | null): string {
  return (ids ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => {
      const named = document.getElementById(id);
      assert.ok(named !== null, `nothing is drawn as ${id}`);
      return heardWords(named);
    })
    .join(" ");
}

export function needsYouMark(row: HTMLElement): string {
  const mark = row.querySelector(".ui-list-row-meta .attention-mark") !== null;
  const said = [...row.querySelectorAll(".ui-list-row-meta .ui-visually-hidden")].some(
    (each) => each.textContent === "Needs you",
  );
  if (mark) return "?";
  return said ? "*" : "";
}

export function listed(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  return [...list.querySelectorAll<HTMLButtonElement>("li button.ui-list-row-main")].map(
    (node) =>
      `${node.getAttribute("aria-current") === "page" ? "▸ " : ""}${needsYouMark(node)}${titleOf(node)}`,
  );
}

export function wordsOf(element: Element | null | undefined): string | null {
  if (element === null || element === undefined) return null;
  const copy = element.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const disc of copy.querySelectorAll(".actor-mark")) disc.remove();
  return copy.textContent;
}

export function rowNamed(page: HTMLElement, title: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.ui-list-row-main"),
  ].find((each) => titleOf(each) === title);
  assert.ok(row, `no row for ${title}`);
  return row;
}

export function openViewOptions(page: HTMLElement): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
}

export const SCOPE_NAMES = ["Open", "Needs you", "All", "Archived"] as const;

export function headTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-tasks .ui-toolbar-title")?.textContent;
}

export function showScope(page: HTMLElement, name: (typeof SCOPE_NAMES)[number]): void {
  openViewOptions(page);
  act(() => viewItem(name).click());
}

export function chooseView(page: HTMLElement, submenu: string, choice: string): void {
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
  act(() => viewItem(submenu).click());
  act(() => viewItem(choice).click());
}

export function viewItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].findLast((each) =>
    (each.querySelector(".ui-menu-item-label") ?? each).textContent?.endsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

export function subjectOf(page: HTMLElement): string[] {
  const subject =
    page.querySelector(".inbox-view-items:not([hidden]) .inbox-subject") ??
    assert.fail("the thread leads with its subject");
  return [...subject.children].map((child) => child.textContent ?? "");
}

export function takenCloses(): { itemId: string; revision: number; text?: string }[] {
  const sent: { itemId: string; revision: number; text?: string }[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_CLOSE) return previous(request);
      const { itemId, revision, text } = request.payload;
      sent.push({ itemId, revision, ...(text === undefined ? undefined : { text }) });
      const asked = [...world.inboxes.values()]
        .flat()
        .find((each) => each.id === request.payload.itemId);
      const closed = closedNow(asked ?? THRESHOLD, READER, 6_000);
      drawnByHost((each) => (each.id === closed.id ? closed : undefined));
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { item: closed, taken: true },
      });
    },
  });
  return sent;
}

export async function confirmClose(): Promise<void> {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Resolve asks first");
  assert.strictEqual(document.activeElement?.textContent, "Cancel", "Cancel takes the keyboard");
  const resolve = [...question.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    /^Resolve items?$/u.test(button.textContent ?? ""),
  );
  await act(async () => (resolve ?? assert.fail("the question offers Resolve item")).click());
  await settle();
}

export function openOptions(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      '[data-inbox-options] [role="radio"], [data-inbox-options] [role="checkbox"]',
    ),
  ];
}

export function checkedOptions(pane: HTMLElement): (string | null | undefined)[] {
  return openOptions(pane)
    .filter((option) => option.getAttribute("aria-checked") === "true")
    .map((option) => option.querySelector(".ui-choice-label")?.textContent);
}

export function answerSend(pane: HTMLElement): HTMLButtonElement {
  return (
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("no Send")
  );
}

export function sendHeld(pane: HTMLElement): boolean {
  const send = answerSend(pane);
  return send.disabled || send.getAttribute("aria-disabled") === "true";
}

export function footWords(pane: HTMLElement): string {
  const box = pane.querySelector("form.inbox-answer") ?? assert.fail("the box");
  const copy = box.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const part of copy.querySelectorAll(
    ":scope > :is([data-inbox-draft-ask], .agent-composer-field), .attached-files, .ui-composer-foot-note",
  )) {
    part.remove();
  }
  return copy.textContent ?? "";
}

export function boxParts(pane: HTMLElement): string[] {
  const form = pane.querySelector("form.inbox-answer") ?? assert.fail("the box");
  return [...form.children].flatMap((part) => {
    if (part.matches("[data-inbox-draft-ask]")) return ["controls"];
    if (part.matches(".agent-composer-field")) {
      const line = part.querySelector(".composer-editor") ?? assert.fail("the line's editor");
      return [`line: ${line.getAttribute("aria-label")}`];
    }
    if (part.matches(".ui-composer-foot")) {
      const presses = [...part.querySelectorAll<HTMLElement>("button, .composer-editor")].map(
        (press) => press.getAttribute("aria-label") ?? press.textContent,
      );
      return [`row: ${presses.join(", ")}`];
    }
    return [];
  });
}

export function keyOn(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    const presses = key === "Enter" || key === " ";
    if (presses && !event.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  });
}

export function openings(card: string): string[] {
  const standing = document.querySelector(`.ui-tooltip-card ${card}`);
  assert.ok(standing, "a card is hung");
  return [...standing.querySelectorAll("button")]
    .map((button) => button.textContent ?? "")
    .filter((words) => words.startsWith("Open"));
}

export function wearsAgentTile(element: Element): boolean {
  return element.querySelector('.actor-mark[data-kind="agent"]') !== null;
}

export function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".inbox-view");
  assert.ok(view, "the Inbox is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

export function listEdge(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>('.inbox-tasks [role="separator"]');
}

export function columnsShown(page: HTMLElement): string[] {
  const list = page.querySelector(".inbox-tasks");
  const item = page.querySelector(".inbox-view-items");
  return [
    ...(list === null || list.hasAttribute("hidden") ? [] : ["list"]),
    ...(item === null || item.hasAttribute("hidden") ? [] : ["item"]),
  ];
}

export function wayBack(page: HTMLElement): HTMLButtonElement | undefined {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-view-items > .ui-toolbar button"),
  ].find((button) => button.textContent === "Inbox");
}

export function backToList(page: HTMLElement): HTMLButtonElement {
  const back = wayBack(page);
  assert.ok(back, "the item standing alone has a way back");
  return back;
}

export function standKeymap(): Root {
  function Keymap() {
    useAppKeymap(true);
    return null;
  }
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => keys.render(createElement(Keymap)));
  return keys;
}

export function pressKey(key: string, target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

export function pagerOf(page: HTMLElement): string | null {
  return page.querySelector(".inbox-view-items:not([hidden]) .ui-pager-count")?.textContent ?? null;
}

export function arrowNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const arrow = page.querySelector<HTMLButtonElement>(`.ui-pager button[aria-label="${name}"]`);
  assert.ok(arrow, `the pager offers ${name}`);
  return arrow;
}

export function readTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]")?.textContent;
}

export function itemPane(page: HTMLElement): HTMLElement {
  return page.querySelector<HTMLElement>(".inbox-view-items") ?? assert.fail("the pane is drawn");
}

export function attachedNames(within: Element): (string | null)[] {
  return [...within.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName);
}

export function rowDrafted(page: HTMLElement, title: string): boolean {
  return rowNamed(page, title).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null;
}

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
  for (let round = 0; round < 4; round += 1) await settle();
}

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

export const SWEEP_AGENT = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
export const QUARANTINE: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-000000000009", "Quarantine the flaky test?", 6_000),
  agentId: SWEEP_AGENT,
};

export const STRAY_AGENT = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
export const BUMP: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000c", "Bump the Node image?", 1_500),
  agentId: STRAY_AGENT,
};

export function hoveredCard(control: Element, card: string): string | null {
  restOn(control);
  return wordsOf(document.querySelector(`.ui-tooltip-card ${card}`));
}

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

export const TEAMMATE = { userId: "user-teammate", name: "Charles Pan" };

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

export function inOrder(on: InboxItem, messages: readonly InboxMessage[]): InboxMessage[] {
  return [...(on.thread ?? []), ...messages].toSorted((a, b) => a.createdAt - b.createdAt);
}

export function faceKind(face: Element | null | undefined): string | undefined {
  const disc = face?.querySelector<HTMLElement>(".ui-avatar");
  if (disc === null || disc === undefined) return undefined;
  return disc.dataset.shape === "square" ? "agent" : "person";
}

export function heldMessages(
  answer: (params: AgentInboxMessageParams) => AgentInboxMessagedView,
): AgentInboxMessageParams[] {
  const sent: AgentInboxMessageParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      const value = answer(request.payload);
      if (!("failure" in value))
        drawnByHost((each) => (each.id === value.item.id ? value.item : undefined));
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
    },
  });
  return sent;
}

export function writtenOn(item: InboxItem, id: string) {
  return (params: AgentInboxMessageParams): AgentInboxMessagedView => ({
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

export function rowLines(page: HTMLElement, title: string): [boolean, string | null | undefined] {
  const row = rowNamed(page, title);
  const head = row.querySelector(".ui-list-row-head");
  const titled =
    titleOf(row) === title &&
    head?.querySelector(ROW_TITLE) === null &&
    head.querySelector("time") !== null;
  return [titled, row.querySelector(".ui-list-row-description")?.textContent];
}

export function rowMenu(page: HTMLElement, title: string): string[] {
  act(() => {
    rowNamed(page, title).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  return menuWords();
}

export function menuWords(): string[] {
  const menu = [...document.querySelectorAll('[role="menu"]')].at(-1);
  assert.ok(menu, "a menu is open");
  return [...menu.querySelectorAll('[role^="menuitem"], .ui-menu-rule')].map((each) =>
    each.classList.contains("ui-menu-rule") ? "—" : (each.textContent ?? ""),
  );
}

export function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
    each.textContent?.startsWith(label),
  );
  assert.ok(item, `the menu offers ${label}`);
  return item;
}

export const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

interface GatedAnswers {
  readonly sent: AgentInboxMessageParams[];
  readonly answer: (view: AgentInboxMessagedView) => void;
}

export function gatedAnswers(): GatedAnswers {
  const sent: AgentInboxMessageParams[] = [];
  const waiting: ((view: AgentInboxMessagedView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      const { itemId, clientKey: key, text, answers } = request.payload;
      const before = [...world.inboxes.values(), ...world.agentInboxes.values()]
        .flat()
        .find((each) => each.id === itemId);
      drawnByHost((each) =>
        each.id !== itemId
          ? undefined
          : answers === undefined
            ? { ...each, unread: false }
            : answeredNow(each, { key, text, answers }, READER, Date.now()),
      );
      const reply = Promise.withResolvers<FakeActAnswer>();
      waiting.push((value) => {
        const landed = "failure" in value ? before : value.item;
        drawnByHost((each) => (each.id === itemId ? landed : undefined));
        reply.resolve({ status: FAKE_ANSWER.DONE, value });
      });
      return reply.promise;
    },
  });
  return { sent, answer: (view) => waiting.shift()?.(view) };
}

export function answerWithNote(page: HTMLElement, note: string): void {
  const pane = itemPane(page);
  act(() => openOptions(pane)[0]?.click());
  typeInComposer(pane, note);
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
}

export const SHARED_WORKSPACE: Workspace = { ...ACME, memberCount: 2 };
export const SHARED_MEMBERS: readonly WorkspaceMember[] = [
  { ...READER, email: "dana@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...TEAMMATE, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER },
];

export const ASKING_ID = "e1b2c3d4-0000-4000-8000-000000000001";

export function askingMessage(
  ask: InboxAsk,
  {
    id = ASKING_ID,
    status = INBOX_ASK_STATUS.OPEN,
    withdrawnReason,
    withdrawnAt,
    createdAt = 1_000,
  }: {
    id?: string;
    status?: InboxReadAsk["status"];
    withdrawnReason?: string;
    withdrawnAt?: number;
    createdAt?: number;
  } = {},
): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Invites expire after 24 hours today, which trips up teams across time zones.",
    ask: {
      ...ask,
      status,
      ...(withdrawnReason === undefined ? undefined : { withdrawnReason }),
      ...(withdrawnAt === undefined ? undefined : { withdrawnAt }),
    },
    createdAt,
  };
}

export const EXPIRY_ASK: InboxAsk = {
  type: INBOX_ASK.DECIDE,
  options: [
    { label: "1 day", detail: "As today." },
    { label: "7 days", detail: "What most teams use." },
    { label: "30 days" },
  ],
  recommended: "7 days",
};

export function threadItem(
  thread: readonly InboxMessage[],
  extra: Partial<InboxItem> = {},
): InboxItem {
  return { ...THRESHOLD, title: "How long should invites last?", thread, ...extra };
}

export async function mountThread(shown: InboxItem): Promise<HTMLElement> {
  world.inboxes = new Map([
    [BILLING.id, [shown, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  const row = await vi.waitFor(() => rowNamed(page, shown.title));
  act(() => row.click());
  await settle();
  return itemPane(page);
}

export function subjectParts(pane: HTMLElement): (string | null)[] {
  const subject = pane.querySelector(".inbox-subject") ?? assert.fail("the subject is drawn");
  return [...subject.children].map((part) => part.textContent);
}

export function askBoxes(pane: HTMLElement): (string | null | undefined)[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-ask")].map((box) => [
    box.dataset.inboxAsk,
    wordsOf(box.querySelector(".ui-card-head")),
  ]);
}

export function sendWords(pane: HTMLElement): string | null {
  const button =
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("the box has its button");
  return button.textContent === "" ? button.getAttribute("aria-label") : button.textContent;
}

export function askMarker(pane: HTMLElement): string | null {
  return pane.querySelector("[data-inbox-marker]")?.textContent ?? null;
}

export function draftReply(pane: HTMLElement): (string | null)[] {
  const draft =
    pane.querySelector<HTMLElement>(".inbox-thread > li:last-child") ?? assert.fail("no thread");
  assert.strictEqual(draft.dataset.inboxComment, "draft", "the draft reply ends the thread");
  const head = wordsOf(draft.querySelector(".ui-comment-head"));
  const question = draft.querySelector("form.inbox-answer > [data-inbox-draft-ask]");
  if (question === null) return [head];
  assert.notMatch(
    question.textContent ?? "",
    /Pick one|Pick any|to pick|Fill in|filled|Steps|done$/u,
    "no head stands over the controls",
  );
  return [head, "controls"];
}

export function askPress(pane: HTMLElement, label: string): HTMLButtonElement {
  const found = [...pane.querySelectorAll<HTMLButtonElement>("[data-inbox-draft-ask] button")].find(
    (button) => button.querySelector(".ui-button-words")?.textContent === label,
  );
  assert.ok(found, `the ask offers ${label}`);
  return found;
}

export function repliedOn(item: InboxItem, id: string) {
  return (params: AgentInboxMessageParams): AgentInboxMessagedView => {
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
