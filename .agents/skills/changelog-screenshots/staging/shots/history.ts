/**
 * history.ts -- shot C, "Version history": the plan's versions over two days listed under their writers, the coding agent's five-change version chosen with its ⋯ menu open.
 *
 * Throwaway (`README.md`). The version history takes the whole window.
 * Nine versions by you (Dean's photo), Luke on the plan's calls, and the
 * coding agent "Add teammate invitations" (its harness's mark), one of them
 * yours restoring version 3; the agent's version 8 is chosen, its document
 * drawn with its changes marked, its menu dropped (Show changes, Open,
 * Restore). The app opens a version's sections in place of the list, never
 * inside it, so the list cannot show both.
 */

import { PLAN_ACTOR, type PlanDocument, type PlanRevisionLine } from "@luke/features/plan-wire";
import {
  TASK_CALL_FAILURE,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
} from "@luke/features/planning-view";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago, daysAgo, hoursAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import {
  AGENT_TITLE,
  documentText,
  SHOT_ID,
  SHOT_SECTIONS,
  type ShotSections,
  shotTasksView,
} from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";

/** The version opened, and the section of it drawn. */
const OPENED_SEQ = 8;

/**
 * The two compositions the shot can take, which no one frame can hold both of:
 * the agent's version open on the sections it changed (its writer at their
 * head is the Open, "Restore this version" over the page), or every version
 * listed under its writer, the restore among them, the agent's chosen with
 * its ⋯ menu dropped (Show changes, Open Add teammate invitations, Restore).
 */
const HISTORY_MODE = { SECTIONS: "sections", MENU: "menu" } as const;

/** The composition staged: the listed one; `HISTORY_MODE.SECTIONS` for the opened one. */
const MODE: (typeof HISTORY_MODE)[keyof typeof HISTORY_MODE] = HISTORY_MODE.MENU;

/** Drops the chosen version's ⋯ menu, once its row is drawn. */
const MENU_STEP: ShotStep = {
  key: "history-row-menu",
  ready: () => document.querySelector('.version-row[aria-current="true"]') !== null,
  // Note that the press waits for the list to settle, since the menu hangs where its button stood.
  run: () => {
    window.setTimeout(() => {
      const row = document.querySelector('.version-row[aria-current="true"]');
      row
        ?.closest(".version-item")
        ?.querySelector<HTMLButtonElement>(".version-row-actions button")
        ?.click();
    }, 700);
  },
};

/** Each section's earlier words, before the version that gave it the words it has now. */
const EARLIER = {
  context:
    "Only an admin can add someone to a workspace, by creating their account by hand, so members wait on an admin to bring a teammate in.",
  goal1:
    "- A member invites a teammate by email.\n- The teammate joins the workspace by opening the link.",
  goal2:
    "- A member invites a teammate by email from **Settings › Members**.\n- The teammate joins the workspace by opening the link.",
  approach1:
    "- Model an invite as a `memberships` row with `state = pending`, so removal covers invites and members alike.",
  approach2:
    "- Keep invites in a separate `invitations` table, copied into `memberships` when one is accepted.",
  interfaces:
    "`src/members/invite.ts`\n\n```ts\nexport function inviteMember(workspaceId: string, email: string): Promise<Membership>;\nexport function acceptInvite(token: string): Promise<Membership>;\n```",
  alternatives:
    "- A separate `invitations` table: lost because removing a member would then have to clear two tables.",
  hardParts:
    '- A withdrawn or accepted invite link is opened again: the page reads "This invite is no longer valid" and grants nothing.',
  notDoing: "- Bulk invites from a CSV: one at a time covers every request so far.",
  openQuestions: "- Who can withdraw an invite: the member who sent it, any admin, or both?",
  assumptions:
    "- Invites reuse memberships with a pending state.\n- Members and admins can both invite.",
} as const;

/** The document after each version, by its number. */
function documents(): ReadonlyMap<number, ShotSections> {
  const final = SHOT_SECTIONS;
  const d1: ShotSections = {
    Context: EARLIER.context,
    Goal: EARLIER.goal1,
    Approach: EARLIER.approach1,
    "Open questions": EARLIER.openQuestions,
  };
  const d2: ShotSections = { ...d1, Goal: EARLIER.goal2, "Not doing": EARLIER.notDoing };
  const d3: ShotSections = {
    ...d2,
    Interfaces: EARLIER.interfaces,
    Alternatives: EARLIER.alternatives,
    "Hard parts": EARLIER.hardParts,
    Assumptions: EARLIER.assumptions,
  };
  const d4: ShotSections = { ...d3, Approach: EARLIER.approach2 };
  const d5: ShotSections = { ...d3 };
  const d6: ShotSections = { ...d5, Context: final.Context, "Not doing": final["Not doing"] };
  const d7: ShotSections = {
    ...d6,
    Alternatives: final.Alternatives,
    Assumptions: final.Assumptions,
  };
  const d8: ShotSections = {
    ...d7,
    Approach: final.Approach,
    Interfaces: final.Interfaces,
    "Plan of attack": final["Plan of attack"],
    Testing: final.Testing,
  };
  const d9: ShotSections = { ...final };
  return new Map([
    [1, d1],
    [2, d2],
    [3, d3],
    [4, d4],
    [5, d5],
    [6, d6],
    [7, d7],
    [8, d8],
    [9, d9],
  ]);
}

/** A version's document, as the service answers one. */
function documentOf(sections: ShotSections | undefined): PlanDocument | null {
  return sections === undefined ? null : { body: `${documentText(sections)}\n`, assumptions: [] };
}

/** One of Luke's versions, written on the plan's call. */
function luke(seq: number, startedAt: number, at: number, changes: number): PlanRevisionLine {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at, duringCall: true },
    callId: SHOT_ID.CALL,
    startedAt,
    changes,
  };
}

/** One of the developer's versions. */
function yours(seq: number, at: number, changes: number): PlanRevisionLine {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at, duringCall: false },
    startedAt: at - 2 * 60_000,
    changes,
  };
}

/** The versions, newest first; the newest is the plan as it stands, and its save the plan's last edit. */
function revisions(): PlanRevisionLine[] {
  return [
    luke(9, ago(9), ago(4), 3),
    {
      seq: OPENED_SEQ,
      lastEdit: { actor: PLAN_ACTOR.AGENT, label: AGENT_TITLE, at: ago(12), duringCall: false },
      agentId: SHOT_ID.AGENT,
      startedAt: ago(24),
      changes: 5,
    },
    luke(7, ago(44), ago(38), 2),
    yours(6, hoursAgo(1), 2),
    {
      ...yours(5, daysAgo(1) + 50 * 60_000, 1),
      restoredFrom: { seq: 3, at: daysAgo(1) - 30 * 60_000 },
    },
    yours(4, daysAgo(1) + 20 * 60_000, 1),
    luke(3, daysAgo(1) - 55 * 60_000, daysAgo(1) - 30 * 60_000, 4),
    yours(2, daysAgo(2) + 25 * 60_000, 2),
    luke(1, daysAgo(2) - 20 * 60_000, daysAgo(2), 6),
  ];
}

export function historyShot(): ShotSpec {
  const docs = documents();
  const lines = revisions();
  const page: TasksRevisionsAnswer = { revisions: lines };
  const revision = (seq: number): TasksRevisionAnswer => {
    const document = documentOf(docs.get(seq));
    if (document === null) return { failure: TASK_CALL_FAILURE.UNANSWERED };
    return { revision: { seq, document, previous: documentOf(docs.get(seq - 1)) } };
  };
  return {
    tasks: shotTasksView({}),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.TASKS_REVISIONS]: (payload) =>
        payload.taskId !== SHOT_ID.TASK
          ? undefined
          : payload.before === undefined
            ? page
            : { revisions: [] },
      [ACT_KIND.TASKS_REVISION]: (payload) =>
        payload.taskId === SHOT_ID.TASK ? revision(payload.seq) : undefined,
      [ACT_KIND.TASKS_RESTORE]: () => false,
    },
    layout: {
      history:
        MODE === HISTORY_MODE.SECTIONS
          ? { revision: OPENED_SEQ, opened: { seq: OPENED_SEQ, heading: "Approach" } }
          : { revision: OPENED_SEQ, opened: undefined },
    },
    steps: MODE === HISTORY_MODE.MENU ? [MENU_STEP] : [],
  };
}
