import {
  applyDeveloperEdit,
  type PlanEditRequest,
  type PlanEditValue,
} from "@sidecar/hosted/plan-edit";
import {
  applyNotes,
  changedFields,
  type PlanAgentEdit,
  type PlanContent,
  type PlanNote,
  planBody,
  withAgentEdit,
  withFieldWriters,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_BOUNDS,
  type Plan,
  type PlanDocument,
  type PlanFieldEdit,
  type PlanFields,
} from "@sidecar/hosted/plan-wire";
import { Clock, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  fieldWriterOf,
  type PlanWriter,
  readRevisionContent,
  recordRevision,
} from "./plan-revisions.js";
import { readPlanForUpdate, type StoredPlan, savePlanDocument } from "./plan-store.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

/**
 * plan-notes.ts -- the plan's one write: take the notetaker's notes, the developer's edit of a field, or their restore of a revision, into a plan and read back what was saved.
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
 * writer, the notetaker on its call, a coding agent, or the developer, and a
 * save that changed the plan is kept as a revision under that writer
 * (`plan-revisions.ts`), in the same transaction, so the plan and its history
 * never disagree. A coding agent's save that took any note is also written
 * into the plan's journal with the notes as taken, which is what the planning
 * model is told of what each agent changed. Each field a save changed names
 * its writer as the field's last, which tells the planning model and the
 * notetaker the fields the developer wrote. The developer's edit of a field
 * is the same save with their answer in place of notes, laid over what the
 * field holds now where Luke wrote meanwhile, or answered as a conflict with
 * nothing saved (`@sidecar/hosted/plan-edit`). Their restore of one of the
 * plan's revisions is the same save with the revision's content, kept as a
 * revision of the developer's that names the one it brought back.
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
 *
 * An archived plan takes no new edit or restore of the developer's, read
 * under the same lock as the save, so an older desktop or an archive racing
 * the edit cannot write it. The notes of a call or a coding agent already
 * running when the plan was archived still land, as revisions in its
 * history: the archive takes no new work, and loses none under way.
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
  /** The developer's edit no longer lands in the field as it stands; nothing was saved. */
  CONFLICT: "conflict",
  NOT_SAVED: "not-saved",
} as const;

/** Why notes, an edit, or a restore saved nothing. */
export const PLAN_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the formatted plan is longer than a plan may be.",
  NO_PLAN: "Not saved: this plan no longer exists.",
  NO_REVISION: "Not saved: this plan has no such revision.",
  ARCHIVED: "Not saved: this plan is archived.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type PlanSaveResult =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: PlanDocument;
      /** The fields the saved document was formatted from. */
      readonly fields: PlanFields;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
      /** The notes that could not be taken, passed over while the rest were saved. */
      readonly missed: readonly PlanNote[];
      /** Whether the notes changed the plan's words, which is when the save is a revision of its writer's. */
      readonly moved: boolean;
      /** The save that last changed each field, this one among them, as the plan now names them. */
      readonly fieldEdits: readonly PlanFieldEdit[];
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

const ARCHIVED_RESULT: PlanNotSaved = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.ARCHIVED,
};

/** Whether the plan as read under its lock is archived, which takes none of the developer's writes. */
function archived(stored: StoredPlan): boolean {
  return stored.plan.archivedAt !== undefined;
}

/** What a change made of the plan's content under its lock: the content to save, how many changes it made, and the agents' journal where it moved. */
interface PlanTaken {
  readonly content: PlanContent;
  readonly changes: number;
  readonly agentEdits?: readonly PlanAgentEdit[];
}

/** One save under the plan's lock, answered: the plan as saved with what the change took, or why nothing was saved. */
type LockedSave<T> =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      readonly plan: Plan;
      readonly taken: T;
      /** Whether the change moved the plan's words, which is when the save is a revision. */
      readonly moved: boolean;
    }
  | PlanNotSaved;

/** A developer's edit that no longer lands in the field as it stands, with what the field holds; nothing was saved. */
interface PlanConflict {
  readonly status: typeof PLAN_SAVE_STATUS.CONFLICT;
  readonly current: PlanEditValue;
}

/**
 * The plan read under its row's lock, the change taken into it, formatted,
 * and saved, all in one transaction. A change that moved the content is kept
 * as a revision under its writer, and each field it moved names the writer
 * as its last; one that moved nothing saves the document as it stood. A
 * change that refuses the plan as it found it answers its refusal, and
 * nothing is saved.
 */
function savedUnderLock<T extends PlanTaken, F>(
  binding: PlanDocumentBinding,
  writer: PlanWriter,
  take: (stored: StoredPlan, now: number) => Result.Result<T, F>,
): Effect.Effect<LockedSave<T> | F, StoreFailure, SqlClient.SqlClient> {
  const locked = Effect.gen(function* (): Effect.fn.Return<
    LockedSave<T> | F,
    StoreFailure,
    SqlClient.SqlClient
  > {
    const stored = yield* readPlanForUpdate(binding.userId, binding.planId);
    if (Option.isNone(stored)) return NO_PLAN_RESULT;
    const { fields, plan, saved: savedBefore } = stored.value;
    const before: PlanContent = { fields, assumptions: plan.document.assumptions };
    const now = yield* Clock.currentTimeMillis;
    const outcome = take(stored.value, now);
    if (Result.isFailure(outcome)) return outcome.failure;
    const taken = outcome.success;
    const { content } = taken;
    const body = planBody({ name: plan.name }, content.fields);
    if (body.length > PLAN_BOUNDS.MAX_BODY_CHARS) {
      return { status: PLAN_SAVE_STATUS.NOT_SAVED, reason: PLAN_SAVE_REFUSAL.TOO_LONG } as const;
    }
    // A change that missed, or took a field to the words it held, leaves the plan as it was: no revision.
    const moved = changedFields(before, content).length > 0;
    if (moved) {
      yield* recordRevision({
        planId: binding.planId,
        writer,
        before,
        after: content,
        changes: taken.changes,
        savedBefore: savedBefore ? Option.some(new Date(plan.updatedAt)) : Option.none(),
      });
    }
    const saved = yield* savePlanDocument(
      binding.userId,
      binding.planId,
      { body, assumptions: content.assumptions },
      {
        fields: content.fields,
        ...(taken.agentEdits === undefined ? undefined : { agentEdits: taken.agentEdits }),
        ...(moved
          ? {
              fieldWriters: withFieldWriters(
                stored.value.fieldWriters,
                { before, after: content },
                fieldWriterOf(writer),
                now,
              ),
            }
          : undefined),
      },
    );
    if (Option.isNone(saved)) return NO_PLAN_RESULT;
    return { status: PLAN_SAVE_STATUS.SAVED, plan: saved.value, taken, moved };
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/** The content a plan holds, as a change reads it before it takes anything. */
function contentOf(stored: StoredPlan): PlanContent {
  return { fields: stored.fields, assumptions: stored.plan.document.assumptions };
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

/** The developer, as the writer of every edit the window sends. */
const DEVELOPER: PlanWriter = { actor: PLAN_ACTOR.DEVELOPER };

/** Notes already read under the template's schema, taken into the plan the service bound, kept as a revision under their writer, the notetaker where none is named. */
export function saveNotes(
  binding: PlanDocumentBinding,
  notes: readonly PlanNote[],
  writer: PlanWriter = NOTETAKER,
): Effect.Effect<PlanSaveResult, never, SqlClient.SqlClient> {
  const take = (stored: StoredPlan, now: number) => {
    const { content, missed } = applyNotes(contentOf(stored), notes);
    const taken = notes.filter((note) => !missed.includes(note));
    // An agent's save is journaled with the notes that were taken; one that took none changed nothing to journal.
    const journaled =
      writer.actor === PLAN_ACTOR.AGENT && taken.length > 0
        ? {
            agentEdits: withAgentEdit(stored.agentEdits, {
              agentId: writer.agentId,
              at: now,
              notes: taken,
            }),
          }
        : undefined;
    return Result.succeed({ content, changes: taken.length, missed, ...journaled });
  };
  // Notes never refuse the plan they find: one naming a phrase the plan does not hold is passed over.
  const saved = Effect.map(savedUnderLock(binding, writer, take), (result): PlanSaveResult => {
    if (result.status === PLAN_SAVE_STATUS.NOT_SAVED) return result;
    return {
      status: PLAN_SAVE_STATUS.SAVED,
      document: result.plan.document,
      fields: result.taken.content.fields,
      savedAt: result.plan.updatedAt,
      missed: result.taken.missed,
      moved: result.moved,
      fieldEdits: result.plan.fieldEdits ?? [],
    };
  });
  return reachedStore(saved);
}

/** What the developer's edit of a field answers: the plan as saved, the field as it stands where the edit conflicts with it, or why nothing was saved. */
export type PlanEditSaveResult =
  | { readonly status: typeof PLAN_SAVE_STATUS.SAVED; readonly plan: Plan }
  | PlanConflict
  | PlanNotSaved;

/**
 * The developer's own edit of one field, taken into the plan the service
 * bound under its lock and kept as a revision of theirs: the field set where
 * it still holds the edit's base, the developer's change laid over it where
 * Luke wrote meanwhile, and a conflict, with nothing saved, where it cannot
 * be (`@sidecar/hosted/plan-edit`).
 */
export function saveDeveloperEdit(
  binding: PlanDocumentBinding,
  edit: PlanEditRequest,
): Effect.Effect<PlanEditSaveResult, never, SqlClient.SqlClient> {
  const take = (stored: StoredPlan): Result.Result<PlanTaken, PlanConflict | PlanNotSaved> => {
    if (archived(stored)) return Result.fail(ARCHIVED_RESULT);
    const outcome = applyDeveloperEdit(contentOf(stored), edit);
    if ("conflict" in outcome) {
      const conflict: PlanConflict = {
        status: PLAN_SAVE_STATUS.CONFLICT,
        current: outcome.conflict.current,
      };
      return Result.fail(conflict);
    }
    return Result.succeed({ content: outcome.applied, changes: 1 });
  };
  const saved = Effect.map(
    savedUnderLock(binding, DEVELOPER, take),
    (result): PlanEditSaveResult =>
      result.status === PLAN_SAVE_STATUS.SAVED
        ? { status: PLAN_SAVE_STATUS.SAVED, plan: result.plan }
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
    // A restore's changes are counted by the fields it changes, the assumptions one of them.
    const take = (stored: StoredPlan): Result.Result<PlanTaken, PlanNotSaved> =>
      archived(stored)
        ? Result.fail(ARCHIVED_RESULT)
        : Result.succeed({
            content: content.value,
            changes: changedFields(contentOf(stored), content.value).length,
          });
    const saved = yield* savedUnderLock(
      binding,
      { actor: PLAN_ACTOR.DEVELOPER, restoredFrom: seq },
      take,
    );
    return saved.status === PLAN_SAVE_STATUS.SAVED
      ? { status: saved.status, plan: saved.plan }
      : saved;
  });
  return reachedStore(restored);
}
