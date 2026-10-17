import type { DatabaseServices } from "@luke/database/core/query";
import { movePlanCommentAnchors, type ReportedAnchors } from "@luke/database/models/plan-comments";
import {
  type PlanWriter,
  readRevisionContent,
  recordRevision,
} from "@luke/database/models/plan-revisions";
import {
  readStartedText,
  readTaskForUpdate,
  type StoredTask,
  savePlanText,
} from "@luke/database/models/task-store";
import { changedSections } from "@luke/features/plan-document";
import { applyDocumentEdit, type PlanEditRequest } from "@luke/features/plan-edit";
import {
  applyNotesToText,
  type PlanAgentEdit,
  type PlanNote,
  withAgentEdit,
} from "@luke/features/plan-template";
import {
  PLAN_ACTOR,
  type PlanDocument,
  type PlanSectionEdit,
  TASK_BOUNDS,
  type Task,
} from "@luke/features/task-wire";
import { Clock, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";

/**
 * plan-notes.ts -- the plan's one write: take the notetaker's notes, the developer's edit of the text, or their restore of a revision, into a plan and read back what was saved.
 *
 * A plan is one Markdown text (`@luke/features/plan-document`). Its callers
 * are a planning call's notetaker (`tasks/plan-scribe.ts`) and a coding
 * agent's `edit_plan` (`coder-host/plan-edit.ts`), whose models answer with
 * notes (`@luke/features/plan-template`): a point added under a heading, a
 * phrase corrected, a line struck, or a section struck or moved, anywhere in
 * the text, its headings among it. They are taken in order over the text as
 * it stands under the plan's lock, and taken whole or not at all: a note that
 * names a phrase or a heading the text does not hold exactly once, the
 * developer having rewritten it meanwhile among the reasons, answers as a
 * conflict with the text as it stands and nothing saved, so a restructure
 * never lands half; a text past the plan's bound is refused before anything
 * is written. Every save names its writer, the
 * notetaker on its call, a coding agent, or the developer, and a save that
 * changed the text is kept as a revision under that writer
 * (`plan-revisions.ts`), in the same transaction, so the plan and its history
 * never disagree. A coding agent's save that took any note is also written
 * into the plan's journal with the notes as taken, which is what the planning
 * model is told of what each agent changed. Who last changed each section,
 * which tells the planning model and the notetaker the sections the developer
 * wrote, is read back off those revisions. The developer's edit is the
 * same save with their text in place of notes, laid over what the text holds
 * now where Luke wrote meanwhile, or answered as a conflict with nothing
 * saved (`@luke/features/plan-edit`). Their restore of one of the plan's
 * revisions is the same save with the revision's text, kept as a revision of
 * the developer's that names the one it brought back.
 *
 * Note that the notes are the plan's content and nothing else. Which account
 * and which plan they land in are the binding the service built from the
 * authenticated session and the plan it opened, never a field the model
 * supplies. The plan is read and saved under its row's lock, so two saves of
 * one plan take each other's words into account rather than crossing. The
 * save is `savePlanText`'s single update over the row that stands, so a plan
 * deleted meanwhile answers as gone and is not written back into being, and
 * a save that fails answers as not saved with the prior text standing. Every
 * outcome is a result, never a failure: an unsaved change leaves the
 * notetaker's lines for its next run, over the text as it then stands, and a
 * coding agent retries from the text its conflict answered.
 *
 * An archived plan takes no new edit or restore of the developer's, read
 * under the same lock as the save, so an older desktop or an archive racing
 * the edit cannot write it. The notes of a call already running when the
 * plan was archived, or of a coding agent's turn its archive stopped that eve
 * has yet to end, still land, as revisions in its history: the archive takes
 * no new work, and loses none under way.
 */

/** The account and plan a planning call writes, as the service bound them. */
export interface PlanDocumentBinding {
  readonly userId: string;
  readonly taskId: string;
}

/** Who took the notes where it was a coding agent: its row's id, which the service read and the model never names. */
export interface PlanNoteAuthor {
  readonly agentId: string;
}

export const PLAN_SAVE_STATUS = {
  SAVED: "saved",
  /** The developer's edit, or a batch of notes, no longer lands in the text as it stands; nothing was saved. */
  CONFLICT: "conflict",
  NOT_SAVED: "not-saved",
} as const;

/** Why notes, an edit, or a restore saved nothing. */
export const PLAN_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the plan is longer than a plan may be.",
  NO_TASK: "Not saved: this task no longer exists.",
  NO_REVISION: "Not saved: this plan has no such revision.",
  ARCHIVED: "Not saved: this task is archived.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type PlanSaveResult =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: PlanDocument;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
      /** Whether the notes changed the plan's words, which is when the save is a revision of its writer's. */
      readonly moved: boolean;
      /** The save that last changed each section, this one among them. */
      readonly sectionEdits: readonly PlanSectionEdit[];
    }
  | NotesConflict
  | {
      readonly status: typeof PLAN_SAVE_STATUS.NOT_SAVED;
      readonly reason: string;
    };

/** A batch of notes one of which no longer lands in the text as it stands: that note, and the text; nothing was saved. */
interface NotesConflict {
  readonly status: typeof PLAN_SAVE_STATUS.CONFLICT;
  readonly current: string;
  readonly missed: PlanNote;
}

/** A save that saved nothing, and why. */
type PlanNotSaved = Extract<PlanSaveResult, { status: typeof PLAN_SAVE_STATUS.NOT_SAVED }>;

const NO_TASK_RESULT: PlanNotSaved = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.NO_TASK,
};

const ARCHIVED_RESULT: PlanNotSaved = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.ARCHIVED,
};

const TOO_LONG_RESULT: PlanNotSaved = {
  status: PLAN_SAVE_STATUS.NOT_SAVED,
  reason: PLAN_SAVE_REFUSAL.TOO_LONG,
};

/** Whether the plan as read under its lock is archived, which takes none of the developer's writes. */
function archived(stored: StoredTask): boolean {
  return stored.task.archivedAt !== undefined;
}

/** What a change made of the plan's text under its lock: the text to save, how many changes it made, the agents' journal where it moved, and where the developer's editor reported its comment anchors. */
interface TextTaken {
  readonly text: string;
  readonly changes: number;
  readonly agentEdits?: readonly PlanAgentEdit[];
  readonly anchors?: ReportedAnchors;
}

/** One save under the plan's lock, answered: the plan as saved with what the change took, or why nothing was saved. */
type LockedSave<T> =
  | {
      readonly status: typeof PLAN_SAVE_STATUS.SAVED;
      readonly task: Task;
      readonly taken: T;
      /** Whether the change moved the plan's words, which is when the save is a revision. */
      readonly moved: boolean;
    }
  | PlanNotSaved;

/** A developer's edit that no longer lands in the text as it stands, with what the text holds; nothing was saved. */
interface PlanConflict {
  readonly status: typeof PLAN_SAVE_STATUS.CONFLICT;
  readonly current: string;
}

/**
 * The plan read under its row's lock, the change taken into its text, read
 * under the same lock where it reads more of the plan, and saved, all in one
 * transaction. A text past the plan's bound is refused. A
 * change that moved the text is kept as a revision under its writer, which
 * names the writer as the last of each section it moved; one that moved
 * nothing saves the text as it stood. Every comment thread's anchor is
 * carried over the change in the same transaction, or set where the
 * developer's editor reported it, so a thread never stands on words the text
 * no longer holds there (`@luke/database/models/plan-comments`). A change
 * that refuses the plan as it found it answers its refusal, and nothing is
 * saved.
 */
function savedUnderLock<T extends TextTaken, F>(
  binding: PlanDocumentBinding,
  writer: PlanWriter,
  take: (
    stored: StoredTask,
    now: number,
  ) => Effect.Effect<Result.Result<T, F>, StoreFailure, DatabaseServices>,
): Effect.Effect<LockedSave<T> | F, StoreFailure, DatabaseServices> {
  const locked = Effect.gen(function* (): Effect.fn.Return<
    LockedSave<T> | F,
    StoreFailure,
    DatabaseServices
  > {
    const stored = yield* readTaskForUpdate(binding.userId, binding.taskId);
    if (Option.isNone(stored)) return NO_TASK_RESULT;
    const now = yield* Clock.currentTimeMillis;
    const outcome = yield* take(stored.value, now);
    if (Result.isFailure(outcome)) return outcome.failure;
    const taken = outcome.success;
    const before = stored.value.text;
    const after = taken.text;
    if (after.length > TASK_BOUNDS.MAX_BODY_CHARS) return TOO_LONG_RESULT;
    const moved = after !== before;
    if (moved) {
      yield* recordRevision({
        taskId: binding.taskId,
        writer,
        userId: binding.userId,
        before,
        after,
        changes: taken.changes,
        savedBefore: stored.value.saved
          ? Option.some(new Date(stored.value.task.updatedAt))
          : Option.none(),
      });
    }
    if (moved || taken.anchors !== undefined) {
      yield* movePlanCommentAnchors(binding.taskId, before, after, taken.anchors);
    }
    const saved = yield* savePlanText(
      binding.userId,
      binding.taskId,
      after,
      taken.agentEdits === undefined ? {} : { agentEdits: taken.agentEdits },
    );
    if (Option.isNone(saved)) return NO_TASK_RESULT;
    return { status: PLAN_SAVE_STATUS.SAVED, task: saved.value, taken, moved };
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/** A save's failure logged and answered as the store being out of reach, so every outcome is a result. */
function reachedStore<A>(
  save: Effect.Effect<A, StoreFailure, DatabaseServices>,
): Effect.Effect<A | PlanNotSaved, never, DatabaseServices> {
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
): Effect.Effect<PlanSaveResult, never, DatabaseServices> {
  const take = (stored: StoredTask, now: number) =>
    Effect.map(
      readStartedText(binding.userId, stored.task.createdAt),
      (started): Result.Result<TextTaken, NotesConflict> => {
        const noted = applyNotesToText(stored.text, notes, started);
        if (noted.missed !== undefined) {
          return Result.fail({
            status: PLAN_SAVE_STATUS.CONFLICT,
            current: stored.text,
            missed: noted.missed,
          });
        }
        // An agent's save is journaled with its notes; one that took none changed nothing to journal.
        const journaled =
          writer.actor === PLAN_ACTOR.AGENT && notes.length > 0
            ? {
                agentEdits: withAgentEdit(stored.agentEdits, {
                  agentId: writer.agentId,
                  at: now,
                  notes,
                }),
              }
            : undefined;
        return Result.succeed({ text: noted.text, changes: notes.length, ...journaled });
      },
    );
  const saved = Effect.map(savedUnderLock(binding, writer, take), (result): PlanSaveResult => {
    if (result.status !== PLAN_SAVE_STATUS.SAVED) return result;
    const { task: plan } = result;
    return {
      status: PLAN_SAVE_STATUS.SAVED,
      document: plan.document,
      sectionEdits: plan.sectionEdits ?? [],
      savedAt: plan.updatedAt,
      moved: result.moved,
    };
  });
  return reachedStore(saved);
}

/** What the developer's edit answers: the plan as saved, the text as it stands where the edit conflicts with it, or why nothing was saved. */
export type PlanEditSaveResult =
  | { readonly status: typeof PLAN_SAVE_STATUS.SAVED; readonly task: Task }
  | PlanConflict
  | PlanNotSaved;

/** The developer's edit of the whole text, taken into the text as it stands, or why it is not. */
function takeDocumentEdit(
  stored: StoredTask,
  edit: PlanEditRequest,
): Result.Result<TextTaken, PlanConflict> {
  const outcome = applyDocumentEdit(stored.text, edit);
  if ("conflict" in outcome) {
    return Result.fail({ status: PLAN_SAVE_STATUS.CONFLICT, current: outcome.conflict.current });
  }
  const anchors =
    edit.comments === undefined ? undefined : { text: edit.document.value, anchors: edit.comments };
  return Result.succeed({
    text: outcome.applied,
    changes: 1,
    ...(anchors === undefined ? undefined : { anchors }),
  });
}

/**
 * The developer's own edit of the plan's whole text, taken into the plan the
 * service bound under its lock and kept as a revision of theirs: set where
 * the text still holds the edit's base, the developer's change laid over it
 * where Luke wrote meanwhile, and a conflict, with nothing saved, where it
 * cannot be (`@luke/features/plan-edit`).
 */
export function saveDeveloperEdit(
  binding: PlanDocumentBinding,
  edit: PlanEditRequest,
): Effect.Effect<PlanEditSaveResult, never, DatabaseServices> {
  const take = (stored: StoredTask) =>
    Effect.succeed<Result.Result<TextTaken, PlanConflict | PlanNotSaved>>(
      archived(stored) ? Result.fail(ARCHIVED_RESULT) : takeDocumentEdit(stored, edit),
    );
  const saved = Effect.map(
    savedUnderLock(binding, DEVELOPER, take),
    (result): PlanEditSaveResult =>
      result.status === PLAN_SAVE_STATUS.SAVED
        ? { status: PLAN_SAVE_STATUS.SAVED, task: result.task }
        : result,
  );
  return reachedStore(saved);
}

/** A restore answered: the plan as it now stands saved, or why it was not. */
export type TaskRestoreResult =
  | { readonly status: typeof PLAN_SAVE_STATUS.SAVED; readonly task: Task }
  | PlanNotSaved;

/**
 * The developer's restore of one of the plan's revisions: the plan's text put
 * back as the revision held it, through the same locked save as notes, and
 * kept as a revision of the developer's naming the one it restored, so the
 * text it replaced stays in the history to restore in turn. A revision that
 * holds what the plan holds now saves nothing new and answers the plan as it
 * stands. Note that a restore's changes are counted by the sections it
 * changes.
 */
export function restoreRevision(
  binding: PlanDocumentBinding,
  seq: number,
): Effect.Effect<TaskRestoreResult, never, DatabaseServices> {
  const restored = Effect.gen(function* (): Effect.fn.Return<
    TaskRestoreResult,
    StoreFailure,
    DatabaseServices
  > {
    const content = yield* readRevisionContent(binding.userId, binding.taskId, seq);
    if (Option.isNone(content)) {
      return { status: PLAN_SAVE_STATUS.NOT_SAVED, reason: PLAN_SAVE_REFUSAL.NO_REVISION } as const;
    }
    const text = content.value;
    const take = (stored: StoredTask) =>
      Effect.succeed<Result.Result<TextTaken, PlanNotSaved>>(
        archived(stored)
          ? Result.fail(ARCHIVED_RESULT)
          : Result.succeed({ text, changes: changedSections(stored.text, text).length }),
      );
    const saved = yield* savedUnderLock(
      binding,
      { actor: PLAN_ACTOR.DEVELOPER, restoredFrom: seq },
      take,
    );
    return saved.status === PLAN_SAVE_STATUS.SAVED
      ? { status: saved.status, task: saved.task }
      : saved;
  });
  return reachedStore(restored);
}
