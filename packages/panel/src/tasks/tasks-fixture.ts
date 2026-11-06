import { LIVE_READ } from "@repo/features/live-wire";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionDocument,
  type DescriptionRevisionLine,
  type DescriptionRevisionsAnswer,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  COMMENT_SUBJECT,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksView,
} from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHeldById,
  type AppHistories,
  type AppDescriptionComments,
  type AppDescriptionDocuments,
  type AppRepositoryLists,
  type AppStateSnapshot,
  EVERY_WORKSPACE,
  RUN_PROFILE,
} from "@repo/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@repo/host/contract";
import { FIXTURE_IDS, FIXTURE_TASK_NAME } from "@repo/host/fixture-stage";
import type { SettingsLink } from "@repo/settings/settings-views";
import {
  agentActAnswer,
  agentAppState,
  agentColumnTab,
  agentSidePanel,
  agentTasksView,
  FIXTURE_AGENT_ID,
} from "./agent-fixture.js";
import { automationsAppState, automationsLaunchPlace } from "./automations-fixture.js";
import {
  FIXTURE_PERSON,
  settingsActAnswer,
  settingsAppState,
  settingsLaunchLink,
  settingsTasksView,
} from "./settings-fixture.js";
import type { MainTab } from "./use-main-tabs.js";
import {
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
  type StagedSidePanel,
} from "./use-side-panel.js";
import type { AutomationsPlace } from "./use-tasks-tab.js";

const FIXTURE_FIRST: Workspace = {
  id: FIXTURE_IDS.WORKSPACE,
  name: "Ada Lovelace",
  slug: "personal",
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ada", active: true },
  personal: true,
};
const FIXTURE_TEAM: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};
const FIXTURE_WORKSPACES: readonly Workspace[] = [FIXTURE_FIRST, FIXTURE_TEAM];

export const FIXTURE_WORKSPACE_IDS: readonly string[] = FIXTURE_WORKSPACES.map(({ id }) => id);

const FIXTURE_SECTIONS = [
  "## Context",
  "Only an admin can add someone to a workspace, by creating their account by hand, so " +
    "members wait on an admin to bring a teammate in.",
  "## Goal",
  "- A member invites a teammate by email.\n" +
    "- The teammate joins the workspace by opening the link.",
  "## Approach",
  "- Model an invite as a `memberships` row with `state = pending` " +
    "(`src/db/schema/memberships.ts`), so removal covers invites and members alike.\n" +
    "- `src/members/invite.ts` (new) sends an invite and accepts one, following " +
    "`src/members/remove.ts`.",
  "## Interfaces",
  "`src/members/invite.ts`",
  "```ts\n" +
    "export function inviteMember(workspaceId: string, email: string): Promise<Membership>;\n" +
    "export function acceptInvite(token: string): Promise<Membership>;\n" +
    "```",
  "## Alternatives",
  "- A separate `invitations` table: lost because removing a member would then have to " +
    "clear two tables.",
  "## Hard parts",
  "- A withdrawn or accepted invite link is opened again: the page reads " +
    '"This invite is no longer valid" and grants nothing.',
  "## Not doing",
  "- Inviting someone by a link anyone can open: every invite names one email address.",
  "## Testing",
  "- When a member invites an address, then one email with a link reaches it.",
  "## Open questions",
  "- Who can withdraw an invite: the member who sent it, any admin, or both?",
  "## Assumptions",
  "- Invites reuse memberships with a pending state.\n" +
    "- Members and admins can both invite.\n" +
    "- An invite expires after 7 days.",
];

const FIXTURE_TEXT = FIXTURE_SECTIONS.join("\n\n");

const CALL_AT = Date.parse("2026-10-07T16:40:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const FIXTURE_TASK_ID = FIXTURE_IDS.TASK;

const FIXTURE_TASK: Task = {
  id: FIXTURE_TASK_ID,
  workspaceId: FIXTURE_FIRST.id,
  name: FIXTURE_TASK_NAME,
  createdAt: CALL_AT - 2 * DAY - 2 * HOUR,
  updatedAt: CALL_AT,
  repository: "ada/relay",
  createdBy: FIXTURE_PERSON.ADA,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  document: { body: `${FIXTURE_TEXT}\n`, assumptions: [] },
};

function draftOf(sections: number): DescriptionDocument {
  return { body: `${FIXTURE_SECTIONS.slice(0, sections * 2).join("\n\n")}\n`, assumptions: [] };
}

const FIXTURE_HISTORY: readonly {
  readonly line: DescriptionRevisionLine;
  readonly document: DescriptionDocument;
}[] = [
  {
    line: {
      seq: 5,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.DEVELOPER,
        by: FIXTURE_PERSON.ADA,
        at: CALL_AT,
        duringCall: false,
      },
      startedAt: CALL_AT - 20 * 60_000,
      changes: 3,
    },
    document: FIXTURE_TASK.document,
  },
  {
    line: {
      seq: 4,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.AGENT,
        label: "Invite emails",
        at: CALL_AT - 2 * HOUR,
        duringCall: false,
      },
      startedAt: CALL_AT - 2 * HOUR - 10 * 60_000,
      changes: 2,
    },
    document: draftOf(10),
  },
  {
    line: {
      seq: 3,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.NOTETAKER,
        by: FIXTURE_PERSON.ADA,
        at: CALL_AT - 5 * HOUR,
        duringCall: false,
      },
      startedAt: CALL_AT - 5 * HOUR - 25 * 60_000,
      changes: 9,
    },
    document: draftOf(7),
  },
  {
    line: {
      seq: 2,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.DEVELOPER,
        by: FIXTURE_PERSON.THEO,
        at: CALL_AT - DAY,
        duringCall: false,
      },
      startedAt: CALL_AT - DAY - 30 * 60_000,
      changes: 4,
    },
    document: draftOf(4),
  },
  {
    line: {
      seq: 1,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.DEVELOPER,
        by: FIXTURE_PERSON.ADA,
        at: FIXTURE_TASK.createdAt,
        duringCall: false,
      },
      startedAt: FIXTURE_TASK.createdAt,
      changes: 1,
    },
    document: draftOf(2),
  },
];

function historyPage(before: number | undefined): DescriptionRevisionsAnswer {
  return {
    revisions: FIXTURE_HISTORY.filter(({ line }) => before === undefined || line.seq < before).map(
      ({ line }) => line,
    ),
  };
}

function historyActAnswer(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (kind === ACT_KIND.TASKS_REVISIONS) {
    const page = payload as PortActPayload<typeof ACT_KIND.TASKS_REVISIONS>;
    if (page.taskId !== FIXTURE_TASK_ID) return undefined;
    return { answer: historyPage(page.before) as PortActResult<PortActKind> };
  }
  if (kind !== ACT_KIND.TASKS_REVISION) return undefined;
  const { taskId, seq } = payload as PortActPayload<typeof ACT_KIND.TASKS_REVISION>;
  if (taskId !== FIXTURE_TASK_ID) return undefined;
  const at = FIXTURE_HISTORY.findIndex(({ line }) => line.seq === seq);
  if (at === -1) {
    return { answer: { failure: TASK_CALL_FAILURE.UNANSWERED } as PortActResult<PortActKind> };
  }
  const revision = {
    seq,
    document: FIXTURE_HISTORY[at]?.document ?? draftOf(0),
    previous: FIXTURE_HISTORY[at + 1]?.document ?? null,
  };
  return { answer: { revision } as PortActResult<PortActKind> };
}

const FIXTURE_OTHER_TASKS: readonly TaskSummary[] = [
  {
    id: "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71",
    workspaceId: FIXTURE_FIRST.id,
    name: "Billing export",
    createdAt: CALL_AT - 4 * DAY - 6 * HOUR,
    updatedAt: CALL_AT - DAY - 2 * HOUR,
    repository: "ada/ledger",
    createdBy: FIXTURE_PERSON.THEO,
  },
  {
    id: "2b8c4e6a-0d3f-4a51-9c79-3e4f5a6b7c82",
    workspaceId: FIXTURE_TEAM.id,
    name: "Usage alerts",
    createdAt: CALL_AT - 3 * DAY - 7 * HOUR,
    updatedAt: CALL_AT - DAY - 5 * HOUR,
    repository: "acme/relay",
    createdBy: FIXTURE_PERSON.MAYA,
  },
];

function fixtureRepository(owner: string, name: string, updatedAt: string) {
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch: "main",
    private: true,
    updatedAt: Date.parse(updatedAt),
  };
}

const FIXTURE_REPOSITORIES = new Map([
  [
    FIXTURE_FIRST.id,
    [
      fixtureRepository("ada", "relay", "2026-10-07T16:20:00Z"),
      fixtureRepository("ada", "ledger", "2026-10-01T09:00:00Z"),
    ],
  ],
  [FIXTURE_TEAM.id, [fixtureRepository("acme", "relay", "2026-10-06T11:00:00Z")]],
]);

const FIXTURE_REPOSITORY_LISTS: AppRepositoryLists = Object.fromEntries(
  [...FIXTURE_WORKSPACE_IDS, EVERY_WORKSPACE].map((workspace) => [
    workspace,
    {
      rows: {
        installed: true,
        repositories:
          FIXTURE_REPOSITORIES.get(workspace === EVERY_WORKSPACE ? FIXTURE_FIRST.id : workspace) ??
          [],
        installationUrl: "https://github.com/apps/vespin-agent/installations/new",
      },
    },
  ]),
);

const STAGED_LISTS = new WeakMap<AppRepositoryLists, AppRepositoryLists>();

function repositoriesAppState(state: AppStateSnapshot): AppStateSnapshot {
  const held = state[LIVE_READ.REPOSITORY_LISTS];
  const staged = STAGED_LISTS.get(held) ?? { ...FIXTURE_REPOSITORY_LISTS, ...held };
  STAGED_LISTS.set(held, staged);
  return { ...state, [LIVE_READ.REPOSITORY_LISTS]: staged };
}

const FIXTURE_TASK_LIST: TasksView = {
  tasks: [
    {
      id: FIXTURE_TASK.id,
      workspaceId: FIXTURE_FIRST.id,
      name: FIXTURE_TASK.name,
      createdAt: FIXTURE_TASK.createdAt,
      updatedAt: FIXTURE_TASK.updatedAt,
      repository: FIXTURE_TASK.repository,
      createdBy: FIXTURE_PERSON.ADA,
      status: TASK_STATUS.IN_PROGRESS,
      priority: TASK_PRIORITY.HIGH,
      number: 42,
    },
    ...FIXTURE_OTHER_TASKS,
  ],
  listStatus: TASKS_READ.READY,
  workspaces: FIXTURE_WORKSPACES,
  github: { connected: true, login: null },
  taskAgents: [],
};

const FIXTURE_OPEN_TASK: TasksView = {
  ...FIXTURE_TASK_LIST,
  activeTaskId: FIXTURE_TASK.id,
};

function comment(
  id: string,
  writer: DescriptionCommentWriter,
  at: number,
  words: string,
): DescriptionCommentEntry {
  return { id, kind: DESCRIPTION_COMMENT_ENTRY.COMMENT, writer, words, at };
}

function memberWrote(
  by: (typeof FIXTURE_PERSON)[keyof typeof FIXTURE_PERSON],
): DescriptionCommentWriter {
  return { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by };
}

function thread(input: {
  readonly id: string;
  readonly scope: DescriptionCommentThread["scope"];
  readonly quote: string;
  readonly section: string;
  readonly status: DescriptionCommentThread["status"];
  readonly entries: readonly DescriptionCommentEntry[];
}): DescriptionCommentThread {
  const from = FIXTURE_TASK.document.body.indexOf(input.quote);
  if (from < 0) throw new Error(`The fixture's description holds no "${input.quote}"`);
  const times = input.entries.map((entry) => entry.at);
  return {
    ...input,
    anchor: { from, to: from + input.quote.length },
    createdAt: Math.min(...times),
    updatedAt: Math.max(...times),
    revision: input.entries.length,
  };
}

const FIXTURE_THREADS: readonly DescriptionCommentThread[] = [
  thread({
    id: "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e61",
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "so removal covers invites and members alike",
    section: "Approach",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      comment(
        "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e62",
        memberWrote(FIXTURE_PERSON.THEO),
        CALL_AT - 5 * HOUR,
        "Does removing a pending invite also kill its link? Otherwise a withdrawn invite could still be opened.",
      ),
      comment(
        "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e63",
        memberWrote(FIXTURE_PERSON.ADA),
        CALL_AT - 4 * HOUR,
        "Yes: the link finds its invite through the membership row, so deleting the row is enough.",
      ),
      comment(
        "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e64",
        { actor: DESCRIPTION_COMMENT_ACTOR.APP },
        CALL_AT - 4 * HOUR + 2 * 60_000,
        'Added under Hard parts: a withdrawn link reads "This invite is no longer valid" and grants nothing.',
      ),
    ],
  }),
  thread({
    id: "9d2e4f6a-8b0c-4d3e-9f5a-7b9c1d3e5f71",
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "The teammate joins the workspace by opening the link.",
    section: "Goal",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      comment(
        "9d2e4f6a-8b0c-4d3e-9f5a-7b9c1d3e5f72",
        { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: FIXTURE_AGENT_ID },
        CALL_AT - 20 * 60_000,
        "A teammate with no account yet has nothing to join with. Should opening the link start sign-up first, then join?",
      ),
    ],
  }),
  thread({
    id: "ae3f5a7b-9c1d-4e4f-8a6b-8c0d2e4f6a81",
    scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
    quote:
      "Only an admin can add someone to a workspace, by creating their account by hand, so " +
      "members wait on an admin to bring a teammate in.",
    section: "Context",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      comment(
        "ae3f5a7b-9c1d-4e4f-8a6b-8c0d2e4f6a82",
        memberWrote(FIXTURE_PERSON.PRIYA),
        CALL_AT - 2 * HOUR,
        "Support hears this about twice a week, so it's worth saying here who asked for it.",
      ),
    ],
  }),
  thread({
    id: "bf4a6b8c-0d2e-4f5a-9b7c-9d1e3f5a7b91",
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "lost because removing a member would then have to clear two tables",
    section: "Alternatives",
    status: DESCRIPTION_COMMENT_STATUS.RESOLVED,
    entries: [
      comment(
        "bf4a6b8c-0d2e-4f5a-9b7c-9d1e3f5a7b92",
        memberWrote(FIXTURE_PERSON.PRIYA),
        CALL_AT - DAY,
        "A separate table would make invite counts easier to chart.",
      ),
      comment(
        "bf4a6b8c-0d2e-4f5a-9b7c-9d1e3f5a7b93",
        memberWrote(FIXTURE_PERSON.ADA),
        CALL_AT - DAY + HOUR,
        "The chart can count memberships by state. Keeping one table.",
      ),
      {
        id: "bf4a6b8c-0d2e-4f5a-9b7c-9d1e3f5a7b94",
        kind: DESCRIPTION_COMMENT_ENTRY.RESOLVED,
        writer: memberWrote(FIXTURE_PERSON.ADA),
        at: CALL_AT - DAY + HOUR + 60_000,
      },
    ],
  }),
].sort((older, newer) => older.createdAt - newer.createdAt);

const STAGED_COMMENTS = new WeakMap<AppDescriptionComments, AppDescriptionComments>();

function commentsAppState(state: AppStateSnapshot): AppStateSnapshot {
  if (state.run.profile !== RUN_PROFILE.TASKS_COMMENTS) return state;
  const held = state[LIVE_READ.DESCRIPTION_COMMENTS];
  let staged = STAGED_COMMENTS.get(held);
  if (staged === undefined) {
    staged = {
      ...held,
      [COMMENT_SUBJECT.DESCRIPTION]: {
        ...held[COMMENT_SUBJECT.DESCRIPTION],
        [FIXTURE_TASK_ID]: { rows: FIXTURE_THREADS },
      },
    };
    STAGED_COMMENTS.set(held, staged);
  }
  return { ...state, [LIVE_READ.DESCRIPTION_COMMENTS]: staged };
}

const FIXTURE_OPEN_PANEL: SidePanelState = {
  open: true,
  tabs: SIDE_PANEL_TABS,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};
const FIXTURE_CLOSED_PANEL: SidePanelState = { ...FIXTURE_OPEN_PANEL, open: false };

export function fixtureTasksView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): TasksView | undefined {
  if (!run.fixtureMode) return undefined;
  const agent = agentTasksView(run.profile, FIXTURE_OPEN_TASK);
  if (agent !== undefined) return agent;
  if (run.profile === RUN_PROFILE.TASKS) return FIXTURE_OPEN_TASK;
  if (run.profile === RUN_PROFILE.TASKS_TRANSCRIPT) return FIXTURE_OPEN_TASK;
  if (run.profile === RUN_PROFILE.TASKS_WORK) return FIXTURE_OPEN_TASK;
  return settingsTasksView(run.profile, FIXTURE_TASK_LIST) ?? FIXTURE_TASK_LIST;
}

export function fixtureSidePanel(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): StagedSidePanel | undefined {
  if (!run.fixtureMode) return undefined;
  return agentSidePanel(run.profile, FIXTURE_OPEN_PANEL, FIXTURE_TASK_ID) ?? FIXTURE_CLOSED_PANEL;
}

export function fixtureColumnTab(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): MainTab | undefined {
  return run.fixtureMode ? agentColumnTab(run.profile) : undefined;
}

function emptyTaskAnswer(
  kind: PortActKind,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (kind === ACT_KIND.AGENTS_LIST) return { answer: { agents: [] } };
  return undefined;
}

export function fixtureActAnswer(
  run: { readonly profile: string },
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  return (
    historyActAnswer(kind, payload) ??
    agentActAnswer(run.profile, kind, payload) ??
    settingsActAnswer(run.profile, kind, payload) ??
    emptyTaskAnswer(kind)
  );
}

const STAGED_DESCRIPTIONS = new WeakMap<AppDescriptionDocuments, AppDescriptionDocuments>();
const STAGED_HISTORIES = new WeakMap<AppHistories, AppHistories>();

function stagedOn<Rows>(
  staged: WeakMap<AppHeldById<Rows>, AppHeldById<Rows>>,
  held: AppHeldById<Rows>,
  rows: Rows,
): AppHeldById<Rows> {
  const kept = staged.get(held);
  if (kept !== undefined) return kept;
  const laid = { ...held, [FIXTURE_TASK_ID]: { rows } };
  staged.set(held, laid);
  return laid;
}

function plannedAppState(state: AppStateSnapshot): AppStateSnapshot {
  if (fixtureTasksView(state.run)?.activeTaskId !== FIXTURE_TASK_ID) return state;
  return {
    ...state,
    [LIVE_READ.DESCRIPTION_DOCUMENT]: stagedOn(
      STAGED_DESCRIPTIONS,
      state[LIVE_READ.DESCRIPTION_DOCUMENT],
      {
        task: FIXTURE_TASK,
      },
    ),
    [LIVE_READ.HISTORY]: stagedOn(
      STAGED_HISTORIES,
      state[LIVE_READ.HISTORY],
      historyPage(undefined),
    ),
  };
}

export function fixtureAppState(state: AppStateSnapshot): AppStateSnapshot {
  return repositoriesAppState(
    commentsAppState(
      automationsAppState(
        agentAppState(settingsAppState(state.run.profile, plannedAppState(state)), FIXTURE_TASK_ID),
        FIXTURE_WORKSPACE_IDS,
      ),
    ),
  );
}

export type FixturePlace =
  | { readonly settings: SettingsLink }
  | { readonly admin: true }
  | { readonly automations: AutomationsPlace };

export function fixturePlace(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): FixturePlace | undefined {
  if (!run.fixtureMode) return undefined;
  if (run.profile === RUN_PROFILE.ADMIN) return { admin: true };
  const settings = settingsLaunchLink(run.profile);
  if (settings !== undefined) return { settings };
  const automations = automationsLaunchPlace(run.profile);
  return automations === undefined ? undefined : { automations };
}
