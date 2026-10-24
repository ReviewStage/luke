/**
 * channels-fixture.ts -- PROTOTYPE ONLY: the synthetic workspace the `channels` fixture profile draws, for the Channels mockup (STAG-547).
 *
 * The Inbox fixture's machinery (`inbox-fixture.ts`) over Luke's own kind of
 * work: two people, a handful of tasks across the app, the service, and
 * infra, and threads of every kind the mockup names, each registered with
 * its channel (`channels-mock.ts`). Nothing is read from an account.
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { AUTOMATION_FOLLOW, type AutomationListView } from "@luke/features/automation-view";
import type { CodingAgentInboxChanged } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import type { TasksView } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppStateSnapshot,
  RUN_PROFILE,
} from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import {
  type ChannelCount,
  type ChannelItemMeta,
  MOCK_CHANNEL,
  type MockChannel,
  startChannelsMock,
  THREAD_KIND,
  type ThreadKind,
} from "./channels-mock.js";

const LANDED = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PROFILE = RUN_PROFILE.CHANNELS;
const REPOSITORY = "ReviewStage/luke";
const MODEL = "anthropic/claude-opus-5.5";

const DEAN = { userId: "user-dean", name: "Dean Stratakos" } as const;
const CHARLES = { userId: "user-charles", name: "Charles Pan" } as const;

const ACCOUNT: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: DEAN.userId,
  email: "dean@example.com",
  name: DEAN.name,
  provider: ACCOUNT_PROVIDER.GITHUB,
};

const MEMBERS: readonly WorkspaceMember[] = [
  { ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER },
  { ...CHARLES, email: "charles@example.com", role: WORKSPACE_ROLE.ADMIN },
];

/** A uuid of the fixture's, numbered. */
function fixtureId(prefix: string, n: number): string {
  return `${prefix}-6d9f-4ab7-92df-${n.toString(16).padStart(12, "0")}`;
}

const TASK = {
  ROWS: fixtureId("a1000001", 1),
  SCHEMA: fixtureId("a1000001", 2),
  VIEW: fixtureId("a1000001", 3),
  SENTRY: fixtureId("a1000001", 4),
  SEARCH: fixtureId("a1000001", 5),
  POLISH: fixtureId("a1000001", 6),
  INDEX: fixtureId("a1000001", 7),
  RELEASE: fixtureId("a1000001", 8),
} as const;

const AGENT = {
  ROWS: fixtureId("b2000002", 1),
  SCHEMA: fixtureId("b2000002", 2),
  VIEW: fixtureId("b2000002", 3),
  SENTRY: fixtureId("b2000002", 4),
  SEARCH: fixtureId("b2000002", 5),
  POLISH: fixtureId("b2000002", 6),
  INDEX: fixtureId("b2000002", 7),
  RELEASE: fixtureId("b2000002", 8),
} as const;

type Person = typeof DEAN | typeof CHARLES;

/* ----- The tasks and their agents ----- */

interface TaskSeed {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly agentTitle: string;
  readonly owner: Person;
  readonly done: boolean;
  readonly number: number;
  readonly startedAgo: number;
}

const TASKS: readonly TaskSeed[] = [
  {
    id: TASK.ROWS,
    agentId: AGENT.ROWS,
    name: "Inbox rows on three lines",
    agentTitle: "Draw Inbox rows on three lines",
    owner: DEAN,
    done: false,
    number: 512,
    startedAgo: 5 * HOUR,
  },
  {
    id: TASK.SCHEMA,
    agentId: AGENT.SCHEMA,
    name: "Channels schema",
    agentTitle: "Give inbox threads a channel",
    owner: DEAN,
    done: false,
    number: 548,
    startedAgo: 3 * HOUR,
  },
  {
    id: TASK.VIEW,
    agentId: AGENT.VIEW,
    name: "Channels view",
    agentTitle: "Build the Channels view",
    owner: DEAN,
    done: false,
    number: 549,
    startedAgo: 2 * HOUR,
  },
  {
    id: TASK.SENTRY,
    agentId: AGENT.SENTRY,
    name: "Sentry on previews",
    agentTitle: "Wire Sentry on previews",
    owner: DEAN,
    done: false,
    number: 530,
    startedAgo: DAY,
  },
  {
    id: TASK.SEARCH,
    agentId: AGENT.SEARCH,
    name: "Chat search",
    agentTitle: "Search the chat",
    owner: CHARLES,
    done: false,
    number: 541,
    startedAgo: 4 * HOUR,
  },
  {
    id: TASK.POLISH,
    agentId: AGENT.POLISH,
    name: "Sidebar polish",
    agentTitle: "Fix the sidebar's resize flicker",
    owner: CHARLES,
    done: false,
    number: 545,
    startedAgo: 3 * HOUR,
  },
  {
    id: TASK.INDEX,
    agentId: AGENT.INDEX,
    name: "Index the hot reads",
    agentTitle: "Index the hot reads and the sweep's scans",
    owner: CHARLES,
    done: true,
    number: 520,
    startedAgo: 2 * DAY,
  },
  {
    id: TASK.RELEASE,
    agentId: AGENT.RELEASE,
    name: "Release v0.48",
    agentTitle: "Ship v0.48",
    owner: DEAN,
    done: true,
    number: 527,
    startedAgo: 3 * DAY,
  },
];

/* ----- The threads ----- */

function agentSaid(n: number, ago: number, text: string, ask?: InboxMessage["ask"]): InboxMessage {
  return {
    id: fixtureId("c3000003", n),
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text,
    ...(ask === undefined ? undefined : { ask }),
    createdAt: LANDED - ago,
  };
}

function memberSaid(
  n: number,
  who: Person,
  ago: number,
  text: string,
  answers?: InboxMessage["answers"],
): InboxMessage {
  return {
    id: fixtureId("c3000003", n),
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    member: who,
    text,
    ...(answers === undefined ? undefined : { answers }),
    createdAt: LANDED - ago,
  };
}

interface ThreadSeed {
  readonly item: InboxItem;
  readonly taskId: string;
  readonly meta: ChannelItemMeta;
}

function thread(
  n: number,
  task: TaskSeed,
  channel: ChannelItemMeta["channel"],
  kind: ThreadKind,
  title: string,
  messages: readonly InboxMessage[],
  standing: Partial<InboxItem> = {},
): ThreadSeed {
  const first = messages[0]?.createdAt ?? LANDED;
  const last = messages.at(-1)?.createdAt ?? first;
  return {
    taskId: task.id,
    meta: { channel, kind },
    item: {
      id: fixtureId("d4000004", n),
      agentId: task.agentId,
      key: `thread-${n}`,
      revision: messages.length,
      version: INBOX_WIRE_VERSION,
      title,
      needsReply: false,
      status: INBOX_STATUS.OPEN,
      startedBy: task.owner,
      waitsOn: task.owner,
      thread: messages,
      postedAt: first,
      updatedAt: last,
      ...standing,
    },
  };
}

const OPEN = { status: INBOX_ASK_STATUS.OPEN } as const;

function seed(id: string): TaskSeed {
  const found = TASKS.find((task) => task.id === id);
  if (found === undefined) throw new Error(`No fixture task ${id}`);
  return found;
}

const THREADS: ThreadSeed[] = [
  thread(
    1,
    seed(TASK.SCHEMA),
    MOCK_CHANNEL.SERVICE,
    THREAD_KIND.HEADS_UP,
    "Chat search and Channels schema both change chat-store.ts",
    [
      agentSaid(
        101,
        2 * MINUTE,
        [
          "Charles's **Chat search** and this task both edit `postMessage` and `unreadFor` in [chat-store.ts](https://github.com/ReviewStage/luke/blob/HEAD/packages/database/src/models/chat-store.ts). The branches will conflict, and Chat search indexes the table Channels schema retires.",
          "",
          "Asking you both, since either task could wait.",
        ].join("\n"),
        {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: "Pause Chat search", detail: "It picks up on top of the new thread table." },
            { label: "Land Chat search first", detail: "Channels schema rebases onto it." },
            { label: "Carry on, rebase later" },
          ],
          recommended: "Pause Chat search",
          ...OPEN,
        },
      ),
    ],
    { unread: true, needsReply: true },
  ),
  thread(
    2,
    seed(TASK.ROWS),
    MOCK_CHANNEL.APP,
    THREAD_KIND.DECISION,
    "Drop the grid view on narrow windows?",
    [
      agentSaid(
        102,
        4 * MINUTE,
        "Below 720px the grid view puts one card per row, which is the list view with extra chrome. Keeping it means a second narrow layout to maintain.",
        {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: "Drop it below 720px", detail: "Narrow windows fall back to the list." },
            { label: "Keep it" },
            { label: "Keep it, two columns at least" },
          ],
          recommended: "Drop it below 720px",
          ...OPEN,
        },
      ),
    ],
    { unread: true },
  ),
  thread(
    3,
    seed(TASK.SENTRY),
    MOCK_CHANNEL.INFRA,
    THREAD_KIND.TO_DO,
    "Add SENTRY_DSN to the preview environment",
    [
      agentSaid(
        103,
        HOUR,
        "Previews never report to Sentry because the DSN isn't set for Vercel's Preview environment. Only someone with access to the project's settings can add it. Only you see these steps.",
        {
          type: INBOX_ASK.DO,
          steps: [
            "Open luke-web › Settings › Environment Variables on Vercel.",
            "Add SENTRY_DSN for Preview, the same value as Production's.",
            "Redeploy the latest preview.",
          ],
          ...OPEN,
        },
      ),
    ],
    { needsReply: true },
  ),
  thread(
    4,
    seed(TASK.SCHEMA),
    MOCK_CHANNEL.SERVICE,
    THREAD_KIND.REVIEW,
    "Ready: give inbox threads a channel",
    [
      agentSaid(
        104,
        3 * HOUR,
        "Opened the pull request: `inbox_item` gains `channel_id` and `kind`, and a thread in a channel is readable by every member of the workspace. The migration is additive.",
      ),
      agentSaid(
        105,
        2 * HOUR,
        [
          "Checks pass, and I agreed the thread's shape with the Channels view agent. Asking Charles to review, since it touches the store he owns.",
          "",
          "https://github.com/ReviewStage/luke/pull/5331",
        ].join("\n"),
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Approve" }, { label: "Request changes" }],
          recommended: "Approve",
          ...OPEN,
        },
      ),
    ],
    { waitsOn: CHARLES },
  ),
  thread(
    5,
    seed(TASK.VIEW),
    MOCK_CHANNEL.CHANNELS,
    THREAD_KIND.DECISION,
    "Where does For you sit in the sidebar?",
    [
      agentSaid(
        106,
        70 * MINUTE,
        "For you replaces the Inbox's row. It can stay where the Inbox's row stands, among the places, or head the Channels section so the counts sit together.",
        {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: "Among the places", detail: "Where the Inbox stands today." },
            { label: "Head the Channels section" },
          ],
          recommended: "Among the places",
          ...OPEN,
        },
      ),
    ],
  ),
  thread(
    6,
    seed(TASK.SCHEMA),
    MOCK_CHANNEL.APP,
    THREAD_KIND.HEADS_UP,
    "Inbox threads now carry a channel and a kind",
    [
      agentSaid(
        107,
        90 * MINUTE,
        "Anything in the panel that builds an `InboxItem` by hand, fixtures and tests included, needs `channelId` and `kind` once #5331 lands. Rows and the pane read both; nothing else changes.",
      ),
    ],
  ),
  thread(
    7,
    seed(TASK.SEARCH),
    MOCK_CHANNEL.SERVICE,
    THREAD_KIND.ANNOUNCEMENT,
    "Don't add columns to chat_message until the backfill lands",
    [
      memberSaid(
        108,
        CHARLES,
        20 * MINUTE,
        "The batched backfill runs Thursday. Until then a migration on `chat_message` conflicts with it. Pinned until Friday, and told the three agents working in #service.",
      ),
    ],
    { startedBy: CHARLES, waitsOn: CHARLES },
  ),
  thread(
    8,
    seed(TASK.POLISH),
    MOCK_CHANNEL.APP,
    THREAD_KIND.THREAD,
    "Sidebar flickers on resize",
    [
      memberSaid(
        109,
        DEAN,
        3 * HOUR,
        "Dragging the window's edge flashes the sidebar white for a frame. macOS 15, external display. Charles, seeing this?",
      ),
      memberSaid(
        110,
        CHARLES,
        2 * HOUR + 40 * MINUTE,
        'Seeing it on a 14" too. Not in the web app.',
      ),
      agentSaid(
        111,
        2 * HOUR,
        "Started on it from this thread. The sidebar's ground repaints before its width lands. Fix up on Sidebar polish; I'll post a Review here.",
      ),
    ],
    { startedBy: DEAN, waitsOn: DEAN },
  ),
  thread(
    9,
    seed(TASK.SENTRY),
    MOCK_CHANNEL.INFRA,
    THREAD_KIND.BLOCKED,
    "CI can't reach Neon from forks",
    [
      agentSaid(
        112,
        DAY,
        "A fork's pull request gets no Neon secret, so the Postgres job fails on it. Either it skips on forks, or the workflow moves to `pull_request_target`, which needs a repository setting.",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Skip it on forks" }, { label: "Move to pull_request_target" }],
          recommended: "Skip it on forks",
          ...OPEN,
        },
      ),
    ],
  ),
  thread(
    10,
    seed(TASK.ROWS),
    MOCK_CHANNEL.APP,
    THREAD_KIND.HEADS_UP,
    "Base UI 1.3 breaks the Dialog's focus trap",
    [
      agentSaid(
        113,
        5 * HOUR,
        "Escape in a popover inside a dialog now closes the dialog too. I pinned Base UI to 1.2 in `packages/ui`. Hold off upgrading until the upstream fix ships.",
      ),
    ],
    { status: INBOX_STATUS.ANSWERED, settledAt: LANDED - 4 * HOUR },
  ),
  thread(
    11,
    seed(TASK.INDEX),
    MOCK_CHANNEL.SERVICE,
    THREAD_KIND.SHIPPED,
    "Shipped: index the hot reads and the sweep's scans",
    [
      agentSaid(
        114,
        6 * HOUR,
        "#4860 merged. The sweep's p95 went from 820ms to 490ms, and the inbox read no longer scans `inbox_message`.",
      ),
    ],
    {
      startedBy: CHARLES,
      waitsOn: CHARLES,
      status: INBOX_STATUS.ANSWERED,
      settledAt: LANDED - 6 * HOUR,
    },
  ),
  thread(
    12,
    seed(TASK.RELEASE),
    MOCK_CHANNEL.GENERAL,
    THREAD_KIND.SHIPPED,
    "Shipped: v0.48 notarized and published",
    [
      agentSaid(
        115,
        2 * DAY,
        "Signed, notarized, and verified. The update manifest is live, so every Mac picks it up on its next check.",
      ),
    ],
    { status: INBOX_STATUS.ANSWERED, settledAt: LANDED - 2 * DAY },
  ),
  thread(
    13,
    seed(TASK.ROWS),
    MOCK_CHANNEL.APP,
    THREAD_KIND.REVIEW,
    "Ready: Inbox rows on three lines",
    [
      agentSaid(
        116,
        DAY + 2 * HOUR,
        "One thing to a line: who and when, the title, the latest word. Screenshot in the pull request.",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Approve" }, { label: "Request changes" }],
          status: INBOX_ASK_STATUS.ANSWERED,
        },
      ),
      memberSaid(117, DEAN, DAY, "", {
        ask: fixtureId("c3000003", 116),
        reply: INBOX_REPLY.CHOSE,
        choices: ["Approve"],
      }),
    ],
    {
      status: INBOX_STATUS.ANSWERED,
      answeredBy: DEAN,
      settledAt: LANDED - DAY,
    },
  ),
];

/* ----- The service's reads ----- */

function newest(items: readonly InboxItem[]): number {
  return Math.max(...items.map((each) => each.updatedAt));
}

const INBOXES: ReadonlyMap<string, readonly InboxItem[]> = new Map(
  TASKS.map((task) => [
    task.id,
    THREADS.filter((each) => each.taskId === task.id).map((each) => each.item),
  ]),
);

const META: ReadonlyMap<string, ChannelItemMeta> = new Map(
  THREADS.map((each) => [each.item.id, each.meta]),
);

/** Each channel's sidebar count: its open threads waiting on the reader, and whether any is unread. */
const COUNTS: ReadonlyMap<MockChannel, ChannelCount> = new Map(
  Object.values(MOCK_CHANNEL).map((channel) => {
    const inIt = THREADS.filter(
      ({ meta }) => channel === MOCK_CHANNEL.FOR_YOU || meta.channel === channel,
    ).map(({ item }) => item);
    const needsYou = inIt.filter(
      (each) =>
        each.status === INBOX_STATUS.OPEN &&
        each.thread?.some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN) === true &&
        (each.waitsOn ?? each.startedBy)?.userId === DEAN.userId,
    ).length;
    return [channel, { needsYou, unread: inIt.some((each) => each.unread === true) }];
  }),
);

/** Whether a thread asks the reader something still open. */
function needsDean(each: InboxItem): boolean {
  return (
    each.status === INBOX_STATUS.OPEN &&
    each.thread?.some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN) === true &&
    (each.waitsOn ?? each.startedBy)?.userId === DEAN.userId
  );
}

const HOLDINGS: readonly AppInboxTaskHolding[] = [...INBOXES]
  .filter(([, items]) => items.length > 0)
  .map(([taskId, items]) => ({
    taskId,
    items: items.length,
    toDo: items.filter((each) => needsDean(each)).length,
    updatedAt: newest(items),
  }))
  .toSorted((a, b) => b.updatedAt - a.updatedAt);

const WAITING: readonly AppInboxTask[] = HOLDINGS.flatMap(({ taskId }) => {
  const open = (INBOXES.get(taskId) ?? []).filter(
    (each) =>
      each.status === INBOX_STATUS.OPEN &&
      each.thread?.some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN) === true &&
      (each.waitsOn ?? each.startedBy)?.userId === DEAN.userId,
  );
  return open.length === 0
    ? []
    : [
        {
          taskId,
          items: open.map(({ id, agentId, title, postedAt }) => ({ id, agentId, title, postedAt })),
        },
      ];
});

const AGENTS: ReadonlyMap<string, CodingAgentSummary> = new Map(
  TASKS.map((task) => [
    task.id,
    {
      id: task.agentId,
      planId: task.id,
      model: MODEL,
      effort: "high",
      title: task.agentTitle,
      createdAt: LANDED - task.startedAgo,
      status: task.done ? CODING_AGENT_STATUS.COMPLETED : CODING_AGENT_STATUS.RUNNING,
      turnId: null,
      runStartedAt: LANDED - task.startedAgo,
      startedBy: task.owner,
    },
  ]),
);

function taskSummary(task: TaskSeed): TaskSummary {
  const agent = AGENTS.get(task.id);
  const items = INBOXES.get(task.id) ?? [];
  const activityAt = items.length === 0 ? LANDED - task.startedAgo : newest(items);
  return {
    id: task.id,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: task.name,
    createdAt: LANDED - task.startedAgo,
    updatedAt: activityAt,
    repository: REPOSITORY,
    status: task.done ? TASK_STATUS.DONE : TASK_STATUS.IN_PROGRESS,
    ...(task.done ? { completedAt: activityAt } : {}),
    priority: TASK_PRIORITY.MEDIUM,
    number: task.number,
    ownerId: task.owner.userId,
    createdBy: task.owner,
    assignee: task.owner,
    ...(agent === undefined
      ? {}
      : {
          agents: {
            total: 1,
            working: task.done ? 0 : 1,
            activityAt,
            agents: [
              {
                id: agent.id,
                title: agent.title,
                model: agent.model,
                effort: agent.effort,
                status: agent.status,
                at: agent.runStartedAt ?? agent.createdAt,
                startedBy: task.owner,
              },
            ],
            pullRequestTotal: 0,
            pullRequests: [],
          },
        }),
  };
}

/* ----- The doors the loader lays over the tasks fixture ----- */

/** The list as the channels profile draws it: the first workspace named Stage, holding Luke's tasks alone. */
export function channelsTasksView(profile: string, list: TasksView): TasksView {
  if (profile !== PROFILE) return list;
  return {
    ...list,
    workspaces: list.workspaces
      .filter((workspace) => workspace.id === FIXTURE_IDS.WORKSPACE)
      .map((workspace) => ({
        ...workspace,
        name: "Stage",
        slug: "stage",
        personal: false,
        memberCount: MEMBERS.length,
        github: { login: "ReviewStage", active: true },
      })),
    tasks: TASKS.map(taskSummary),
  };
}

/** The account the channels profile signs in as. */
export function channelsReader(profile: string): string | undefined {
  return profile === PROFILE ? DEAN.userId : undefined;
}

/** Main's document under the channels profile, which also turns the mockup on. */
export function channelsAppState(state: AppStateSnapshot): AppStateSnapshot {
  if (state.run.profile !== PROFILE) return state;
  startChannelsMock(META, COUNTS);
  return {
    ...state,
    account: ACCOUNT,
    inbox: { ...state.inbox, waiting: WAITING, tasks: HOLDINGS },
  };
}

async function* pushedOnce<View>(view: View): AsyncGenerator<View> {
  yield view;
}

type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind> | AsyncGenerator<unknown>;

const NO_AUTOMATIONS: AutomationListView = { automations: [] };

const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: ({ id }) => {
    // Note that the threads are read as they stand now, so a reply made in the mockup stays when the thread is opened again.
    const items = THREADS.filter((each) => each.taskId === id).map((each) => each.item);
    const pushed: CodingAgentInboxChanged["inbox"] = { items };
    return pushedOnce(pushed);
  },
  [ACT_KIND.CODING_AGENTS_LIST]: ({ taskId }) => {
    const agent = AGENTS.get(taskId);
    return { agents: agent === undefined ? [] : [agent] };
  },
  [ACT_KIND.AUTOMATIONS_FOLLOW]: (follow) =>
    pushedOnce(follow.kind === AUTOMATION_FOLLOW.WORKSPACE ? NO_AUTOMATIONS : { runs: [] }),
  [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => MEMBERS,
  [ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: ({ itemId }) => {
    const found = THREADS.find((each) => each.item.id === itemId);
    if (found === undefined) return { failure: "unanswered" };
    const now = Date.now();
    const item: InboxItem = {
      ...found.item,
      status: INBOX_STATUS.ANSWERED,
      answeredBy: DEAN,
      settledAt: now,
      revision: found.item.revision + 1,
    };
    (found as { item: InboxItem }).item = item;
    return { item, taken: true };
  },
  [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) => ({ id: itemId, unread }),
  [ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: ({ itemId, text, answers, clientKey }) => {
    const item = replied(itemId, text, answers, clientKey);
    return item === undefined ? { failure: "unanswered" } : { item };
  },
};

/**
 * A reply laid on its thread as the service would lay it, so a reply or an
 * answer in the mockup settles where it is written: the reader's message at
 * the thread's end, and an answer settling its ask and the thread.
 */
function replied(
  itemId: string,
  text: string,
  answers: InboxMessage["answers"],
  clientKey: string,
): InboxItem | undefined {
  const found = THREADS.find((each) => each.item.id === itemId);
  if (found === undefined) return undefined;
  const now = Date.now();
  const before = found.item.thread ?? [];
  const thread: InboxMessage[] = [
    ...before.map((message) =>
      answers !== undefined && message.ask?.status === INBOX_ASK_STATUS.OPEN
        ? { ...message, ask: { ...message.ask, status: INBOX_ASK_STATUS.ANSWERED } }
        : message,
    ),
    {
      id: fixtureId("e5000005", before.length + now),
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      member: DEAN,
      text,
      clientKey,
      ...(answers === undefined ? undefined : { answers }),
      createdAt: now,
    },
  ];
  const item: InboxItem = {
    ...found.item,
    thread,
    revision: found.item.revision + 1,
    updatedAt: now,
    ...(answers === undefined
      ? {}
      : { status: INBOX_STATUS.ANSWERED, answeredBy: DEAN, settledAt: now }),
  };
  (found as { item: InboxItem }).item = item;
  return item;
}

/** What the channels profile answers an act with, in place of main; none for any other kind or profile. */
export function channelsActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (profile !== PROFILE) return undefined;
  // SAFETY: the table is keyed by kind, as the Inbox fixture's is.
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined
    ? undefined
    : { answer: answer(payload) as PortActResult<PortActKind> };
}
