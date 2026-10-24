import { BOARD_ELEMENT_TYPE, DRAWING_ZONE } from "@luke/features/board-vocabulary";
import type { Board, DrawingElement } from "@luke/features/board-wire";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskSummary } from "@luke/features/task-wire";
import {
  TASKS_READ,
  type TaskCode,
  type TaskCodeShowing,
  type TasksRepositoriesAnswer,
  type TasksView,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { agentActAnswer, agentSidePanel, agentTasksView } from "./agent-fixture.js";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
  type StagedSidePanel,
} from "./use-side-panel.js";

/**
 * tasks-fixture.ts -- the synthetic tasks a fixture run's Tasks tab draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no task, so the Tasks tab
 * would show only its signed-out line. It draws the synthetic list instead,
 * which is what the expanded capture in `scripts/evidence.sh` shows now that
 * the panel opens on Tasks, and under the tasks profile it also opens the
 * reference journey's task from `docs/TASKS.md`, a draft of the default
 * template partway through with Luke working on the call about it, which is
 * what the tasks capture shows. Every name and repository here is
 * invented; nothing is read from an account.
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
  id: "workspace-personal",
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
const FIXTURE_TEXT = [
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
].join("\n\n");

/** The reference journey's task, by the id its chat channel (`chat-fixture.ts`) and the host's staged call (`@luke/host/fixture-stage`) name it by too. */
export const FIXTURE_TASK_ID = FIXTURE_IDS.TASK;

const FIXTURE_TASK: Task = {
  id: FIXTURE_TASK_ID,
  workspaceId: FIXTURE_FIRST.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "ada/relay",
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  document: { body: `${FIXTURE_TEXT}\n`, assumptions: [] },
};

const FIXTURE_OTHER_TASKS: readonly TaskSummary[] = [
  {
    id: "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71",
    workspaceId: FIXTURE_FIRST.id,
    name: "Billing export",
    createdAt: 1,
    updatedAt: 1,
    repository: "ada/ledger",
  },
  {
    id: "2b8c4e6a-0d3f-4a51-9c79-3e4f5a6b7c82",
    workspaceId: FIXTURE_TEAM.id,
    name: "Usage alerts",
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
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
 * The open task mid-call, the brain running a repository command
 * while the notetaker writes, so the capture shows both of the status row's
 * lines.
 */
const FIXTURE_OPEN_TASK: TasksView = {
  ...FIXTURE_TASK_LIST,
  activeTaskId: FIXTURE_TASK.id,
  document: { status: TASKS_READ.READY, task: FIXTURE_TASK },
  activity: { planner: { action: "grep -rn pending src/members" }, notes: true },
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
 * profiles (`agent-fixture.ts`), the list alone under any other, and nothing
 * for a live run, which draws what the host read.
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
  return FIXTURE_TASK_LIST;
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
 * What a fixture run answers an act with in place of main (`act.ts`), boxed
 * so an act that answers nothing is told from one left to main: its agent
 * profiles' tabs' reads, and nothing else, which goes to main as it would.
 */
export function fixtureActAnswer(
  run: { readonly profile: string },
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  return agentActAnswer(run.profile, kind, payload);
}
