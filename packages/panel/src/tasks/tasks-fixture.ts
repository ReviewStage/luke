import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import { LIVE_READ } from "@repo/features/live-wire";
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
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceExperimentChoice,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppDescriptionComments,
  type AppDescriptionDocuments,
  type AppHeldById,
  type AppHistories,
  type AppRepositoryLists,
  type AppStateSnapshot,
  EVERY_WORKSPACE,
  RUN_PROFILE,
} from "@repo/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@repo/host/contract";
import { FIXTURE_IDS, FIXTURE_TASK_NAME } from "@repo/host/fixture-stage";
import { EXPERIMENT, type WorkspaceExperiment } from "@repo/settings";
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

/**
 * tasks-fixture.ts -- the synthetic tasks a fixture run's Tasks tab draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no task, so the Tasks tab
 * would show only its signed-out line. It draws the synthetic list instead,
 * which is what the expanded capture in `scripts/evidence.sh` shows now that
 * the panel opens on Tasks, and under the tasks profile it also opens the
 * fixture task, a drafted description with its version history, which is what the
 * tasks capture shows; under the tasks-comments profile its description
 * holds comment threads, answered as the service answers a read of them.
 * Every name and repository here is invented; nothing is read from an
 * account.
 */

/**
 * The fixture account's workspaces: its first one, named for the account as
 * the service names it, which the sidebar lists, with the account's own
 * GitHub connected, and Acme, a team's it administers, whose GitHub organization is connected, so the captures
 * draw the sidebar's switcher with every item. Each workspace's tasks are
 * about repositories its own GitHub reaches, as the service keeps them, so
 * no task here is one stranded in a workspace that cannot reach it.
 */
/** A workspace experiment's choice as the fixture stages it: on or off, by whom, on the day named. */
function chosen(
  experiment: WorkspaceExperiment,
  on: boolean,
  by: { readonly userId: string; readonly name: string },
  day: string,
): WorkspaceExperimentChoice {
  return {
    experiment,
    on,
    changedBy: { id: by.userId, name: by.name },
    changedAt: Date.parse(day),
  };
}

const FIXTURE_FIRST: Workspace = {
  id: FIXTURE_IDS.WORKSPACE,
  name: "Ada Lovelace",
  slug: "personal",
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ada", active: true },
  personal: true,
  // Every workspace experiment the account turned on in its own workspace, so the captures draw each feature.
  experiments: [
    chosen(EXPERIMENT.DESCRIPTIONS, true, FIXTURE_PERSON.ADA, "2026-09-01T09:00:00Z"),
    chosen(EXPERIMENT.MEMORY, true, FIXTURE_PERSON.ADA, "2026-09-01T09:00:00Z"),
    chosen(EXPERIMENT.PILOT, true, FIXTURE_PERSON.ADA, "2026-09-01T09:00:00Z"),
  ],
};
const FIXTURE_TEAM: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
  // Acme's owner turned Pilot off, so Settings › Experimental draws a switch turned off by someone else.
  experiments: [
    chosen(EXPERIMENT.DESCRIPTIONS, true, FIXTURE_PERSON.MAYA, "2026-09-01T09:00:00Z"),
    chosen(EXPERIMENT.MEMORY, true, FIXTURE_PERSON.ADA, "2026-10-23T15:00:00Z"),
    chosen(EXPERIMENT.PILOT, false, FIXTURE_PERSON.MAYA, "2026-11-02T10:00:00Z"),
  ],
};
const FIXTURE_WORKSPACES: readonly Workspace[] = [FIXTURE_FIRST, FIXTURE_TEAM];

/** The fixture's workspaces by id, which their automations' reads are held by. */
export const FIXTURE_WORKSPACE_IDS: readonly string[] = FIXTURE_WORKSPACES.map(({ id }) => id);

/**
 * The reference journey's task partway through its conversation: the
 * context, the goal, an approach with the pending-membership design settled,
 * its interfaces, one alternative weighed, one hard part, what it leaves
 * out, its first test, an open question, and its assumptions, as a draft
 * shows it.
 */
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

/**
 * When the fixture's call stands, from which every task's times are counted:
 * a fixed instant, never the clock, so each picture draws the same dates.
 * Its tasks were started over the few days before it, and the call's own
 * task was last saved during it, just before its coding agent began
 * (`agent-fixture.ts`).
 */
const CALL_AT = Date.parse("2026-10-07T16:40:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** The reference journey's task, by the id the host's staged call (`@repo/host/fixture-stage`) names it by too. */
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

/**
 * The fixture task's description as it stood after its first `sections` sections,
 * each a heading and its words, as a revision partway through drafting saved it.
 */
function draftOf(sections: number): DescriptionDocument {
  return { body: `${FIXTURE_SECTIONS.slice(0, sections * 2).join("\n\n")}\n`, assumptions: [] };
}

/**
 * The fixture task's version history, newest first, each revision beside the
 * description it saved: its member and a teammate of its workspace by hand, the app on
 * its call, and a coding agent, over the two days before the call, so the
 * version history shows real versions by more than one writer rather than
 * waiting on a read main answers with nothing. Note that the agent's revision
 * names no agent id, because no profile but the agent ones stands an agent on
 * the task, and an id would offer an Open into a tab that has none.
 */
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

/** A page of the fixture task's history, newest first, before the revision `before` names where it names one. */
function historyPage(before: number | undefined): DescriptionRevisionsAnswer {
  return {
    revisions: FIXTURE_HISTORY.filter(({ line }) => before === undefined || line.seq < before).map(
      ({ line }) => line,
    ),
  };
}

/**
 * What the fixture task's version history reads, answered here in place of
 * main under every profile: a page of its history, and one revision beside
 * the one before it. Its history as the version history holds it is staged
 * on main's document instead (`fixtureAppState`). Any other task's reads go
 * to main, as do a restore and every other act.
 */
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

/** A repository a fixture workspace's GitHub reaches, as the service would list it. */
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

/** The repositories each fixture workspace's GitHub reaches: the ones its tasks are about. */
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

/** The repositories a fixture run's chips list, as the host holds them for each fixture workspace, the first's standing for every workspace's; read from nowhere. */
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

/** Main's document with the fixture workspaces' repositories held, beside any a staged profile laid; one object across deliveries where nothing moved. */
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
  // Every task's agents as the list followed live carries them: none, where no profile stages one.
  taskAgents: [],
};

/** The open task, whose description main's document holds as read (`fixtureAppState`). */
const FIXTURE_OPEN_TASK: TasksView = {
  ...FIXTURE_TASK_LIST,
  activeTaskId: FIXTURE_TASK.id,
};

/** One thread's comment, written by `writer` at `at`. */
function comment(
  id: string,
  writer: DescriptionCommentWriter,
  at: number,
  words: string,
): DescriptionCommentEntry {
  return { id, kind: DESCRIPTION_COMMENT_ENTRY.COMMENT, writer, words, at };
}

/** A member of the fixture's first workspace as an entry's writer. */
function memberWrote(
  by: (typeof FIXTURE_PERSON)[keyof typeof FIXTURE_PERSON],
): DescriptionCommentWriter {
  return { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by };
}

/**
 * A thread on `quote`, words of the fixture's description under `section`, its
 * anchor where those words stand in the description's text as the service keeps it,
 * and its times from its entries.
 */
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

/**
 * The comment threads on the fixture's description, oldest first, as the host
 * holds them: one on a whole block, one its coding agent
 * started, one answered by a member and by the app, and one resolved, which
 * only the description's comments list shows. The open ones stand in the description's first
 * sections, so the window's first screen of it shows their marks.
 */
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

/** Main's held comments with the fixture task's description's threads among them, one object for each of main's. */
const STAGED_COMMENTS = new WeakMap<AppDescriptionComments, AppDescriptionComments>();

/**
 * Main's document as the tasks-comments profile draws it: the fixture
 * task's description's threads held as the window's read of them holds them
 * (`LIVE_READ.DESCRIPTION_COMMENTS`), none on its pages. The same document, the
 * very object, under any other profile.
 */
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

/** The side panels the fixture profiles open their task with: open, for an agent profile to stage a tab in, or shut. */
const FIXTURE_OPEN_PANEL: SidePanelState = {
  open: true,
  tabs: SIDE_PANEL_TABS,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};
const FIXTURE_CLOSED_PANEL: SidePanelState = { ...FIXTURE_OPEN_PANEL, open: false };

/**
 * The tasks a fixture run draws: the list with its first task open under the
 * tasks profiles, that task holding its coding agent under the agent
 * profiles (`agent-fixture.ts`), the list alone under any other, its
 * workspaces as Settings shows them under the Settings profiles
 * (`settings-fixture.ts`), and nothing for a live run, which draws what the
 * host read.
 */
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

/**
 * The side panel a fixture run opens its task with: on the tab each agent
 * profile names, and shut under any other, the tasks profiles' among them,
 * whose description the column's Overview shows. Nothing for a live run, which
 * opens the panel as the developer last left it.
 */
export function fixtureSidePanel(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): StagedSidePanel | undefined {
  if (!run.fixtureMode) return undefined;
  return agentSidePanel(run.profile, FIXTURE_OPEN_PANEL, FIXTURE_TASK_ID) ?? FIXTURE_CLOSED_PANEL;
}

/**
 * The tab a fixture run's task column opens on: the one each agent profile
 * names, its agent's or Overview; none under any other profile, whose task
 * opens on its Overview as one never opened does. Nothing for a live run.
 */
export function fixtureColumnTab(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): MainTab | undefined {
  return run.fixtureMode ? agentColumnTab(run.profile) : undefined;
}

/**
 * What a fixture run reads of a task's agents where no profile stages
 * more, as a mention's card reads them: none. Note that main answers a
 * fixture run's service reads with nothing, which the card would wait on
 * in its placeholder for good.
 */
function emptyTaskAnswer(
  kind: PortActKind,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (kind === ACT_KIND.AGENTS_LIST) return { answer: { agents: [] } };
  return undefined;
}

/**
 * What a fixture run answers an act with in place of main (`act.ts`), boxed
 * so an act that answers nothing is told from one left to main: the
 * fixture task's version history under every profile, its agent
 * profiles' tabs' reads, its signed-in profiles' pages' reads (an
 * Automations profile's are laid on its document instead), every other
 * profile's task as one with no agents, and nothing else, which goes to
 * main as it would.
 */
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

/** Main's held descriptions with the fixture's task's description held, one object for each of main's. */
const STAGED_DESCRIPTIONS = new WeakMap<AppDescriptionDocuments, AppDescriptionDocuments>();
/** Main's held histories with the fixture's task's history held, one object for each of main's. */
const STAGED_HISTORIES = new WeakMap<AppHistories, AppHistories>();

/** `held` with the fixture's task's read laid as `rows`, one object for each of main's, kept in `staged`. */
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

/**
 * Main's document with the fixture's task's description and its history held as the
 * window's reads of them hold them (`LIVE_READ.DESCRIPTION_DOCUMENT`,
 * `LIVE_READ.HISTORY`), under the profiles that open the task
 * (`fixtureTasksView`), so it opens on its description and its version history on
 * its versions; the very document under any other.
 */
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

/**
 * Main's document as a fixture run draws it (`use-app-state.ts`): the
 * fixture's task's description and history held under the profiles that open it,
 * with the fixture workspaces' members held under every profile, and the
 * synthetic account signed in under the profiles that stage one
 * (`settings-fixture.ts`), the open task's pages held with the page its
 * agent showed under the agent profiles (`agent-fixture.ts`), the
 * workspaces' automations and runs held under the Automations profiles
 * (`automations-fixture.ts`), its description's comment threads held under the
 * tasks-comments profile, and the fixture workspaces' repositories held
 * under every profile, which main holds as it does under any other.
 */
export function fixtureAppState(state: AppStateSnapshot): AppStateSnapshot {
  return workspacesAppState(
    repositoriesAppState(
      commentsAppState(
        automationsAppState(
          agentAppState(
            settingsAppState(state.run.profile, plannedAppState(state)),
            FIXTURE_TASK_ID,
          ),
          FIXTURE_WORKSPACE_IDS,
        ),
      ),
    ),
  );
}

/** Main's tasks with the fixture's workspaces laid over them, one object for each of main's. */
const STAGED_WORKSPACES = new WeakMap<TasksView, TasksView>();

/**
 * Main's document with the workspaces the fixture's tasks tab lists, whose
 * experiments every gate reads off the document (`workspace-experiments.ts`),
 * so a gate and the tab agree on what each workspace chose.
 */
function workspacesAppState(state: AppStateSnapshot): AppStateSnapshot {
  const fixture = fixtureTasksView(state.run);
  if (fixture === undefined) return state;
  const held = STAGED_WORKSPACES.get(state.tasks);
  if (held !== undefined) return { ...state, tasks: held };
  const laid = { ...state.tasks, workspaces: fixture.workspaces };
  STAGED_WORKSPACES.set(state.tasks, laid);
  return { ...state, tasks: laid };
}

/**
 * Where a fixture run's window opens at launch, past the Tasks tab it opens
 * on otherwise: a page of Settings, the Admin place, or an Automations page.
 */
export type FixturePlace =
  | { readonly settings: SettingsLink }
  | { readonly admin: true }
  | { readonly automations: AutomationsPlace };

/** The place a fixture run's profile opens the window on; none for a live run, or a profile that opens the Tasks tab. */
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
