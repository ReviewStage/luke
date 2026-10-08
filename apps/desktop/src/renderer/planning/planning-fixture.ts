import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { Board, DrawingElement } from "@sidecar/hosted/board-wire";
import { EMPTY_PLAN_FIELDS, type PlanFields, planBody } from "@sidecar/hosted/plan-template";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { RUN_PROFILE } from "#shared/messages/app-state";
import type { VoiceView } from "#shared/messages/voice-view";
import { PLAN_VIEW, type PlanView } from "./planning-model";

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
  openedAt: 3,
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
    openedAt: 2,
  },
];

const FIXTURE_PLAN_LIST: PlanningView = {
  plans: [
    {
      id: FIXTURE_PLAN.id,
      name: FIXTURE_PLAN.name,
      createdAt: FIXTURE_PLAN.createdAt,
      updatedAt: FIXTURE_PLAN.updatedAt,
      openedAt: FIXTURE_PLAN.openedAt,
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
};

/**
 * What Luke drew for the fixture's plan, in the vocabulary his
 * `draw_on_board` call sends, not yet on the board: the capture shows the
 * canvas converting it with Excalidraw's own converter, as a Mac does the
 * first time it reads a new drawing.
 */
const FIXTURE_DRAWING: readonly DrawingElement[] = [
  { type: BOARD_ELEMENT_TYPE.TEXT, id: "title", x: 0, y: -70, text: "Inviting a teammate" },
  { type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "member", x: 0, y: 0, label: "Member" },
  { type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "invites", x: 320, y: 0, label: "POST /invites" },
  { type: BOARD_ELEMENT_TYPE.ELLIPSE, id: "email", x: 640, y: 0, label: "Invite email" },
  {
    type: BOARD_ELEMENT_TYPE.DIAMOND,
    id: "valid",
    x: 640,
    y: 180,
    width: 200,
    height: 110,
    label: "Link still valid?",
  },
  {
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    id: "joined",
    x: 320,
    y: 195,
    label: "Joins workspace",
    backgroundColor: "#1971c2",
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

/** The call a fixture run's status row reads: listening, about the fixture's open plan. */
export const FIXTURE_PLANNING_CALL: Pick<VoiceView, "voiceStatus" | "callPlanId"> = {
  voiceStatus: LIVE_STATUS.LISTENING,
  callPlanId: FIXTURE_PLAN.id,
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
  return FIXTURE_PLAN_LIST;
}

/** Which of the document and the board a fixture run opens its plan on: the board under the planning-board profile. */
export function fixturePlanView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): PlanView {
  return run.fixtureMode && run.profile === RUN_PROFILE.PLANNING_BOARD
    ? PLAN_VIEW.BOARD
    : PLAN_VIEW.DOCUMENT;
}
