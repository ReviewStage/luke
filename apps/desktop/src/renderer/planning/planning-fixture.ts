import { BOARD_ELEMENT_TYPE, DRAWING_ZONE } from "@sidecar/hosted/board-vocabulary";
import type { Board, DrawingElement } from "@sidecar/hosted/board-wire";
import { EMPTY_PLAN_FIELDS, type PlanFields, planBody } from "@sidecar/hosted/plan-template";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  type CodeToken,
  PLANNING_READ,
  type PlanCode,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import {
  type PlanTranscript,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@sidecar/hosted/transcript-wire";
import { LIVE_STATUS, TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { RUN_PROFILE } from "#shared/messages/app-state";
import type { VoiceView } from "#shared/messages/voice-view";
import { SIDE_PANEL_TAB, SIDE_PANEL_WIDTH, type SidePanelState } from "./use-side-panel";

/**
 * planning-fixture.ts -- the synthetic plans a fixture run's Plans tab draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no plan, so the Plans tab
 * would show only its signed-out line. It draws the synthetic list instead,
 * which is what the expanded capture in `scripts/evidence.sh` shows now that
 * the panel opens on Plans, and under the planning profile it also opens the
 * reference journey's plan from `docs/PLANNING.md`, a draft of the fixed
 * template partway through with Luke working on the call about it, which is
 * what the planning capture shows. Every name and folder here is
 * invented; nothing is read from an account.
 */

/**
 * The reference journey's plan partway through its conversation: the goal,
 * two rules with their examples, the change map, and a decision settled, an
 * example still without its outcome, and everything else unanswered, as the
 * fixed template shows a draft.
 */
const FIXTURE_FIELDS: PlanFields = {
  ...EMPTY_PLAN_FIELDS,
  goal: {
    problem:
      "Only an admin can add someone to a workspace, by creating their account by hand, so " +
      "members wait on an admin to bring a teammate in.",
    outcome: "A member invites a teammate by email; the teammate joins by opening the link.",
  },
  rules: [
    {
      statement: "Any member may invite by email.",
      examples: [
        {
          given: "A member invites dana@example.com",
          when: "Dana opens the link",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
          then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        },
      ],
    },
    {
      statement: "A withdrawn or accepted invite link never grants access again.",
      examples: [
        {
          given: "An invite Dana already accepted",
          when: "anyone opens its link again",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
          then: 'the page reads "This invite is no longer valid"', // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        },
      ],
    },
  ],
  implementation: {
    ...EMPTY_PLAN_FIELDS.implementation,
    changeMap:
      "- `src/db/schema/memberships.ts`: a `pending` state.\n" +
      "- `src/members/invite.ts`: new, sending and accepting an invite.",
  },
  decisions:
    "Model an invite as a `memberships` row with `state = pending`. Why: removal covers " +
    "invites and members alike. Rejected: a separate `invitations` table.",
  openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or both?"],
};

const FIXTURE_PLAN: Plan = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  document: {
    body: planBody({ name: "Teammate invitations" }, FIXTURE_FIELDS),
    assumptions: [
      { text: "Invites reuse memberships with a pending state." },
      { text: "Members and admins can both invite." },
      { text: "An invite expires after 7 days." },
    ],
  },
};

const FIXTURE_OTHER_PLANS: readonly PlanSummary[] = [
  {
    id: "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71",
    name: "Billing export",
    createdAt: 1,
    updatedAt: 1,
  },
];

const FIXTURE_PLAN_LIST: PlanningView = {
  plans: [
    {
      id: FIXTURE_PLAN.id,
      name: FIXTURE_PLAN.name,
      createdAt: FIXTURE_PLAN.createdAt,
      updatedAt: FIXTURE_PLAN.updatedAt,
    },
    ...FIXTURE_OTHER_PLANS,
  ],
  listStatus: PLANNING_READ.READY,
  document: { status: PLANNING_READ.IDLE },
  folders: {
    [FIXTURE_PLAN.id]: "/Users/dev/code/relay",
    "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71": "/Users/dev/code/ledger",
  },
};

const KEYWORD = "#ff7b72";
const FUNCTION = "#d2a8ff";
const STRING = "#a5d6ff";
const COMMENT = "#8b949e";
const TYPE = "#ffa657";

/** One run of a fixture line in the colour it is drawn in. */
function run(text: string, color: string): CodeToken {
  return { text, color };
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
const FIXTURE_CODE: PlanCode = {
  ref: { path: "src/members/invite.ts", startLine: 6, endLine: 9 },
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

const { USER, ASSISTANT } = TRANSCRIPT_SPEAKER;

/** What was said on the fixture plan's one earlier call, as the record answers it: each line a message named by its place. */
const FIXTURE_TRANSCRIPT: PlanTranscript = {
  calls: [
    {
      id: "3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1a",
      startedAt: Date.parse("2026-10-07T16:20:00Z"),
      messages: (
        [
          [USER, "I want members to be able to invite a teammate by email."],
          [ASSISTANT, "Who can invite today — only admins?"],
          [USER, "Right, an admin creates the account by hand. Any member should be able to."],
          [
            ASSISTANT,
            "Got it. I'll model an invite as a pending membership, so removing it works like removing a member.",
          ],
        ] as const
      ).map(
        ([role, text], index): TranscriptMessage => ({
          id: String(index),
          role,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
        }),
      ),
    },
  ],
  earlierOmitted: false,
};

/**
 * The open plan mid-call, the planning model running a folder command
 * while the notetaker writes, so the capture shows both of the status row's
 * lines.
 */
const FIXTURE_OPEN_PLAN: PlanningView = {
  ...FIXTURE_PLAN_LIST,
  activePlanId: FIXTURE_PLAN.id,
  document: { status: PLANNING_READ.READY, plan: FIXTURE_PLAN },
  activity: { planner: { action: "grep -rn pending src/members" }, notes: true },
  transcript: { status: PLANNING_READ.READY, transcript: FIXTURE_TRANSCRIPT },
  code: FIXTURE_CODE,
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

/** The open plan on its whiteboard, as the planning-board profile captures it. */
const FIXTURE_OPEN_BOARD: PlanningView = { ...FIXTURE_OPEN_PLAN, board: FIXTURE_BOARD };

/** The side panels the fixture profiles open their plan with. */
const FIXTURE_CODE_PANEL: SidePanelState = {
  open: true,
  tab: SIDE_PANEL_TAB.CODE,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};
const FIXTURE_BOARD_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.BOARD };
const FIXTURE_TRANSCRIPT_PANEL: SidePanelState = {
  ...FIXTURE_CODE_PANEL,
  tab: SIDE_PANEL_TAB.TRANSCRIPT,
};
const FIXTURE_CLOSED_PANEL: SidePanelState = { ...FIXTURE_CODE_PANEL, open: false };

/**
 * The call a fixture run's status row and transcript read: listening, about
 * the fixture's open plan, with what was said on it so far.
 */
export const FIXTURE_PLANNING_CALL: Pick<
  VoiceView,
  "voiceStatus" | "callPlanId" | "callTranscript"
> = {
  voiceStatus: LIVE_STATUS.LISTENING,
  callPlanId: FIXTURE_PLAN.id,
  callTranscript: {
    voiceSessionId: "6b8d0f2a-4c6e-4b8d-9f1a-3c5e7a9b1d2f",
    lines: [
      {
        rowId: "fixture-1",
        speaker: USER,
        words: "Picking up where we left off: who can withdraw an invite?",
      },
      {
        rowId: "fixture-2",
        speaker: ASSISTANT,
        words: "Either the member who sent it or any admin. I'm checking how removal works now.",
      },
    ],
  },
};

/**
 * The plans a fixture run draws: the list with its first plan open under the
 * planning profile, the list alone under any other, and nothing for a live
 * run, which draws what the host read.
 */
export function fixturePlanningView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): PlanningView | undefined {
  if (!run.fixtureMode) return undefined;
  if (run.profile === RUN_PROFILE.PLANNING) return FIXTURE_OPEN_PLAN;
  if (run.profile === RUN_PROFILE.PLANNING_BOARD) return FIXTURE_OPEN_BOARD;
  if (run.profile === RUN_PROFILE.PLANNING_TRANSCRIPT) return FIXTURE_OPEN_PLAN;
  return FIXTURE_PLAN_LIST;
}

/**
 * The side panel a fixture run opens its plan with: on the code Luke has on
 * screen under the planning profile, on the whiteboard under the
 * planning-board profile, on the transcript under the planning-transcript
 * profile, and closed under any other. Nothing for a live
 * run, which opens the panel as the developer last left it.
 */
export function fixtureSidePanel(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): SidePanelState | undefined {
  if (!run.fixtureMode) return undefined;
  if (run.profile === RUN_PROFILE.PLANNING) return FIXTURE_CODE_PANEL;
  if (run.profile === RUN_PROFILE.PLANNING_BOARD) return FIXTURE_BOARD_PANEL;
  if (run.profile === RUN_PROFILE.PLANNING_TRANSCRIPT) return FIXTURE_TRANSCRIPT_PANEL;
  return FIXTURE_CLOSED_PANEL;
}
