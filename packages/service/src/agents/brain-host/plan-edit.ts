import type { DatabaseServices } from "@luke/database/core/query";
import { planNotesSchema, readNotes } from "@luke/features/plan-template";
import { Effect } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import { PLAN_SAVE_STATUS, type PlanDocumentBinding, saveNotes } from "../../tasks/plan-notes.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import {
  missedNote,
  PLAN_EDIT_REFUSAL,
  type PlanEditResult,
  planEditRejected,
} from "../coder-host/plan-edit.js";

/**
 * plan-edit.ts -- the planning model's own `edit_plan`: Luke's notes taken into the plan his conversation is about.
 *
 * Luke writes the plan himself, as the conversation and his own research
 * settle it, whether or not a call stands: there is no second model reading
 * the call to take notes for him. His notes are the notetaker's notes
 * (`@luke/features/plan-template`), taken through the plan's one write
 * (`../../tasks/plan-notes.ts`) under the notetaker's own actor, which the
 * plan's history shows as Luke, so a call's revisions and those made after it
 * read the same. The plan and the account are the binding the host read off
 * the authenticated session, never a field the model supplies.
 *
 * The call runs as an eve task (`apps/luke/tools/edit_plan.ts`): the model
 * gets a receipt at once and goes on researching and speaking, and what the
 * save came to, its notes taken, the plan as it stands where one missed, or
 * why nothing was saved, reaches it later as the task's result. Notes land
 * together or not at all, so a conflict saves nothing and Luke writes them
 * again over the text it answered. Note that a step eve re-runs after a crash
 * that landed its save would save its notes twice; the plan keeps no ledger
 * of saves to tell, by the developer's choice.
 */

/** The tool as the planning model is offered it: the notetaker's own name and input, and words for a save that answers later. */
export const BRAIN_EDIT_PLAN_TOOL = {
  name: AGENT_TOOL.EDIT_PLAN,
  description:
    "Write into the plan: add a point under one of its headings, or replace text copied exactly " +
    "from the saved document, as much as names one place, headings and whole sections included, " +
    "with what it becomes, or with nothing to delete it. A note's text may open headings of its " +
    "own, so you can rename, split, merge, move, and drop sections. It runs in the background: " +
    "the call answers with a receipt at once, which is not the save, and the save's result " +
    "arrives later as its task's result. A call's notes land together or not at all: where one " +
    "names text or a heading the plan does not hold exactly once, nothing is saved and the result " +
    "holds the plan as it stands, to write the notes again from.",
  inputSchema: planNotesSchema,
} as const;

/**
 * One call's notes taken into the plan the binding names: how many were
 * taken, the note that missed with the plan as it stands where one did, or
 * why nothing was saved. Every outcome is a result, never a failure, so the
 * step running it is never retried for a refusal.
 */
export function recordBrainPlanEdit(
  binding: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<PlanEditResult, never, DatabaseServices> {
  if (!isRecord(input) || !Array.isArray(input.notes)) {
    return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNREADABLE));
  }
  const { notes, unread } = readNotes(input);
  if (unread > 0) return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNREADABLE));
  return Effect.map(saveNotes(binding, notes), (save): PlanEditResult => {
    switch (save.status) {
      case PLAN_SAVE_STATUS.SAVED:
        return { status: ACTION_RESULT_STATUS.ACCEPTED, taken: notes.length };
      case PLAN_SAVE_STATUS.CONFLICT:
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_EDIT_REFUSAL.CONFLICT,
          missed: missedNote(save.missed),
          current: save.current,
        };
      case PLAN_SAVE_STATUS.NOT_SAVED:
        return planEditRejected(save.reason);
    }
  });
}
