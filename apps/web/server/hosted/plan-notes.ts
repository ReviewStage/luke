import {
  applyNotes,
  changedFields,
  type PlanContent,
  type PlanNote,
  planBody,
  withAgentEdit,
} from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_BOUNDS, type Plan, type PlanDocument } from "@sidecar/hosted/plan-wire";
import { Clock, Effect, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { type PlanWriter, readRevisionContent, recordRevision } from "./plan-revisions.js";
import { readPlanForUpdate, savePlanDocument } from "./plan-store.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

/**
 * plan-notes.ts -- the plan's one write: take the notetaker's notes, or the developer's restore of a revision, into a plan and read back what was saved.
 *
 * Its callers are a planning call's notetaker (`voice/plan-scribe.ts`) and a
 * coding agent's `edit_plan` (`coder-host/plan-edit.ts`), whose models
 * answer with notes (`@sidecar/hosted/plan-template`): a point
 * added under a field, an example added to a rule, a phrase corrected, or a
 * line struck. They are taken in order over the fields the plan holds, the
 * fields are formatted into the canonical Markdown body under the plan's
 * name as it stands at the save, and the body, the list, and the
 * fields are saved together. A note that names a phrase the plan does not
 * hold is passed over and the rest are saved; a body past its bound once
 * formatted is refused before anything is written. Every save names its
 * writer, the notetaker on its call or a coding agent, and a save that
 * changed the plan is kept as a revision under that writer
 * (`plan-revisions.ts`), in the same transaction, so the plan and its history
 * never disagree. A coding agent's save that took any note is also written
 * into the plan's journal with the notes as taken, which is what the planning
 * model is told of what each agent changed. The developer restoring one of
 * the plan's revisions is the same save with the revision's content in place
 * of notes, kept as a revision of the developer's that names the one it
 * brought back.
 *
 * Note that the notes are the plan's content and nothing else. Which account
 * and which plan they land in are the binding the service built from the
 * authenticated session and the plan it opened, never a field the model
 * supplies. The plan is read and saved under its row's lock, because a
 * rename is the document's other writer: its heading is the plan's name, and
 * a save formatted under a name read before a rename would put the old one
 * back. The save is `savePlanDocument`'s single update over the row that
 * stands, so a plan deleted meanwhile answers as gone and is not written back
 * into being, and a save that fails answers as not saved with the prior
 * document standing. Every outcome is a result, never a failure: an unsaved
 * change leaves the notetaker's lines for its next run.
 */

/** The account and plan a planning call writes, as the service bound them. */
export interface PlanDocumentBinding {
  readonly userId: string;
  readonly planId: string;
}

/** Who took the notes where it was a coding agent: its row's id, which the service read and the model never names. */
export interface PlanNoteAuthor {
  readonly agentId: string;
}

export const PLAN_SAVE_STATUS = {
  SAVED: "saved",
  NOT_SAVED: "not-saved",
} as const;

/** Why notes, or a restore, saved nothing. */
export const PLAN_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the formatted plan is longer than a plan may be.",
  NO_PLAN: "Not saved: this plan no longer exists.",
  NO_REVISION: "Not saved: this plan has no such revision.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type PlanSaveResult =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: PlanDocument;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
      /** The notes that could not be taken, passed over while the rest were saved. */
      readonly missed: readonly PlanNote[];
      /** Whether the notes changed the plan's words, which is when the save is a revision of its writer's. */
      readonly moved: boolean;
    }
  | {
      readonly status: typeof PLAN_SAVE_STATUS.NOT_SAVED;
      readonly reason: string;
    };

/** A save that saved nothing, and why. */
type PlanNotSaved = Extract<PlanSaveResult, { status: typeof PLAN_SAVE_STATUS.NOT_SAVED }>;

const NO_PLAN_RESULT: PlanNotSaved = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.NO_PLAN,
};

/** What one save makes of the plan's content: the content after it, how many changes it made, and the notes it took and passed over, none for a restore. */
interface ContentChange {
  readonly content: PlanContent;
  readonly changes: number;
  readonly taken: readonly PlanNote[];
  readonly missed: readonly PlanNote[];
}

/** What the locked save answers: the plan as saved with the notes passed over, or why nothing was. */
type LockedSave =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      readonly plan: Plan;
      readonly missed: readonly PlanNote[];
      readonly moved: boolean;
    }
  | PlanNotSaved;

/** The change made over what the plan holds, formatted, and saved, in one transaction; a refusal where the plan is gone or the body too long. */
function savedChange(
  binding: PlanDocumentBinding,
  writer: PlanWriter,
  change: (before: PlanContent) => ContentChange,
) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(savedUnderLock(binding, writer, change)),
  );
}

/** The read and the save of `savedChange`, run inside the transaction that holds the row. */
function savedUnderLock(
  binding: PlanDocumentBinding,
  writer: PlanWriter,
  change: (before: PlanContent) => ContentChange,
) {
  return Effect.gen(function* () {
    const stored = yield* readPlanForUpdate(binding.userId, binding.planId);
    if (Option.isNone(stored)) return NO_PLAN_RESULT;
    const { fields, plan, saved: savedBefore } = stored.value;
    const before = { fields, assumptions: plan.document.assumptions };
    const { content, changes, taken, missed } = change(before);
    const body = planBody({ name: plan.name }, content.fields);
    if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
      return { status: PLAN_SAVE_STATUS.NOT_SAVED, reason: PLAN_SAVE_REFUSAL.TOO_LONG } as const;
    }
    // A change that leaves the plan's words as they were, notes that all missed among them, is no revision.
    const moved = changedFields(before, content).length > 0;
    if (moved) {
      yield* recordRevision({
        planId: binding.planId,
        writer,
        before,
        after: content,
        changes,
        savedBefore: savedBefore ? Option.some(new Date(plan.updatedAt)) : Option.none(),
      });
    }
    // An agent's save is journaled with the notes that were taken; one that took none changed nothing to journal.
    const journal =
      writer.actor !== PLAN_ACTOR.AGENT || taken.length === 0
        ? undefined
        : withAgentEdit(stored.value.agentEdits, {
            agentId: writer.agentId,
            at: yield* Clock.currentTimeMillis,
            notes: taken,
          });
    const saved = yield* savePlanDocument(
      binding.userId,
      binding.planId,
      { body, assumptions: content.assumptions },
      content.fields,
      journal,
    );
    return Option.match(saved, {
      onNone: (): LockedSave => NO_PLAN_RESULT,
      onSome: (savedPlan): LockedSave => ({
        status: PLAN_SAVE_STATUS.SAVED,
        plan: savedPlan,
        missed,
        moved,
      }),
    });
  });
}

/** The notes taken in order over the content, counted by those taken. */
function notesTaken(notes: readonly PlanNote[]) {
  return (before: PlanContent): ContentChange => {
    const { content, missed } = applyNotes(before, notes);
    const taken = notes.filter((note) => !missed.includes(note));
    return { content, changes: taken.length, taken, missed };
  };
}

/** The content put back as a revision held it, counted by the fields it changes, the assumptions one of them. */
function contentRestored(restored: PlanContent) {
  return (before: PlanContent): ContentChange => ({
    content: restored,
    changes: changedFields(before, restored).length,
    taken: [],
    missed: [],
  });
}

/** A save's failure logged and answered as the store being out of reach, so every outcome is a result. */
function reachedStore<A>(
  save: Effect.Effect<A, StoreFailure, SqlClient.SqlClient>,
): Effect.Effect<A | PlanNotSaved, never, SqlClient.SqlClient> {
  return save.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed<PlanNotSaved>({
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.UNAVAILABLE,
      }),
    ),
  );
}

/** The notetaker off any call: a writer a test, or a run with no call to name, saves as. */
const NOTETAKER: PlanWriter = { actor: PLAN_ACTOR.NOTETAKER };

/** Notes already read under the template's schema, taken into the plan the service bound, kept as a revision under their writer, the notetaker where none is named. */
export function saveNotes(
  binding: PlanDocumentBinding,
  notes: readonly PlanNote[],
  writer: PlanWriter = NOTETAKER,
): Effect.Effect<PlanSaveResult, never, SqlClient.SqlClient> {
  const saved = Effect.map(
    savedChange(binding, writer, notesTaken(notes)),
    (result): PlanSaveResult =>
      result.status === PLAN_SAVE_STATUS.SAVED
        ? {
            status: result.status,
            document: result.plan.document,
            savedAt: result.plan.updatedAt,
            missed: result.missed,
            moved: result.moved,
          }
        : result,
  );
  return reachedStore(saved);
}

/** A restore answered: the plan as it now stands saved, or why it was not. */
export type PlanRestoreResult =
  | { readonly status: typeof PLAN_SAVE_STATUS.SAVED; readonly plan: Plan }
  | PlanNotSaved;

/**
 * The developer's restore of one of the plan's revisions: the plan's content
 * put back as the revision held it, through the same locked save as notes,
 * and kept as a revision of the developer's naming the one it restored, so
 * the content it replaced stays in the history to restore in turn. A
 * revision that holds what the plan holds now saves nothing new and answers
 * the plan as it stands.
 */
export function restoreRevision(
  binding: PlanDocumentBinding,
  seq: number,
): Effect.Effect<PlanRestoreResult, never, SqlClient.SqlClient> {
  const restored = Effect.gen(function* (): Effect.fn.Return<
    PlanRestoreResult,
    StoreFailure,
    SqlClient.SqlClient
  > {
    const content = yield* readRevisionContent(binding.userId, binding.planId, seq);
    if (Option.isNone(content)) {
      return { status: PLAN_SAVE_STATUS.NOT_SAVED, reason: PLAN_SAVE_REFUSAL.NO_REVISION } as const;
    }
    const saved = yield* savedChange(
      binding,
      { actor: PLAN_ACTOR.DEVELOPER, restoredFrom: seq },
      contentRestored(content.value),
    );
    return saved.status === PLAN_SAVE_STATUS.SAVED
      ? { status: saved.status, plan: saved.plan }
      : saved;
  });
  return reachedStore(restored);
}
