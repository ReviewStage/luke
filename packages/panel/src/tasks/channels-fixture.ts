/**
 * channels-fixture.ts -- the synthetic workspace the `channels` fixture profiles draw: its channels, their threads, and the answers the Channels view reads them by in place of the service's (STAG-547).
 *
 * The Inbox fixture's machinery (`inbox-fixture.ts`) over Luke's own kind of
 * work: two people, a handful of tasks across the app, the service, and
 * infra, and threads in each channel, open asks of each kind and notices,
 * some settled on earlier days. `channels` reads it as Dean, and
 * `channels-teammate` as Charles, his teammate, so the two windows can be
 * set side by side. Every profile turns Channels on. Nothing is read from
 * an account; every name and address here is invented.
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { AUTOMATION_FOLLOW, type AutomationListView } from "@luke/features/automation-view";
import type { Channel, ChannelThread } from "@luke/features/channel-wire";
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
  threadNeedsReader,
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
import { EXPERIMENT } from "@luke/settings";

const LANDED = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Who each profile reads as: Dean, or Charles, his teammate, to set the two windows side by side. */
const READERS: ReadonlyMap<string, { readonly userId: string; readonly name: string }> = new Map([
  [RUN_PROFILE.CHANNELS, { userId: "user-dean", name: "Dean Stratakos" }],
  [RUN_PROFILE.CHANNELS_TEAMMATE, { userId: "user-charles", name: "Charles Pan" }],
]);
const REPOSITORY = "ReviewStage/luke";
const MODEL = "anthropic/claude-opus-5.5";

const DEAN = { userId: "user-dean", name: "Dean Stratakos" } as const;
const CHARLES = { userId: "user-charles", name: "Charles Pan" } as const;

/** The account a profile signs in as. */
function accountOf(reader: Person): AccountSnapshot {
  return {
    status: ACCOUNT_STATUS.SIGNED_IN,
    id: reader.userId,
    email: `${reader.userId.replace("user-", "")}@example.com`,
    name: reader.name,
    provider: ACCOUNT_PROVIDER.GITHUB,
  };
}

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

/* ----- The channels ----- */

const CHANNEL = {
  APP: fixtureId("f6000006", 1),
  SERVICE: fixtureId("f6000006", 2),
  INFRA: fixtureId("f6000006", 3),
  GENERAL: fixtureId("f6000006", 4),
  CHANNELS: fixtureId("f6000006", 5),
} as const;

/** A channel as the service keeps it, before what it counts for a reader. */
type ChannelSeed = Pick<Channel, "id" | "name" | "purpose" | "project" | "createdAt"> & {
  readonly createdBy?: Person;
};

/** The workspace's open channels, by name, as the service lists them; a write here moves them for the run. */
let CHANNELS: readonly ChannelSeed[] = [
  {
    id: CHANNEL.APP,
    name: "app",
    purpose: "Desktop, web client, panel, ui, catalog, iOS, voice",
    project: false,
    createdAt: LANDED - 30 * DAY,
    createdBy: DEAN,
  },
  {
    id: CHANNEL.CHANNELS,
    name: "channels",
    purpose: "Project: threads read by topic, archived when it ships",
    project: true,
    createdAt: LANDED - 2 * DAY,
    createdBy: DEAN,
  },
  {
    id: CHANNEL.GENERAL,
    name: "general",
    purpose: "Anything that cuts across, and every thread that names no channel",
    project: false,
    createdAt: LANDED - 30 * DAY,
  },
  {
    id: CHANNEL.INFRA,
    name: "infra",
    purpose: "CI, release, dependencies, Vercel, Neon, Sentry",
    project: false,
    createdAt: LANDED - 30 * DAY,
    createdBy: CHARLES,
  },
  {
    id: CHANNEL.SERVICE,
    name: "service",
    purpose: "Service, database, features, wire, agent-runner, web server",
    project: false,
    createdAt: LANDED - 30 * DAY,
    createdBy: CHARLES,
  },
];

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
    name: "Thread search",
    agentTitle: "Search the threads",
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
  /** The channel it is posted to, by id. */
  readonly channelId: string;
}

function thread(
  n: number,
  task: TaskSeed,
  channelId: string,
  title: string,
  messages: readonly InboxMessage[],
  standing: Partial<InboxItem> = {},
): ThreadSeed {
  const first = messages[0]?.createdAt ?? LANDED;
  const last = messages.at(-1)?.createdAt ?? first;
  return {
    taskId: task.id,
    channelId,
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
    CHANNEL.SERVICE,
    "Thread search and Channels schema both change inbox-store.ts",
    [
      agentSaid(
        101,
        2 * MINUTE,
        [
          "Charles's **Thread search** and this task both edit `postMessage` and `unreadFor` in [inbox-store.ts](https://github.com/ReviewStage/luke/blob/HEAD/packages/service/src/inbox/inbox-store.ts). The branches will conflict, and Thread search indexes the table Channels schema retires.",
          "",
          "Asking you both, since either task could wait.",
        ].join("\n"),
        {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: "Pause Thread search", detail: "It picks up on top of the new thread table." },
            { label: "Land Thread search first", detail: "Channels schema rebases onto it." },
            { label: "Carry on, rebase later" },
          ],
          recommended: "Pause Thread search",
          ...OPEN,
        },
      ),
    ],
    { unread: true, needsReply: true },
  ),
  thread(
    2,
    seed(TASK.ROWS),
    CHANNEL.APP,
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
    CHANNEL.INFRA,
    "Add SENTRY_DSN to the preview environment",
    [
      agentSaid(
        103,
        HOUR,
        "Previews never report to Sentry because the DSN isn't set for Vercel's Preview environment. Only someone with access to the project's settings can add it.",
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
    CHANNEL.SERVICE,
    "Ready: give inbox threads a channel",
    [
      agentSaid(
        104,
        3 * HOUR,
        "Opened the pull request: `inbox_item` gains `channel_id`, and a thread in a channel is readable by every member of the workspace. The migration is additive.",
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
    CHANNEL.CHANNELS,
    "Where does a new project channel go in the sidebar?",
    [
      agentSaid(
        106,
        70 * MINUTE,
        "A project channel can stand under Projects in the order it was made, or by name like the standing channels.",
        {
          type: INBOX_ASK.DECIDE,
          options: [
            { label: "By name", detail: "As the standing channels are." },
            { label: "Newest first" },
          ],
          recommended: "By name",
          ...OPEN,
        },
      ),
    ],
  ),
  thread(6, seed(TASK.SCHEMA), CHANNEL.APP, "Inbox threads now carry a channel", [
    agentSaid(
      107,
      90 * MINUTE,
      "Anything in the panel that builds an `InboxItem` by hand, fixtures and tests included, needs `channelId` once #5331 lands. Rows and the pane read it; nothing else changes.",
    ),
  ]),
  thread(
    7,
    seed(TASK.SEARCH),
    CHANNEL.SERVICE,
    "Don't add columns to inbox_message until the backfill lands",
    [
      memberSaid(
        108,
        CHARLES,
        20 * MINUTE,
        "The batched backfill runs Thursday. Until then a migration on `inbox_message` conflicts with it. Pinned until Friday, and told the three agents working in #service.",
      ),
    ],
    { startedBy: CHARLES, waitsOn: CHARLES },
  ),
  thread(
    8,
    seed(TASK.POLISH),
    CHANNEL.APP,
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
  thread(9, seed(TASK.SENTRY), CHANNEL.INFRA, "CI can't reach Neon from forks", [
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
  ]),
  thread(
    10,
    seed(TASK.ROWS),
    CHANNEL.APP,
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
    CHANNEL.SERVICE,
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
    CHANNEL.GENERAL,
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
    CHANNEL.APP,
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

/**
 * More of the week, so a channel shows what folds away and what is new: a
 * second open ask from the Inbox rows task beside its first, and threads
 * settled on earlier days.
 */
THREADS.push(
  thread(
    14,
    seed(TASK.ROWS),
    CHANNEL.APP,
    "Which glyph for an empty Inbox?",
    [
      agentSaid(
        118,
        30 * MINUTE,
        'An empty Inbox shows the tray today, which reads as "nothing here" rather than "you\'re done".',
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "A tick", detail: "Says you're done." }, { label: "Keep the tray" }],
          recommended: "A tick",
          ...OPEN,
        },
      ),
    ],
    { unread: true },
  ),
  thread(
    15,
    seed(TASK.ROWS),
    CHANNEL.APP,
    "Shipped: the Inbox row's hover card",
    [
      agentSaid(
        119,
        2 * DAY,
        "#4871 merged. Hovering a row shows its task, agent and latest word.",
      ),
    ],
    { status: INBOX_STATUS.ANSWERED, settledAt: LANDED - 2 * DAY },
  ),
  thread(
    16,
    seed(TASK.POLISH),
    CHANNEL.APP,
    "Shipped: the sidebar no longer jumps when a section folds",
    [agentSaid(120, 3 * DAY, "#4842 merged. Folding a section keeps the rows under it in place.")],
    {
      startedBy: CHARLES,
      waitsOn: CHARLES,
      status: INBOX_STATUS.ANSWERED,
      settledAt: LANDED - 3 * DAY,
    },
  ),
  thread(
    17,
    seed(TASK.ROWS),
    CHANNEL.APP,
    "Keep the cards' corner radius in the grid?",
    [
      agentSaid(
        121,
        2 * DAY + 3 * HOUR,
        "The grid's cards use 10px corners; the list's rows use 8px.",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Match the list" }, { label: "Keep 10px" }],
          status: INBOX_ASK_STATUS.ANSWERED,
        },
      ),
      memberSaid(122, DEAN, 2 * DAY + 2 * HOUR, "", {
        ask: fixtureId("c3000003", 121),
        reply: INBOX_REPLY.CHOSE,
        choices: ["Match the list"],
      }),
    ],
    { status: INBOX_STATUS.ANSWERED, answeredBy: DEAN, settledAt: LANDED - 2 * DAY - 2 * HOUR },
  ),
  thread(
    18,
    seed(TASK.SEARCH),
    CHANNEL.SERVICE,
    "Shipped: the inbox_message backfill runs in batches",
    [
      agentSaid(
        123,
        2 * DAY,
        "#4851 merged. The backfill takes 2,000 rows at a time and holds no long lock.",
      ),
    ],
    {
      startedBy: CHARLES,
      waitsOn: CHARLES,
      status: INBOX_STATUS.ANSWERED,
      settledAt: LANDED - 2 * DAY,
    },
  ),
  thread(
    19,
    seed(TASK.INDEX),
    CHANNEL.SERVICE,
    "Shipped: the sweep reads abandoned turns by index",
    [agentSaid(124, 3 * DAY, "#4838 merged. The abandoned-turn scan uses the new partial index.")],
    {
      startedBy: CHARLES,
      waitsOn: CHARLES,
      status: INBOX_STATUS.ANSWERED,
      settledAt: LANDED - 3 * DAY,
    },
  ),
);

/** An ask from three days ago, still waiting on Dean, which a stream opened at its newest post leaves scrolled out of sight. */
THREADS.push(
  thread(20, seed(TASK.ROWS), CHANNEL.APP, "Rename the Inbox's To do scope?", [
    agentSaid(
      125,
      3 * DAY,
      "The Inbox's first scope is called To do in code and For you on screen. One name would save a mapping in every view.",
      {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "For you everywhere" }, { label: "To do everywhere" }],
        recommended: "For you everywhere",
        ...OPEN,
      },
    ),
  ]),
);

/** When each reader last looked at each channel, so the stream draws its New line before what came after. */
const LAST_LOOKED: ReadonlyMap<string, Map<string, number>> = new Map([
  [
    DEAN.userId,
    new Map<string, number>([
      [CHANNEL.APP, LANDED - 2 * HOUR],
      [CHANNEL.SERVICE, LANDED - 30 * MINUTE],
      [CHANNEL.INFRA, LANDED - 2 * DAY],
      [CHANNEL.GENERAL, LANDED - DAY],
      [CHANNEL.CHANNELS, LANDED - 3 * HOUR],
    ]),
  ],
  [
    CHARLES.userId,
    new Map<string, number>([
      [CHANNEL.APP, LANDED - 4 * HOUR],
      [CHANNEL.SERVICE, LANDED - 3 * HOUR],
      [CHANNEL.INFRA, LANDED - DAY],
      [CHANNEL.GENERAL, LANDED - 3 * DAY],
      [CHANNEL.CHANNELS, LANDED - DAY],
    ]),
  ],
]);

/* ----- The service's reads ----- */

function newest(items: readonly InboxItem[]): number {
  return Math.max(...items.map((each) => each.updatedAt));
}

/** A task's threads as they stand now, so an answer given in the run stays when the thread is read again. */
function itemsOf(taskId: string): readonly InboxItem[] {
  return THREADS.filter((each) => each.taskId === taskId).map((each) => each.item);
}

/** The member the window reads as, which the profile names as the fixture lands. */
let READER: Person = DEAN;

/** Whether a thread asks the reader something still open. */
function needsReader(each: InboxItem): boolean {
  return threadNeedsReader(each, READER.userId);
}

/** The workspace's channels as the reader reads them: each with what waits on them in it and when they last looked. */
function channelsRead(): readonly Channel[] {
  const looked = LAST_LOOKED.get(READER.userId);
  return CHANNELS.map((channel) => {
    const at = looked?.get(channel.id);
    const { createdBy, ...rest } = channel;
    return {
      ...rest,
      ...(createdBy === undefined ? {} : { createdBy: createdBy.userId }),
      waiting: THREADS.filter((each) => each.channelId === channel.id && needsReader(each.item))
        .length,
      ...(at === undefined ? {} : { lookedAt: at }),
    };
  });
}

/** A channel's threads, oldest posted first, as the service reads them. */
function threadsOf(channelId: string): readonly ChannelThread[] {
  return THREADS.filter((each) => each.channelId === channelId)
    .map((each) => ({
      ...each.item,
      channelId,
      agent: { title: seed(each.taskId).agentTitle, model: MODEL },
    }))
    .toSorted((a, b) => a.postedAt - b.postedAt);
}

/** Every task holding threads, as main's read of the account names it. */
function holdings(): readonly AppInboxTaskHolding[] {
  return TASKS.map((task) => [task.id, itemsOf(task.id)] as const)
    .filter(([, items]) => items.length > 0)
    .map(([taskId, items]) => ({
      taskId,
      items: items.length,
      toDo: items.filter(needsReader).length,
      updatedAt: newest(items),
    }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
}

/** What waits on the reader, as main counts it. */
function waiting(): readonly AppInboxTask[] {
  return holdings().flatMap(({ taskId }) => {
    const open = itemsOf(taskId).filter(needsReader);
    return open.length === 0
      ? []
      : [
          {
            taskId,
            items: open.map(({ id, agentId, title, postedAt }) => ({
              id,
              agentId,
              title,
              postedAt,
            })),
          },
        ];
  });
}

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
  const items = itemsOf(task.id);
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

/** The list as the channels profiles draw it: the first workspace named Stage, holding Luke's tasks alone. */
export function channelsTasksView(profile: string, list: TasksView): TasksView {
  if (!READERS.has(profile)) return list;
  return {
    ...list,
    workspaces: list.workspaces
      .filter((workspace) => workspace.id === FIXTURE_IDS.WORKSPACE)
      .map(({ personal: _personal, ...workspace }) => ({
        ...workspace,
        name: "Stage",
        slug: "stage",
        memberCount: MEMBERS.length,
        github: { login: "ReviewStage", active: true },
      })),
    tasks: TASKS.map(taskSummary),
  };
}

/** The account the channels profiles sign in as. */
export function channelsReader(profile: string): string | undefined {
  return READERS.get(profile)?.userId;
}

/** Main's settings with Channels on, one object for each of main's. */
const STAGED_SETTINGS = new WeakMap<
  NonNullable<AppStateSnapshot["settings"]>,
  NonNullable<AppStateSnapshot["settings"]>
>();

function stagedSettings(
  settings: NonNullable<AppStateSnapshot["settings"]>,
): NonNullable<AppStateSnapshot["settings"]> {
  const held = STAGED_SETTINGS.get(settings);
  if (held !== undefined) return held;
  const staged = {
    ...settings,
    experiments: { ...settings.experiments, [EXPERIMENT.CHANNELS]: true },
  };
  STAGED_SETTINGS.set(settings, staged);
  return staged;
}

/** Main's document under the channels profiles: the reader signed in, what waits on them, and Channels on. */
export function channelsAppState(state: AppStateSnapshot): AppStateSnapshot {
  const reader = READERS.get(state.run.profile);
  if (reader === undefined) return state;
  READER = reader.userId === CHARLES.userId ? CHARLES : DEAN;
  return {
    ...state,
    account: accountOf(READER),
    inbox: { ...state.inbox, waiting: waiting(), tasks: holdings() },
    ...(state.settings === undefined ? undefined : { settings: stagedSettings(state.settings) }),
  };
}

async function* pushedOnce<View>(view: View): AsyncGenerator<View> {
  yield view;
}

type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind> | AsyncGenerator<unknown>;

const NO_AUTOMATIONS: AutomationListView = { automations: [] };

/** The workspace's channels as they then stand, as every channel write answers. */
function channelsAnswer() {
  return { channels: channelsRead() };
}

/** A channel's stored row changed by `change`, where it is one this run holds. */
function changed(channelId: string, change: (channel: ChannelSeed) => ChannelSeed | undefined) {
  CHANNELS = CHANNELS.flatMap((channel) => {
    if (channel.id !== channelId) return [channel];
    const next = change(channel);
    return next === undefined ? [] : [next];
  });
}

const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]: ({ id }) => {
    const pushed: CodingAgentInboxChanged["inbox"] = { items: itemsOf(id) };
    return pushedOnce(pushed);
  },
  [ACT_KIND.CODING_AGENTS_LIST]: ({ taskId }) => {
    const agent = AGENTS.get(taskId);
    return { agents: agent === undefined ? [] : [agent] };
  },
  [ACT_KIND.AUTOMATIONS_FOLLOW]: (follow) =>
    pushedOnce(follow.kind === AUTOMATION_FOLLOW.WORKSPACE ? NO_AUTOMATIONS : { runs: [] }),
  [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => MEMBERS,
  [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) => ({ id: itemId, unread }),
  [ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: ({ itemId, text, answers }) => {
    const item = replied(itemId, text, answers);
    return item === undefined ? { failure: "unanswered" } : { item };
  },
  [ACT_KIND.CHANNELS_LIST]: () => channelsAnswer(),
  [ACT_KIND.CHANNELS_THREADS]: ({ channelId }) => ({ threads: threadsOf(channelId) }),
  [ACT_KIND.CHANNELS_LOOK]: ({ channelId }) => {
    LAST_LOOKED.get(READER.userId)?.set(channelId, Date.now());
    return channelsAnswer();
  },
  [ACT_KIND.CHANNELS_CREATE]: ({ name, purpose, project }) => {
    if (CHANNELS.some((channel) => channel.name === name)) return { failure: "name-taken" };
    const made: ChannelSeed = {
      id: crypto.randomUUID(),
      name,
      purpose,
      project: project === true,
      createdAt: Date.now(),
      createdBy: READER,
    };
    CHANNELS = [...CHANNELS, made].toSorted((a, b) => a.name.localeCompare(b.name));
    return channelsAnswer();
  },
  [ACT_KIND.CHANNELS_FOLLOW]: () => pushedOnce({ moved: [] }),
  [ACT_KIND.CHANNELS_ARCHIVED]: () => ({ channels: [] }),
  [ACT_KIND.CHANNELS_EDIT]: ({ channelId, name, purpose }) => {
    const standing = CHANNELS.find((channel) => channel.id === channelId);
    if (standing === undefined) return { failure: "not-found" };
    const renamed = name !== undefined && name !== standing.name;
    if (renamed && CHANNELS.some((channel) => channel.name === name)) {
      return { failure: "name-taken" };
    }
    if (renamed && channelId === CHANNEL.GENERAL) return { failure: "not-permitted" };
    changed(channelId, (channel) => ({
      ...channel,
      ...(name === undefined ? undefined : { name }),
      ...(purpose === undefined ? undefined : { purpose }),
    }));
    CHANNELS = CHANNELS.toSorted((a, b) => a.name.localeCompare(b.name));
    return channelsAnswer();
  },
  [ACT_KIND.CHANNELS_ARCHIVE]: ({ channelId }) => {
    if (channelId === CHANNEL.GENERAL) return { failure: "not-permitted" };
    changed(channelId, () => undefined);
    return channelsAnswer();
  },
};

/**
 * A reply laid on its thread as the service would lay it, so an answer
 * given in the run settles where it is written: the reader's message at the
 * thread's end, and an answer settling its ask and the thread.
 */
function replied(
  itemId: string,
  text: string,
  answers: InboxMessage["answers"],
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
      member: READER,
      text,
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
      : { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: now }),
  };
  (found as { item: InboxItem }).item = item;
  return item;
}

/** What the channels profiles answer an act with, in place of main; none for any other kind or profile. */
export function channelsActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!READERS.has(profile)) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload and answering its
  // result, or a follow's pushes, which its caller iterates as the port's stream.
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined
    ? undefined
    : { answer: answer(payload) as PortActResult<PortActKind> };
}
