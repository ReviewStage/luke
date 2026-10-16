import { AGENT_TOOL, EVE_TOOL } from "@luke/features/agent-tools";
import { BOARD_ELEMENT_TYPE, DRAWING_ZONE } from "@luke/features/board-vocabulary";
import type { Board, DrawingElement } from "@luke/features/board-wire";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import {
  type CodeToken,
  TASK_WORK_STATE,
  TASKS_READ,
  type TaskCode,
  type TaskCodeShowing,
  type TasksRepositoriesAnswer,
  type TasksView,
  type TaskWorkTurn,
} from "@luke/features/tasks-view";
import {
  type TaskTranscript,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@luke/features/transcript-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { RUN_PROFILE } from "@luke/host/app-state";
import { LIVE_STATUS, TRANSCRIPT_SPEAKER } from "@luke/live";
import type { VoiceView } from "@luke/voice/voice-view";
import type { WireRecord, WireValue } from "@luke/wire";
import { TOOL_STATE } from "../ai-elements/tool";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
} from "./use-side-panel";

/**
 * planning-fixture.ts -- the synthetic plans a fixture run's Plans tab draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no plan, so the Plans tab
 * would show only its signed-out line. It draws the synthetic list instead,
 * which is what the expanded capture in `scripts/evidence.sh` shows now that
 * the panel opens on Plans, and under the planning profile it also opens the
 * reference journey's plan from `docs/TASKS.md`, a draft of the default
 * template partway through with Luke working on the call about it, which is
 * what the planning capture shows. Every name and repository here is
 * invented; nothing is read from an account.
 */

/**
 * The fixture account's workspaces: its first one, named for the account as
 * the service names it, which the sidebar lists, with the account's own
 * GitHub connected, and Acme, a team's it administers, whose GitHub organization is connected, so the captures
 * draw the sidebar's switcher with every item. Each workspace's plans are
 * about repositories its own GitHub reaches, as the service keeps them, so
 * no plan here is one stranded in a workspace that cannot reach it.
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
 * The reference journey's plan partway through its conversation: the
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

const FIXTURE_TASK: Task = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  workspaceId: FIXTURE_FIRST.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "ada/relay",
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

/** The repositories each fixture workspace's GitHub reaches: the ones its plans are about. */
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
    },
    ...FIXTURE_OTHER_TASKS,
  ],
  listStatus: TASKS_READ.READY,
  workspaces: FIXTURE_WORKSPACES,
  github: { connected: true, login: null },
  document: { status: TASKS_READ.IDLE },
};

/** The fixture's colours as the host's highlighter gives them, in GitHub's dark and light themes. */
const KEYWORD = { color: "#ff7b72", lightColor: "#cf222e" } as const;
const FUNCTION = { color: "#d2a8ff", lightColor: "#8250df" } as const;
const STRING = { color: "#a5d6ff", lightColor: "#0a3069" } as const;
const COMMENT = { color: "#8b949e", lightColor: "#6e7781" } as const;
const TYPE = { color: "#ffa657", lightColor: "#953800" } as const;

/** One run of a fixture line in the colours it is drawn in. */
function run(
  text: string,
  colours: { readonly color: string; readonly lightColor: string },
): CodeToken {
  return { text, ...colours };
}

/** One fixture line from its runs, a bare word drawn in the theme's own foreground. */
function fixtureLine(...runs: readonly (string | CodeToken)[]): CodeToken[] {
  return runs.map((part) => (part instanceof Object ? part : { text: part }));
}

/**
 * The code on screen in the fixture's call: Luke pointing at the invite
 * check he is asking about, lines 6 to 9 of an invented file, coloured as
 * the host's highlighter colours TypeScript.
 */
const FIXTURE_CODE: TaskCode = {
  ref: { path: "src/members/invite.ts", startLine: 6, endLine: 9 },
  repository: "ada/relay",
  firstLine: 1,
  lineCount: 14,
  lines: [
    fixtureLine(
      run("import", KEYWORD),
      " { db } ",
      run("from", KEYWORD),
      " ",
      run('"../db"', STRING),
      ";",
    ),
    [],
    fixtureLine(run("// An invite link is good once, and for seven days.", COMMENT)),
    fixtureLine(
      run("export", KEYWORD),
      " ",
      run("async", KEYWORD),
      " ",
      run("function", KEYWORD),
      " ",
      run("acceptInvite", FUNCTION),
      "(token: ",
      run("string", TYPE),
      ") {",
    ),
    fixtureLine(
      "  ",
      run("const", KEYWORD),
      " invite = ",
      run("await", KEYWORD),
      " db.invites.",
      run("find", FUNCTION),
      "(token);",
    ),
    fixtureLine("  ", run("if", KEYWORD), " (!invite || invite.acceptedAt) {"),
    fixtureLine(
      "    ",
      run("throw", KEYWORD),
      " ",
      run("new", KEYWORD),
      " ",
      run("InviteError", FUNCTION),
      "(",
      run('"no-longer-valid"', STRING),
      ");",
    ),
    fixtureLine("  }"),
    fixtureLine(
      "  ",
      run("if", KEYWORD),
      " (",
      run("expired", FUNCTION),
      "(invite)) ",
      run("throw", KEYWORD),
      " ",
      run("new", KEYWORD),
      " ",
      run("InviteError", FUNCTION),
      "(",
      run('"expired"', STRING),
      ");",
    ),
    fixtureLine(
      "  ",
      run("await", KEYWORD),
      " db.members.",
      run("add", FUNCTION),
      "(invite.workspaceId, invite.email);",
    ),
    fixtureLine(
      "  ",
      run("await", KEYWORD),
      " db.invites.",
      run("accept", FUNCTION),
      "(invite.id);",
    ),
    fixtureLine("}"),
    [],
    fixtureLine(run("export", KEYWORD), " { acceptInvite };"),
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

/**
 * Every code Luke showed in the fixture's call, a walkthrough of one file in
 * three steps, each with his note: where a link lands, the check he is asking
 * about, and the expiry after it.
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
];

const { USER, ASSISTANT } = TRANSCRIPT_SPEAKER;

/** What was said on the fixture plan's one earlier call, as the record answers it: each line a message named by its place, and by the row the voice wrote for it. */
const FIXTURE_TRANSCRIPT: TaskTranscript = {
  calls: [
    {
      id: "3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1a",
      startedAt: Date.parse("2026-10-07T16:20:00Z"),
      messages: (
        [
          [USER, "I want members to be able to invite a teammate by email.", "fixture-earlier-0"],
          [ASSISTANT, "Who can invite today — only admins?", "fixture-earlier-1"],
          [
            USER,
            "Right, an admin creates the account by hand. Any member should be able to.",
            "fixture-earlier-2",
          ],
          [
            ASSISTANT,
            "Got it. I'll model an invite as a pending membership, so removing it works like removing a member.",
            "fixture-earlier-3",
          ],
        ] as const
      ).map(
        ([role, text, rowId], index): TranscriptMessage => ({
          id: String(index),
          role,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
          metadata: { rowIds: [rowId] },
        }),
      ),
    },
  ],
  earlierOmitted: false,
};

/**
 * The open plan mid-call, the planning model running a repository command
 * while the notetaker writes, so the capture shows both of the status row's
 * lines.
 */
const FIXTURE_OPEN_TASK: TasksView = {
  ...FIXTURE_TASK_LIST,
  activeTaskId: FIXTURE_TASK.id,
  document: { status: TASKS_READ.READY, task: FIXTURE_TASK },
  activity: { planner: { action: "grep -rn pending src/members" }, notes: true },
  transcript: { status: TASKS_READ.READY, transcript: FIXTURE_TRANSCRIPT },
  shownCode: FIXTURE_SHOWN_CODE,
};

/**
 * What Luke drew for the fixture's plan, in the vocabulary his
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

/** The open plan on its whiteboard, as the tasks-board profile captures it. */
const FIXTURE_OPEN_BOARD: TasksView = { ...FIXTURE_OPEN_TASK, board: FIXTURE_BOARD };

/** A call of the fixture's turns, as the AI SDK journals it: answered with `output`, or running where it has none. */
function fixtureCall(tool: string, id: string, input: WireRecord, output?: WireValue) {
  return {
    type: `tool-${tool}`,
    toolCallId: id,
    state: output === undefined ? TOOL_STATE.INPUT_AVAILABLE : TOOL_STATE.OUTPUT_AVAILABLE,
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

/** A repository command of the fixture's turns, answered with `stdout` where it has answered. */
function fixtureCommand(id: string, command: string, stdout?: string) {
  return fixtureCall(
    AGENT_TOOL.RUN_IN_REPOSITORY,
    id,
    { command },
    stdout === undefined ? undefined : { status: "ran", exitCode: 0, stdout, stderr: "" },
  );
}

/** The store's id for the session of the fixture's call standing now. */
const FIXTURE_LIVE_SESSION = "6b8d0f2a-4c6e-4b8d-9f1a-3c5e7a9b1d2f";

/**
 * What Luke's planning model did on the fixture's calls: an earlier turn
 * that read the members code and answered, and the turn standing now, which
 * handed a comparison to the worker and is reading on while it runs.
 * Synthetic throughout: no real repository, command output, or page.
 */
const FIXTURE_WORKER_TASK =
  "Compare how two invite libraries let an admin revoke a pending invite.";

const FIXTURE_WORK: readonly TaskWorkTurn[] = [
  {
    turnId: "fixture-turn-1",
    startedAt: Date.parse("2026-10-07T16:21:00Z"),
    state: TASK_WORK_STATE.DONE,
    earlierOmitted: false,
    // The earlier call's "Any member should be able to." asked for it.
    asked: ["fixture-earlier-2"],
    journal: [
      fixtureCommand("fixture-call-1", "ls src/members", "invite.ts\nmembership.ts\nroles.ts"),
      fixtureCommand(
        "fixture-call-2",
        "grep -rn withdraw src/members",
        "src/members/invite.ts:42:export function withdrawInvite(invite: Invite, by: Member) {",
      ),
      { type: "text", text: "Only the member who sent an invite can withdraw it today." },
    ],
    workers: [],
  },
  {
    turnId: "fixture-turn-2",
    startedAt: Date.parse("2026-10-07T16:44:00Z"),
    state: TASK_WORK_STATE.RUNNING,
    earlierOmitted: false,
    // The call standing now's "who can withdraw an invite?" asked for it, under the service's own row id, which the line heard on the call is matched to by where it began.
    asked: ["fixture-service-1"],
    askedAt: [{ voiceSessionId: FIXTURE_LIVE_SESSION, fromMs: 1_200 }],
    journal: [
      {
        type: "reasoning",
        text: "The developer wants admins to withdraw invites too. Before suggesting a library, check whether removal already has an admin check to reuse, and hand the library comparison to the worker so the answer is not held up.",
      },
      fixtureCall(
        EVE_TOOL.WORKER,
        "fixture-call-3",
        { message: FIXTURE_WORKER_TASK },
        "Started task worker-fixture. Its result will arrive in a <task_result> message.",
      ),
      { type: "text", text: "While that runs, I'm checking how removal works now." },
      fixtureCommand(
        "fixture-call-4",
        "sed -n 30,60p src/members/membership.ts",
        "export function removeMember(member: Member, by: Member) {\n  assertAdmin(by);\n  …",
      ),
      fixtureCommand("fixture-call-5", "grep -rn pending src/members"),
    ],
    workers: [
      {
        callId: "fixture-call-3",
        taskId: "worker-fixture",
        task: FIXTURE_WORKER_TASK,
        state: TASK_WORK_STATE.RUNNING,
        earlierOmitted: false,
        journal: [
          fixtureCall(
            AGENT_TOOL.SEARCH_WEB,
            "fixture-worker-1",
            { query: "invite library revoke pending invite admin" },
            {
              status: "found",
              query: "invite library revoke pending invite admin",
              summary:
                "invite-kit documents revoking invites; invitely exposes DELETE /invites/:id.",
              findings: [],
            },
          ),
          fixtureCommand(
            "fixture-worker-2",
            "grep -rn revoke node_modules/invite-kit/README.md",
            "README.md:88:Admins may revoke any pending invite with revoke(invite).",
          ),
          {
            type: "text",
            text: "invite-kit lets any admin revoke a pending invite; invitely only lets its sender.",
          },
        ],
      },
    ],
  },
];

/** The open plan mid-call on its work, as the tasks-work profile captures it. */
const FIXTURE_OPEN_WORK: TasksView = { ...FIXTURE_OPEN_TASK, work: FIXTURE_WORK };

/** The side panels the fixture profiles open their plan with. */
const FIXTURE_CODE_PANEL: SidePanelState = {
  open: true,
  tabs: SIDE_PANEL_TABS,
  tab: SIDE_PANEL_TAB.CODE,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};
const FIXTURE_BOARD_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.BOARD };
const FIXTURE_CALL_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.CALL };
const FIXTURE_CLOSED_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, open: false };

/**
 * The call a fixture run's status row and transcript read: listening, about
 * the fixture's open plan, with what was said on it so far.
 */
export const FIXTURE_TASKS_CALL: Pick<VoiceView, "voiceStatus" | "callTaskId" | "callTranscript"> =
  {
    voiceStatus: LIVE_STATUS.LISTENING,
    callTaskId: FIXTURE_TASK.id,
    callTranscript: {
      voiceSessionId: FIXTURE_LIVE_SESSION,
      lines: [
        {
          rowId: "fixture-1",
          speaker: USER,
          words: "Picking up where we left off: who can withdraw an invite?",
          startMs: 1_200,
          endMs: 4_800,
        },
        {
          rowId: "fixture-2",
          speaker: ASSISTANT,
          words: "Either the member who sent it or any admin. I'm checking how removal works now.",
          startMs: 5_400,
          endMs: 9_900,
        },
      ],
    },
  };

/**
 * The plans a fixture run draws: the list with its first plan open under the
 * planning profile, the list alone under any other, and nothing for a live
 * run, which draws what the host read.
 */
export function fixtureTasksView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): TasksView | undefined {
  if (!run.fixtureMode) return undefined;
  if (run.profile === RUN_PROFILE.TASKS) return FIXTURE_OPEN_TASK;
  if (run.profile === RUN_PROFILE.TASKS_BOARD) return FIXTURE_OPEN_BOARD;
  if (run.profile === RUN_PROFILE.TASKS_TRANSCRIPT) return FIXTURE_OPEN_TASK;
  if (run.profile === RUN_PROFILE.TASKS_WORK) return FIXTURE_OPEN_WORK;
  return FIXTURE_TASK_LIST;
}

/**
 * The side panel a fixture run opens its plan with: on the code Luke has on
 * screen under the planning profile, on the whiteboard under the
 * tasks-board profile, on the call under the tasks-transcript and
 * tasks-work profiles, the latter with Luke at work on it, and closed
 * under any other. Nothing for a live
 * run, which opens the panel as the developer last left it.
 */
export function fixtureSidePanel(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): SidePanelState | undefined {
  if (!run.fixtureMode) return undefined;
  if (run.profile === RUN_PROFILE.TASKS) return FIXTURE_CODE_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_BOARD) return FIXTURE_BOARD_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_TRANSCRIPT) return FIXTURE_CALL_PANEL;
  if (run.profile === RUN_PROFILE.TASKS_WORK) return FIXTURE_CALL_PANEL;
  return FIXTURE_CLOSED_PANEL;
}
