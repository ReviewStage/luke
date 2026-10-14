import type { DatabaseServices } from "@sidecar/database/core/query";
import {
  NOTE_KIND,
  type PlanNote,
  planNotesSchema,
  readNotes,
} from "@sidecar/features/plan-template";
import { PLAN_ACTOR } from "@sidecar/features/plan-wire";
import { Effect } from "effect";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "../../core.js";
import {
  PLAN_SAVE_STATUS,
  type PlanDocumentBinding,
  type PlanNoteAuthor,
  saveNotes,
} from "../plan-notes.js";

/**
 * plan-edit.ts -- the coding agent's `edit_plan` tool: the notetaker's own notes, taken into the agent's plan.
 *
 * An agent that meets something the plan does not settle, verifies a fact
 * the plan has wrong, or makes a decision the plan left open does not stop
 * and does not keep it to itself: it takes notes on the plan exactly as the
 * planning call's notetaker does (`voice/plan-scribe.ts`), under the same
 * schema and through the plan's one write (`plan-notes.ts`), which journals
 * the save under the agent's id, so the planning model and the developer
 * read them on the next call and see which agent wrote what. Note that the call answers at once, whatever was
 * saved, because the agent's turn is its whole run and nothing is answered
 * to it mid-turn; an answer reaches it as a later message. A turn may take
 * only so many notes: past the cap the agent is told to go on and name the
 * rest in its message, so a model that writes at every step cannot rewrite
 * the plan under the developer.
 */
const PLAN_EDIT = {
  /** The most notes one turn may take on the plan, across its calls. */
  MAX_NOTES_PER_TURN: 40,
} as const;

/** The tool as a coding agent is offered it: its name, its words, and the notetaker's own input schema. */
export const EDIT_PLAN_TOOL = {
  name: "edit_plan",
  description:
    "Take notes on the plan this conversation implements, as its notetaker does: add a point " +
    "under one of its headings, correct a phrase copied exactly from the saved text, or strike " +
    "the line holding one. Use it to record a question the plan does not answer under its open " +
    "questions together with the assumption you go on under, to correct a fact you verified in " +
    "the code, to record a hard part you met, an interface you had to change, or a decision you " +
    "made, each under the heading it belongs to. Every save is recorded in the plan as yours. The developer reads the plan on their next " +
    "planning call; you do not wait for an answer. A note naming a phrase the plan does not " +
    `hold is passed over and reported. A turn may take at most ${PLAN_EDIT.MAX_NOTES_PER_TURN} notes.`,
  inputSchema: planNotesSchema,
} as const;

/** Why a call saved nothing, in the words the model reads. */
export const PLAN_EDIT_REFUSAL = {
  UNREADABLE: "Not saved: the notes do not read under the plan's template.",
  TOO_MANY: `Not saved: a turn may take at most ${PLAN_EDIT.MAX_NOTES_PER_TURN} notes on the plan. Go on, and name what you would have noted in your message.`,
  UNAVAILABLE: "Not saved: the service could not reach its store.",
  NO_PLAN:
    "Not saved: you were handed a task rather than the plan, so there is no plan of yours to update.",
} as const;

/** How many notes a turn has taken, kept in eve's durable session state: the turn and its count. */
export interface NotesTaken {
  readonly turnId?: string;
  readonly count: number;
}

export const NO_NOTES_TAKEN: NotesTaken = { count: 0 };

/** How many notes the turn given has taken; a record of another turn counts for nothing. */
export function takenInTurn(taken: NotesTaken, turnId: string): number {
  return taken.turnId === turnId ? taken.count : 0;
}

/**
 * The record with a call's notes reserved against the turn's cap before the
 * save goes out, because two calls one step makes run at once and each would
 * otherwise read the count the other has not yet raised.
 */
export function reserveNotes(taken: NotesTaken, turnId: string, requested: number): NotesTaken {
  return { turnId, count: takenInTurn(taken, turnId) + requested };
}

/** The record settled once the save answered: the reservation replaced by what was taken, which is nothing for a refused call. */
export function settleNotes(
  taken: NotesTaken,
  turnId: string,
  requested: number,
  saved: number,
): NotesTaken {
  return { turnId, count: Math.max(0, takenInTurn(taken, turnId) - requested + saved) };
}

/**
 * A call's notes, or nothing where the call holds no list of notes or any
 * of its notes does not read, which refuses it whole.
 */
function notesOf(input: UnparsedWireValue): readonly PlanNote[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.notes)) return undefined;
  const { notes, unread } = readNotes(input);
  return unread > 0 ? undefined : notes;
}

/** How many notes a call asks to take, read off its input; nothing readable asks for none, and the save refuses it by name. */
export function requestedNotes(input: UnparsedWireValue): number {
  return notesOf(input)?.length ?? 0;
}

/** What a call answers, as the model and the authored file read it: the notes taken and the ones passed over, or why nothing was saved. */
export type PlanEditResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly taken: number;
      readonly missed: readonly string[];
    }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

export function planEditRejected(reason: string): PlanEditResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A note passed over, in the words the model reads: its kind and where it was aimed. */
function missedNote(note: PlanNote): string {
  return note.kind === NOTE_KIND.ADD
    ? `${note.kind} under ${note.section}`
    : `${note.kind} ${note.find}`;
}

/**
 * Runs one call: the notes taken into the plan the binding names, or the
 * refusal for notes that do not read, a turn past its cap, or a plan the
 * save refused. Note that `takenInTurn` is the caller's count of this
 * turn's notes, because the count lives in eve's session state, which only
 * the authored file can read.
 */
export function recordPlanEdit(
  binding: PlanDocumentBinding,
  author: PlanNoteAuthor,
  input: UnparsedWireValue,
  takenInTurn: number,
): Effect.Effect<PlanEditResult, never, DatabaseServices> {
  const notes = notesOf(input);
  if (notes === undefined) return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNREADABLE));
  if (takenInTurn + notes.length > PLAN_EDIT.MAX_NOTES_PER_TURN) {
    return Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.TOO_MANY));
  }
  const writer = { actor: PLAN_ACTOR.AGENT, agentId: author.agentId } as const;
  return Effect.map(saveNotes(binding, notes, writer), (saved): PlanEditResult => {
    if (saved.status !== PLAN_SAVE_STATUS.SAVED) return planEditRejected(saved.reason);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      taken: notes.length - saved.missed.length,
      missed: saved.missed.map(missedNote),
    };
  });
}
