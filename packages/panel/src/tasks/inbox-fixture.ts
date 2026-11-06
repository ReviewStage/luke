import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHeldById,
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppStateSnapshot,
  RUN_PROFILE,
} from "@repo/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@repo/host/contract";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";

const LANDED = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const STAGED_PROFILES: ReadonlySet<string> = new Set<string>([
  RUN_PROFILE.INBOX,
  RUN_PROFILE.PERSON,
]);

const ADA = { userId: "user-ada", name: "Ada Lovelace" } as const;
const ACCOUNT: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: ADA.userId,
  email: "ada@example.com",
  name: ADA.name,
  provider: ACCOUNT_PROVIDER.GITHUB,
};

const TASK = {
  INVITES: FIXTURE_IDS.TASK,
  DIGEST: "3c9d5f7b-1e4a-4b62-8d8a-4f5a6b7c8d93",
  ROUNDING: "4dae6081-2f5b-4c73-9e9b-5a6b7c8d9ea4",
} as const;

const AGENT = {
  INVITES: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5",
  DIGEST: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6",
  ROUNDING: "70d19314-5c8e-4fa6-81ce-8d9eafb0c1d7",
} as const;

const MODEL = "anthropic/claude-opus-5.5";

function fixtureId(n: number): string {
  return `81e2a425-6d9f-4ab7-92df-${n.toString(16).padStart(12, "0")}`;
}

function agentSaid(n: number, ago: number, text: string, ask?: InboxMessage["ask"]): InboxMessage {
  return {
    id: fixtureId(n),
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text,
    ...(ask === undefined ? undefined : { ask }),
    createdAt: LANDED - ago,
  };
}

function adaSaid(
  n: number,
  ago: number,
  text: string,
  answers?: InboxMessage["answers"],
): InboxMessage {
  return {
    id: fixtureId(n),
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    member: ADA,
    text,
    ...(answers === undefined ? undefined : { answers }),
    createdAt: LANDED - ago,
  };
}

function item(
  n: number,
  agentId: string,
  key: string,
  title: string,
  thread: readonly InboxMessage[],
  standing: Partial<InboxItem> = {},
): InboxItem {
  const first = thread[0]?.createdAt ?? LANDED;
  const last = thread.at(-1)?.createdAt ?? first;
  const latestPost = thread.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
  return {
    id: fixtureId(n),
    agentId,
    key,
    revision: thread.length,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: latestPost?.ask !== undefined,
    status: INBOX_STATUS.OPEN,
    startedBy: ADA,
    waitsOn: ADA,
    thread,
    postedAt: first,
    updatedAt: last,
    ...standing,
  };
}

const OPEN = { status: INBOX_ASK_STATUS.OPEN } as const;

const INVITES_ITEMS: readonly InboxItem[] = [
  item(
    1,
    AGENT.INVITES,
    "withdraw-invite",
    "Who can withdraw an invite?",
    [
      agentSaid(
        101,
        12 * MINUTE,
        "An invite is a pending `memberships` row, so withdrawing one deletes it. The description leaves open who may.",
        {
          type: INBOX_ASK.DECIDE,
          options: [
            {
              label: "The member who sent it",
              detail: "Admins can't touch someone else's invite.",
            },
            { label: "Any admin", detail: "Senders wait on an admin to take one back." },
            { label: "Both", detail: "The sender, or any admin of the workspace." },
          ],
          recommended: "Both",
          ...OPEN,
        },
      ),
    ],
    { unread: true },
  ),
  item(2, AGENT.INVITES, "preview-migration", "Run the memberships migration on preview?", [
    agentSaid(
      102,
      40 * MINUTE,
      "The migration adds `state` to `memberships`, defaulting every row to `active`. It's safe to rerun, and preview holds no real members.",
      {
        type: INBOX_ASK.DECIDE,
        options: [
          { label: INBOX_APPROVAL_OPTION.APPROVE },
          { label: INBOX_APPROVAL_OPTION.DECLINE },
        ],
        recommended: INBOX_APPROVAL_OPTION.APPROVE,
        ...OPEN,
      },
    ),
  ]),
  item(3, AGENT.INVITES, "invite-limits", "Invite limits", [
    agentSaid(
      103,
      2 * HOUR,
      "A few values the invite flow needs before I wire the rate limit and the emails.",
      {
        type: INBOX_ASK.ANSWER,
        fields: [
          { type: INBOX_FIELD.NUMBER, label: "Invites a member may send a day", required: true },
          {
            type: INBOX_FIELD.SELECT,
            label: "Who sees pending invites",
            options: ["Admins", "Every member"],
            recommended: "Every member",
          },
          { type: INBOX_FIELD.BOOLEAN, label: "Email the sender when an invite is accepted" },
          { type: INBOX_FIELD.TEXT, label: "Reply-to address" },
        ],
        ...OPEN,
      },
    ),
  ]),
  item(
    4,
    AGENT.INVITES,
    "accept-race",
    "acceptInvite can add a member twice",
    [
      agentSaid(
        104,
        3 * HOUR,
        [
          "The member is added before the invite is marked accepted, so a link opened twice at once adds them twice:",
          "",
          "```ts",
          "export async function acceptInvite(token: string) {",
          "  const invite = await db.invites.find(token);",
          '  if (!invite || invite.acceptedAt) throw new InviteError("no-longer-valid");',
          "  await db.members.add(invite.workspaceId, invite.email);",
          "  await db.invites.accept(invite.id);",
          "}",
          "```",
          "",
          "I'm moving both writes into one transaction that claims the invite first.",
        ].join("\n"),
      ),
    ],
    { unread: true },
  ),
  item(5, AGENT.INVITES, "expired-copy", "What the expired invite page says", [
    agentSaid(
      105,
      2 * DAY,
      "The expired-invite page needs words. Should it name who sent the invite?",
      { type: INBOX_ASK.DECIDE, options: [{ label: "Name them" }, { label: "Don't" }], ...OPEN },
    ),
    adaSaid(106, 2 * DAY - 20 * MINUTE, "", {
      ask: fixtureId(105),
      reply: INBOX_REPLY.CHOSE,
      choices: ["Name them"],
    }),
    agentSaid(
      107,
      2 * DAY - 30 * MINUTE,
      'Done: "Maya\'s invite to Acme has expired." Should it offer to ask Maya for a new one?',
    ),
    adaSaid(
      108,
      DAY + 6 * HOUR,
      "Yes, but only while Maya is still a member. Otherwise just say it expired.",
    ),
    agentSaid(
      109,
      DAY + 5 * HOUR,
      'Makes sense. A removed sender reads as "This invite has expired" with no button.',
    ),
    adaSaid(110, DAY + 2 * HOUR, "And a withdrawn invite?"),
    agentSaid(
      111,
      DAY + HOUR,
      'Withdrawn reads the same as used: "This invite is no longer valid." Nothing names who withdrew it.',
    ),
    adaSaid(112, 5 * HOUR, "Good. Ship it like that."),
    agentSaid(
      113,
      4 * HOUR,
      "Last one: the button's label. I have **Ask Maya for a new invite**, which runs long on a phone.",
      { type: INBOX_ASK.ANSWER, ...OPEN },
    ),
  ]),
];

const DIGEST_ITEMS: readonly InboxItem[] = [
  item(11, AGENT.DIGEST, "sender-domain", "Verify the digest's sender domain", [
    agentSaid(
      201,
      25 * MINUTE,
      "The digest sends from `digest@relay.example.com`, which the mail provider won't send from until the domain is verified.",
      {
        type: INBOX_ASK.DO,
        steps: [
          "Open the mail provider's **Domains** page and add `relay.example.com`.",
          "Add the three DNS records it shows at your registrar.",
          "Press **Verify** once they've spread, which can take an hour.",
        ],
        ...OPEN,
      },
    ),
  ]),
  item(12, AGENT.DIGEST, "digest-subject", "The digest's subject line", [
    agentSaid(
      202,
      90 * MINUTE,
      "Right now it's \"Your week in Relay\". Something that says what's inside would get opened more.",
      { type: INBOX_ASK.ANSWER, ...OPEN },
    ),
  ]),
  item(
    13,
    AGENT.DIGEST,
    "digest-day",
    "Which day the digest goes out",
    [
      agentSaid(203, 3 * DAY, "Which morning should it land?", {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Monday" }, { label: "Friday" }],
        status: INBOX_ASK_STATUS.ANSWERED,
      }),
      adaSaid(204, 3 * DAY - 2 * HOUR, "Monday, before standup.", {
        ask: fixtureId(203),
        reply: INBOX_REPLY.CHOSE,
        choices: ["Monday"],
      }),
    ],
    {
      status: INBOX_STATUS.ANSWERED,
      answeredBy: ADA,
      settledAt: LANDED - 3 * DAY + 2 * HOUR,
    },
  ),
];

const ROUNDING_ITEMS: readonly InboxItem[] = [
  item(
    21,
    AGENT.ROUNDING,
    "rounding-mode",
    "Round half-cents up or to even?",
    [
      agentSaid(
        301,
        4 * DAY,
        "Totals round half-cents up today. Banker's rounding would match the bank's statements.",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Up" }, { label: "To even" }],
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The ledger's spec already says to even.",
        },
      ),
    ],
    {
      status: INBOX_STATUS.CLOSED,
      closedReason: "The ledger's spec already says to even.",
      settledAt: LANDED - 4 * DAY + HOUR,
    },
  ),
];

const INBOXES: ReadonlyMap<string, readonly InboxItem[]> = new Map([
  [TASK.INVITES, INVITES_ITEMS],
  [TASK.DIGEST, DIGEST_ITEMS],
  [TASK.ROUNDING, ROUNDING_ITEMS],
]);

function asking(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.OPEN &&
    (item.thread ?? []).some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)
  );
}

function newest(items: readonly InboxItem[]): number {
  return Math.max(...items.map((each) => each.updatedAt));
}

const HOLDINGS: readonly AppInboxTaskHolding[] = [...INBOXES]
  .map(([taskId, items]) => ({
    taskId,
    items: items.length,
    toDo: items.filter(asking).length,
    updatedAt: newest(items),
  }))
  .toSorted((a, b) => b.updatedAt - a.updatedAt);

const WAITING: readonly AppInboxTask[] = HOLDINGS.flatMap(({ taskId }) => {
  const open = (INBOXES.get(taskId) ?? []).filter((each) => each.status === INBOX_STATUS.OPEN);
  return open.length === 0
    ? []
    : [
        {
          taskId,
          items: open.map((each) => {
            const { id, agentId, title, postedAt } = each;
            return { id, agentId, title, postedAt, asking: asking(each) };
          }),
        },
      ];
});

function agentOn(
  id: string,
  taskId: string,
  title: string,
  status: AgentSummary["status"],
  startedAgo: number,
): AgentSummary {
  return {
    id,
    planId: taskId,
    model: MODEL,
    effort: "high",
    title,
    createdAt: LANDED - startedAgo,
    status,
    turnId: null,
    runStartedAt: LANDED - startedAgo,
    startedBy: ADA,
  };
}

const AGENTS: ReadonlyMap<string, AgentSummary> = new Map([
  [
    TASK.INVITES,
    agentOn(
      AGENT.INVITES,
      TASK.INVITES,
      "Build teammate invitations",
      AGENT_STATUS.RUNNING,
      3 * DAY,
    ),
  ],
  [
    TASK.DIGEST,
    agentOn(AGENT.DIGEST, TASK.DIGEST, "Send the weekly digest", AGENT_STATUS.RUNNING, 4 * HOUR),
  ],
  [
    TASK.ROUNDING,
    agentOn(AGENT.ROUNDING, TASK.ROUNDING, "Fix ledger rounding", AGENT_STATUS.COMPLETED, 5 * DAY),
  ],
]);

function agentsLine(taskId: string): Pick<TaskSummary, "agents"> {
  const agent = AGENTS.get(taskId);
  if (agent === undefined) return {};
  const working = agent.status === AGENT_STATUS.RUNNING ? 1 : 0;
  return {
    agents: {
      total: 1,
      working,
      activityAt: newest(INBOXES.get(taskId) ?? []),
      agents: [
        {
          id: agent.id,
          title: agent.title,
          model: agent.model,
          effort: agent.effort,
          status: agent.status,
          at: agent.runStartedAt ?? agent.createdAt,
          startedBy: ADA,
        },
      ],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

const OWN_TASKS: readonly TaskSummary[] = [
  {
    id: TASK.DIGEST,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: "Weekly digest email",
    createdAt: LANDED - 2 * DAY,
    updatedAt: LANDED - 25 * MINUTE,
    repository: "ada/relay",
    status: TASK_STATUS.IN_PROGRESS,
    priority: TASK_PRIORITY.MEDIUM,
    number: 43,
    ownerId: ADA.userId,
    createdBy: ADA,
    assignee: ADA,
    ...agentsLine(TASK.DIGEST),
  },
  {
    id: TASK.ROUNDING,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: "Ledger rounding",
    createdAt: LANDED - 6 * DAY,
    updatedAt: LANDED - 4 * DAY,
    repository: "ada/ledger",
    status: TASK_STATUS.DONE,
    completedAt: LANDED - 4 * DAY,
    priority: TASK_PRIORITY.LOW,
    number: 41,
    ownerId: ADA.userId,
    createdBy: ADA,
    ...agentsLine(TASK.ROUNDING),
  },
];

export function inboxTasksView(profile: string, list: TasksView): TasksView {
  if (!STAGED_PROFILES.has(profile)) return list;
  const tasks = list.tasks.map((task) =>
    task.id === TASK.INVITES
      ? { ...task, ownerId: ADA.userId, createdBy: ADA, assignee: ADA, ...agentsLine(task.id) }
      : task,
  );
  return { ...list, tasks: [...tasks, ...OWN_TASKS] };
}

export function inboxReader(profile: string): string | undefined {
  return STAGED_PROFILES.has(profile) ? ADA.userId : undefined;
}

const STAGED_INBOX = new WeakMap<AppStateSnapshot["inbox"], AppStateSnapshot["inbox"]>();

function stagedInbox(inbox: AppStateSnapshot["inbox"]): AppStateSnapshot["inbox"] {
  const held = STAGED_INBOX.get(inbox);
  if (held !== undefined) return held;
  const staged = { ...inbox, waiting: WAITING, tasks: HOLDINGS };
  STAGED_INBOX.set(inbox, staged);
  return staged;
}

function noneHeldIn(workspaceIds: readonly string[]): AppHeldById<readonly never[]> {
  return Object.fromEntries(workspaceIds.map((id) => [id, { rows: [] }]));
}

export function inboxAppState(
  state: AppStateSnapshot,
  workspaceIds: readonly string[],
): AppStateSnapshot {
  if (!STAGED_PROFILES.has(state.run.profile)) return state;
  const fed = Object.fromEntries([...INBOXES].filter(([, items]) => items.length > 0));
  return {
    ...state,
    account: ACCOUNT,
    inbox: stagedInbox(state.inbox),
    [LIVE_READ.INBOX_ITEMS]: {
      rows: { [INBOX_SCOPE_KIND.PLAN]: fed, [INBOX_SCOPE_KIND.AGENT]: {} },
    },
    [LIVE_READ.AUTOMATIONS]: noneHeldIn(workspaceIds),
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: noneHeldIn(workspaceIds),
  };
}

type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind>;

const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.AGENTS_LIST]: ({ taskId }) => {
    const agent = AGENTS.get(taskId);
    return { agents: agent === undefined ? [] : [agent] };
  },
  [ACT_KIND.AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) => ({ id: itemId, unread }),
  [ACT_KIND.AGENTS_INBOX_READ_ALL]: () => ({
    marked: [...INBOXES.values()].flat().filter(({ unread }) => unread === true).length,
  }),
};

export function inboxActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!STAGED_PROFILES.has(profile)) return undefined;
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined ? undefined : { answer: answer(payload) };
}
