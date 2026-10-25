import { BOARD_ELEMENT_TYPE, DRAWING_ZONE } from "@luke/features/board-vocabulary";
import type { Board, DrawingElement } from "@luke/features/board-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentEntry,
  type PlanCommentThread,
  type PlanCommentWriter,
} from "@luke/features/plan-comment-wire";
import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanRevisionLine,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCode,
  type TaskCodeShowing,
  type TasksRepositoriesAnswer,
  type TasksRevisionsAnswer,
  type TasksView,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS, FIXTURE_TASK_NAME } from "@luke/host/fixture-stage";
import type { SettingsLink } from "@luke/settings/settings-views";
import {
  agentActAnswer,
  agentSidePanel,
  agentTasksView,
  FIXTURE_AGENT_ID,
} from "./agent-fixture.js";
import { automationsActAnswer, automationsLaunchPlace } from "./automations-fixture.js";
import {
  FIXTURE_PERSON,
  fixtureMembersAnswer,
  settingsActAnswer,
  settingsAppState,
  settingsLaunchLink,
  settingsTasksView,
} from "./settings-fixture.js";
import {
  SIDE_PANEL_TAB,
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
 * reference journey's task from `docs/TASKS.md`, a draft of the default
 * template partway through with Luke working on the call about it, which is
 * what the tasks capture shows; under the tasks-comments profile its plan
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

/**
 * The reference journey's task partway through its conversation: the
 * context, the goal, an approach with the pending-membership design settled,
 * its interfaces, one alternative weighed, one hard part, an open question,
 * and its assumptions, with every other section still holding the default
 * template's guidance, as a draft shows it.
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
  "What is out of scope on purpose, and why.",
  "## Testing",
  'The cases that prove the change, each as "When …, then …" with an exact result, then the end-to-end check.',
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

/** The reference journey's task, by the id its chat channel (`chat-fixture.ts`) and the host's staged call (`@luke/host/fixture-stage`) name it by too. */
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
 * The fixture task's plan as it stood after its first `sections` sections,
 * each a heading and its words, as a revision partway through drafting saved it.
 */
function draftOf(sections: number): PlanDocument {
  return { body: `${FIXTURE_SECTIONS.slice(0, sections * 2).join("\n\n")}\n`, assumptions: [] };
}

/**
 * The fixture task's version history, newest first, each revision beside the
 * plan it saved: its member and a teammate of its workspace by hand, Luke on
 * its call, and a coding agent, over the two days before the call, so the
 * version history shows real versions by more than one writer rather than
 * waiting on a read main answers with nothing. Note that the agent's revision
 * names no agent id, because no profile but the agent ones stands an agent on
 * the task, and an id would offer an Open into a tab that has none.
 */
const FIXTURE_HISTORY: readonly {
  readonly line: PlanRevisionLine;
  readonly document: PlanDocument;
}[] = [
  {
    line: {
      seq: 5,
      lastEdit: {
        actor: PLAN_ACTOR.DEVELOPER,
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
        actor: PLAN_ACTOR.AGENT,
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
        actor: PLAN_ACTOR.NOTETAKER,
        by: FIXTURE_PERSON.ADA,
        at: CALL_AT - 5 * HOUR,
        duringCall: true,
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
        actor: PLAN_ACTOR.DEVELOPER,
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
        actor: PLAN_ACTOR.DEVELOPER,
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
function historyPage(before: number | undefined): TasksRevisionsAnswer {
  return {
    revisions: FIXTURE_HISTORY.filter(({ line }) => before === undefined || line.seq < before).map(
      ({ line }) => line,
    ),
  };
}

/** A follow of the fixture task's history, which pushes its newest page once, as the host's does on opening, and nothing after. */
async function* historyPushedOnce(): AsyncGenerator<TasksRevisionsAnswer> {
  yield historyPage(undefined);
}

/**
 * What the fixture task's version history reads, answered here in place of
 * main under every profile: a page of its history, its newest page followed,
 * and one revision beside the one before it. Any other task's reads go to
 * main, as do a restore and every other act.
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
  if (kind === ACT_KIND.TASKS_HISTORY_FOLLOW) {
    const follow = payload as PortActPayload<typeof ACT_KIND.TASKS_HISTORY_FOLLOW>;
    if (follow.taskId !== FIXTURE_TASK_ID) return undefined;
    return { answer: historyPushedOnce() as PortActResult<PortActKind> };
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

/** The repositories a fixture run's chip lists for a workspace, read from nowhere; the first workspace's before one is chosen. */
export function fixtureRepositories(workspaceId: string | undefined): TasksRepositoriesAnswer {
  return {
    repositories: {
      installed: true,
      repositories: FIXTURE_REPOSITORIES.get(workspaceId ?? FIXTURE_FIRST.id) ?? [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  };
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
  document: { status: TASKS_READ.IDLE },
};

/**
 * The code on screen in the fixture's call: Luke pointing at the invite
 * check he is asking about, lines 6 to 9 of an invented file, which the
 * Code tab colours as it draws it.
 */
const FIXTURE_CODE: TaskCode = {
  ref: { path: "src/members/invite.ts", startLine: 6, endLine: 9 },
  repository: "ada/relay",
  firstLine: 1,
  lineCount: 14,
  lines: [
    'import { db } from "../db.js";',
    "",
    "// An invite link is good once, and for seven days.",
    "export async function acceptInvite(token: string) {",
    "  const invite = await db.invites.find(token);",
    "  if (!invite || invite.acceptedAt) {",
    '    throw new InviteError("no-longer-valid");',
    "  }",
    '  if (expired(invite)) throw new InviteError("expired");',
    "  await db.members.add(invite.workspaceId, invite.email);",
    "  await db.invites.accept(invite.id);",
    "}",
    "",
    "export { acceptInvite };",
  ],
};

/** The fixture's file around lines `startLine` to `endLine`, three either side, as the host keeps a card's lines. */
function fixtureExcerpt(startLine: number, endLine: number): TaskCode {
  const firstLine = Math.max(1, startLine - 3);
  return {
    ...FIXTURE_CODE,
    ref: { path: FIXTURE_CODE.ref.path, startLine, endLine },
    firstLine,
    lines: FIXTURE_CODE.lines.slice(firstLine - 1, endLine + 3),
  };
}

/** The coding agent on the fixture's task whose typed turn showed the last of its code. */
const FIXTURE_CODING_AGENT_ID = "7b3c5d7e-9f1a-4b2c-8d4e-6f8a0b2c4d6e";

/**
 * Every code shown on the fixture's task: Luke's in its call, a walkthrough
 * of one file in three steps, each with his note (where a link lands, the
 * check he is asking about, and the expiry after it), and after the call, one
 * more from a typed turn of the task's coding agent.
 */
const FIXTURE_SHOWN_CODE: readonly TaskCodeShowing[] = [
  {
    callId: "fixture-show-1",
    turnId: "fixture-turn-1",
    shownAt: Date.parse("2026-10-07T16:21:00Z"),
    code: {
      ...fixtureExcerpt(4, 5),
      note: "An invite link lands here: acceptInvite finds the invite by its token, so this is where a used link has to be refused.",
    },
  },
  {
    callId: "fixture-show-2",
    turnId: "fixture-turn-1",
    shownAt: Date.parse("2026-10-07T16:21:00Z"),
    code: {
      ...fixtureExcerpt(6, 8),
      note: 'A used invite is already refused here. A withdrawn one should be refused the same way, as "no longer valid".',
    },
  },
  {
    callId: "fixture-show-3",
    turnId: "fixture-turn-1",
    shownAt: Date.parse("2026-10-07T16:21:00Z"),
    code: {
      ...fixtureExcerpt(9, 9),
      note: "Expiry is checked after that, so a link that is both withdrawn and expired reads as no longer valid.",
    },
  },
  {
    callId: "fixture-show-4",
    turnId: "fixture-turn-typed",
    shownAt: Date.parse("2026-10-07T16:40:00Z"),
    agentId: FIXTURE_CODING_AGENT_ID,
    code: {
      ...fixtureExcerpt(10, 11),
      note: "The member is added before the invite is marked accepted, so a failure between the two leaves the link good for a second use.",
    },
  },
];

/**
 * The open task mid-call, the brain running a repository command, so the
 * capture shows both of the status row's lines.
 */
const FIXTURE_OPEN_TASK: TasksView = {
  ...FIXTURE_TASK_LIST,
  activeTaskId: FIXTURE_TASK.id,
  document: { status: TASKS_READ.READY, task: FIXTURE_TASK },
  activity: { planner: { action: "grep -rn pending src/members" } },
  shownCode: FIXTURE_SHOWN_CODE,
};

/**
 * What Luke drew for the fixture's task, in the vocabulary his
 * `draw_on_board` call sends, not yet on the board: the capture shows the
 * canvas converting it with Excalidraw's own converter, as a Mac does the
 * first time it reads a new drawing.
 */
const FIXTURE_DRAWING: readonly DrawingElement[] = [
  { type: BOARD_ELEMENT_TYPE.TEXT, id: "title", x: 0, y: -110, text: "Inviting a teammate" },
  {
    type: DRAWING_ZONE,
    id: "service",
    x: 280,
    y: -60,
    width: 280,
    height: 380,
    title: "Invites service",
  },
  {
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    id: "member",
    x: 0,
    y: 0,
    label: "Member",
    backgroundColor: "#a5d8ff",
  },
  {
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    id: "invites",
    x: 320,
    y: 0,
    label: "POST /invites",
    backgroundColor: "#b2f2bb",
  },
  {
    type: BOARD_ELEMENT_TYPE.ELLIPSE,
    id: "email",
    x: 640,
    y: 0,
    label: "Invite email",
    backgroundColor: "#d0bfff",
  },
  {
    type: BOARD_ELEMENT_TYPE.DIAMOND,
    id: "valid",
    x: 620,
    y: 160,
    width: 240,
    height: 140,
    label: "Link still valid?",
    backgroundColor: "#fff3bf",
  },
  {
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    id: "joined",
    x: 320,
    y: 190,
    label: "Joins workspace",
    backgroundColor: "#b2f2bb",
  },
  { type: BOARD_ELEMENT_TYPE.ARROW, id: "sends", from: "member", to: "invites", label: "email" },
  { type: BOARD_ELEMENT_TYPE.ARROW, id: "mails", from: "invites", to: "email" },
  { type: BOARD_ELEMENT_TYPE.ARROW, id: "opens", from: "email", to: "valid", label: "opens" },
  { type: BOARD_ELEMENT_TYPE.ARROW, id: "accepts", from: "valid", to: "joined", label: "yes" },
];

const FIXTURE_BOARD: Board = {
  elements: [],
  appliedDrawing: 0,
  drawing: { number: 1, elements: FIXTURE_DRAWING },
};

/** One thread's comment, written by `writer` at `at`. */
function comment(
  id: string,
  writer: PlanCommentWriter,
  at: number,
  words: string,
): PlanCommentEntry {
  return { id, kind: PLAN_COMMENT_ENTRY.COMMENT, writer, words, at };
}

/** A member of the fixture's first workspace as an entry's writer. */
function memberWrote(by: (typeof FIXTURE_PERSON)[keyof typeof FIXTURE_PERSON]): PlanCommentWriter {
  return { actor: PLAN_COMMENT_ACTOR.MEMBER, by };
}

/**
 * A thread on `quote`, words of the fixture's plan under `section`, its
 * anchor where those words stand in the plan's text as the service keeps it,
 * and its times from its entries.
 */
function thread(input: {
  readonly id: string;
  readonly scope: PlanCommentThread["scope"];
  readonly quote: string;
  readonly section: string;
  readonly status: PlanCommentThread["status"];
  readonly entries: readonly PlanCommentEntry[];
}): PlanCommentThread {
  const from = FIXTURE_TASK.document.body.indexOf(input.quote);
  if (from < 0) throw new Error(`The fixture's plan holds no "${input.quote}"`);
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
 * The comment threads on the fixture's plan, oldest first, as the service
 * answers a read of them: one on a whole block, one its coding agent
 * started, one answered by a member and by Luke, and one resolved, which
 * only the Comments tab lists. The open ones stand in the plan's first
 * sections, so the window's first screen of it shows their marks.
 */
const FIXTURE_THREADS: readonly PlanCommentThread[] = [
  thread({
    id: "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e61",
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "so removal covers invites and members alike",
    section: "Approach",
    status: PLAN_COMMENT_STATUS.OPEN,
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
        { actor: PLAN_COMMENT_ACTOR.LUKE },
        CALL_AT - 4 * HOUR + 2 * 60_000,
        'Added under Hard parts: a withdrawn link reads "This invite is no longer valid" and grants nothing.',
      ),
    ],
  }),
  thread({
    id: "9d2e4f6a-8b0c-4d3e-9f5a-7b9c1d3e5f71",
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "The teammate joins the workspace by opening the link.",
    section: "Goal",
    status: PLAN_COMMENT_STATUS.OPEN,
    entries: [
      comment(
        "9d2e4f6a-8b0c-4d3e-9f5a-7b9c1d3e5f72",
        { actor: PLAN_COMMENT_ACTOR.AGENT, agentId: FIXTURE_AGENT_ID },
        CALL_AT - 20 * 60_000,
        "A teammate with no account yet has nothing to join with. Should opening the link start sign-up first, then join?",
      ),
    ],
  }),
  thread({
    id: "ae3f5a7b-9c1d-4e4f-8a6b-8c0d2e4f6a81",
    scope: PLAN_COMMENT_SCOPE.BLOCK,
    quote:
      "Only an admin can add someone to a workspace, by creating their account by hand, so " +
      "members wait on an admin to bring a teammate in.",
    section: "Context",
    status: PLAN_COMMENT_STATUS.OPEN,
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
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "lost because removing a member would then have to clear two tables",
    section: "Alternatives",
    status: PLAN_COMMENT_STATUS.RESOLVED,
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
        kind: PLAN_COMMENT_ENTRY.RESOLVED,
        writer: memberWrote(FIXTURE_PERSON.ADA),
        at: CALL_AT - DAY + HOUR + 60_000,
      },
    ],
  }),
].sort((older, newer) => older.createdAt - newer.createdAt);

/** Where a reader of the fixture's comments stands once it has read them, which nothing moves past. */
const FIXTURE_COMMENTS_CURSOR = "1";

/**
 * The tasks-comments profile's answer to a read of a plan's comments: the
 * fixture task's threads to a reader starting out, none on any other plan,
 * and to a reader already caught up a read held, as the service holds one
 * until something moves, which here nothing does. Note that the held read is
 * a promise that never settles (`Promise.race([])`), because one answered at
 * once would have the window read again at once, for good.
 */
function commentsAnswer(
  payload: PortActPayload<typeof ACT_KIND.TASKS_COMMENTS>,
): PortActResult<typeof ACT_KIND.TASKS_COMMENTS> | Promise<never> {
  if (payload.after !== PLAN_COMMENTS_CURSOR_START) return Promise.race([]);
  return {
    threads: payload.planId === FIXTURE_TASK_ID ? FIXTURE_THREADS : [],
    cursor: FIXTURE_COMMENTS_CURSOR,
  };
}

/** The tasks-comments profile's answers: its plan's comments, and nothing else, which the agent's answers and main's take. */
function commentsActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (profile !== RUN_PROFILE.TASKS_COMMENTS || kind !== ACT_KIND.TASKS_COMMENTS) return undefined;
  // SAFETY: the kind is the comments read, so its payload is that read's; a held read is a promise
  // the port's caller awaits as it awaits every answer.
  const read = payload as PortActPayload<typeof ACT_KIND.TASKS_COMMENTS>;
  return { answer: commentsAnswer(read) as PortActResult<PortActKind> };
}

/** The open task on its whiteboard, as the tasks-board profile captures it. */
const FIXTURE_OPEN_BOARD: TasksView = { ...FIXTURE_OPEN_TASK, board: FIXTURE_BOARD };

/** The side panels the fixture profiles open their task with. */
const FIXTURE_CODE_PANEL: SidePanelState = {
  open: true,
  tabs: SIDE_PANEL_TABS,
  tab: SIDE_PANEL_TAB.CODE,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};
const FIXTURE_BOARD_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.BOARD };
const FIXTURE_DOCUMENT_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.PLAN };
const FIXTURE_CLOSED_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, open: false };

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
  if (run.profile === RUN_PROFILE.TASKS_BOARD) return FIXTURE_OPEN_BOARD;
  if (run.profile === RUN_PROFILE.TASKS_TRANSCRIPT) return FIXTURE_OPEN_TASK;
  if (run.profile === RUN_PROFILE.TASKS_WORK) return FIXTURE_OPEN_TASK;
  return settingsTasksView(run.profile, FIXTURE_TASK_LIST) ?? FIXTURE_TASK_LIST;
}

/**
 * The side panel a fixture run opens its task with: on the code Luke has on
 * screen under the tasks profile, on the whiteboard under the
 * tasks-board profile, on the plan under the tasks-transcript and
 * tasks-work profiles, whose call the task's column shows, the latter with
 * Luke at work on it, on the agent's tab each agent profile names, and
 * closed under any other. Nothing for a live run, which opens the panel as
 * the developer last left it.
 */
export function fixtureSidePanel(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): StagedSidePanel | undefined {
  if (!run.fixtureMode) return undefined;
  const agent = agentSidePanel(run.profile, FIXTURE_CODE_PANEL, FIXTURE_TASK_ID);
  if (agent !== undefined) return agent;
  if (run.profile === RUN_PROFILE.TASKS) return FIXTURE_CODE_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_BOARD) return FIXTURE_BOARD_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_TRANSCRIPT) return FIXTURE_DOCUMENT_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_WORK) return FIXTURE_DOCUMENT_PANEL;
  return FIXTURE_CLOSED_PANEL;
}

/**
 * What a fixture run reads of its task where no profile stages more: no
 * agents, and no linked issues. Note that main answers a fixture run's
 * service reads with nothing, which the task's column would wait on in its
 * placeholder for good, and which the plan's Linked issues box would say as
 * a read Luke did not answer.
 */
function emptyTaskAnswer(
  kind: PortActKind,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (kind === ACT_KIND.CODING_AGENTS_LIST) return { answer: { agents: [] } };
  if (kind === ACT_KIND.TASK_ISSUES_READ) return { answer: { issues: [] } };
  return undefined;
}

/**
 * What a fixture run answers an act with in place of main (`act.ts`), boxed
 * so an act that answers nothing is told from one left to main: the
 * tasks-comments profile's plan comments, the fixture task's version
 * history under every profile, its agent
 * profiles' tabs' reads, its signed-in profiles' pages' reads, every
 * profile's workspace members, every other profile's task as one with no
 * agents and no linked issues, and nothing else, which goes to main as it
 * would.
 */
export function fixtureActAnswer(
  run: { readonly profile: string },
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  return (
    commentsActAnswer(run.profile, kind, payload) ??
    historyActAnswer(kind, payload) ??
    agentActAnswer(run.profile, kind, payload) ??
    automationsActAnswer(run.profile, kind, payload) ??
    settingsActAnswer(run.profile, kind, payload) ??
    fixtureMembersAnswer(kind, payload) ??
    emptyTaskAnswer(kind)
  );
}

/**
 * Main's document as a fixture run draws it (`use-app-state.ts`): with the
 * synthetic account signed in under the profiles that stage one
 * (`settings-fixture.ts`), and as main holds it under any other.
 */
export function fixtureAppState(state: AppStateSnapshot): AppStateSnapshot {
  return settingsAppState(state.run.profile, state);
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
