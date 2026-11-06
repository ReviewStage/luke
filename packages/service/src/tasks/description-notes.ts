import type { DatabaseServices } from "@repo/database/core/query";
import {
  moveDescriptionCommentAnchors,
  type ReportedAnchors,
} from "@repo/database/models/description-comments";
import {
  type DescriptionWriter,
  readRevisionContent,
  recordRevision,
} from "@repo/database/models/description-revisions";
import {
  readTaskForUpdate,
  type StoredTask,
  saveDescriptionText,
} from "@repo/database/models/task-store";
import { changedSections } from "@repo/features/description-document";
import { applyDocumentEdit, type DescriptionEditRequest } from "@repo/features/description-edit";
import {
  applyNotesToText,
  type DescriptionAgentEdit,
  type DescriptionNote,
  withAgentEdit,
} from "@repo/features/description-notes";
import {
  DESCRIPTION_ACTOR,
  type DescriptionDocument,
  type DescriptionLastEdit,
  type DescriptionSectionEdit,
  TASK_BOUNDS,
  type Task,
} from "@repo/features/task-wire";
import { Clock, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";

/**
 * description-notes.ts -- the description's one write: take an agent's notes, the developer's edit of the text, or their restore of a revision, into a description and read back what was saved.
 *
 * A description is one Markdown text (`@repo/features/description-document`). Its caller
 * is a coding agent's `edit_description` (`coder-host/description-edit.ts`), whose model
 * answers with
 * notes (`@repo/features/description-notes`): a point added under a heading, a
 * phrase corrected, a line struck, or a section struck or moved, anywhere in
 * the text, its headings among it. They are taken in order over the text as
 * it stands under the description's lock, and taken whole or not at all: a note that
 * names a phrase or a heading the text does not hold exactly once, the
 * developer having rewritten it meanwhile among the reasons, answers as a
 * conflict with the text as it stands and nothing saved, so a restructure
 * never lands half; a text past the description's bound is refused before anything
 * is written. Every save names its writer, the
 * notetaker on its call, a coding agent, or the developer, and a save that
 * changed the text is kept as a revision under that writer
 * (`description-revisions.ts`), in the same transaction, so the description and its history
 * never disagree. A coding agent's save that took any note is also written
 * into the task's journal with the notes as taken, which is what the brain
 * is told of what each agent changed. Who last changed each section,
 * which tells the brain and the notetaker the sections the developer
 * wrote, is read back off those revisions. The developer's edit is the
 * same save with their text in place of notes, laid over what the text holds
 * now where we wrote meanwhile, or answered as a conflict with nothing
 * saved (`@repo/features/description-edit`). Their restore of one of the description's
 * revisions is the same save with the revision's text, kept as a revision of
 * the developer's that names the one it brought back.
 *
 * Note that the notes are the description's content and nothing else. Which account
 * they land as is the binding the service built from the authenticated
 * session, never a field the model supplies. The task is the one the
 * service opened, or, for a coding agent, the one its call names, which the
 * door holds to the agent's own workspace; either way the store reads and
 * writes only a task that account reaches, so naming one widens nothing past
 * what the member may edit by hand. The task is read and saved under its row's lock, so two saves of
 * one task take each other's words into account rather than crossing. The
 * save is `saveDescriptionText`'s single update over the row that stands, so a task
 * deleted meanwhile answers as gone and is not written back into being, and
 * a save that fails answers as not saved with the prior text standing. Every
 * outcome is a result, never a failure: an unsaved change leaves the
 * notetaker's lines for its next run, over the text as it then stands, and a
 * coding agent retries from the text its conflict answered.
 */

/** The account and task a task call writes, as the service bound them. */
export interface DescriptionDocumentBinding {
  readonly userId: string;
  readonly taskId: string;
}

/** Who took the notes where it was a coding agent: its row's id, which the service read and the model never names. */
export interface DescriptionNoteAuthor {
  readonly agentId: string;
}

export const DESCRIPTION_SAVE_STATUS = {
  SAVED: "saved",
  /** The developer's edit, or a batch of notes, no longer lands in the text as it stands; nothing was saved. */
  CONFLICT: "conflict",
  NOT_SAVED: "not-saved",
} as const;

/** Why notes, an edit, or a restore saved nothing. */
export const DESCRIPTION_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the description is longer than a description may be.",
  NO_TASK: "Not saved: this task no longer exists.",
  NO_REVISION: "Not saved: this description has no such revision.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type DescriptionSaveResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      /** The document exactly as it now stands saved. */
      readonly document: DescriptionDocument;
      /** Epoch milliseconds of the save. */
      readonly savedAt: number;
      /** Whether the notes changed the description's words, which is when the save is a revision of its writer's. */
      readonly moved: boolean;
      /** The save that last changed each section, this one among them. */
      readonly sectionEdits: readonly DescriptionSectionEdit[];
    }
  | NotesConflict
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.NOT_SAVED;
      readonly reason: string;
    };

/** A batch of notes one of which no longer lands in the text as it stands: that note, and the text; nothing was saved. */
interface NotesConflict {
  readonly status: typeof DESCRIPTION_SAVE_STATUS.CONFLICT;
  readonly current: string;
  readonly missed: DescriptionNote;
}

/** A save that saved nothing, and why. */
type DescriptionNotSaved = Extract<
  DescriptionSaveResult,
  { status: typeof DESCRIPTION_SAVE_STATUS.NOT_SAVED }
>;

const NO_TASK_RESULT: DescriptionNotSaved = {
  status: DESCRIPTION_SAVE_STATUS.NOT_SAVED,
  reason: DESCRIPTION_SAVE_REFUSAL.NO_TASK,
};

const TOO_LONG_RESULT: DescriptionNotSaved = {
  status: DESCRIPTION_SAVE_STATUS.NOT_SAVED,
  reason: DESCRIPTION_SAVE_REFUSAL.TOO_LONG,
};

/** What a change made of the description's text under its lock: the text to save, how many changes it made, the agents' journal where it moved, and where the developer's editor reported its comment anchors. */
interface TextTaken {
  readonly text: string;
  readonly changes: number;
  readonly agentEdits?: readonly DescriptionAgentEdit[];
  readonly anchors?: ReportedAnchors;
}

/** One save under the task's lock, answered: the description as saved with what the change took, or why nothing was saved. */
type LockedSave<T> =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      readonly taken: T;
      /** Whether the change moved the description's words, which is when the save is a revision. */
      readonly moved: boolean;
      /** The transaction the revision was written in, where the save is one, which a reader following the history waits for. */
      readonly txid: string | undefined;
    }
  | DescriptionNotSaved;

/** A developer's edit that no longer lands in the text as it stands, with what the text holds and who last wrote it; nothing was saved. */
interface DescriptionConflict {
  readonly status: typeof DESCRIPTION_SAVE_STATUS.CONFLICT;
  readonly current: string;
  /** Who wrote the text the edit met (`conflictWriter`); none for a description nobody has written. */
  readonly by?: DescriptionLastEdit;
}

/**
 * The description read under its row's lock, the change taken into its text, read
 * under the same lock where it reads more of the description, and saved, all in one
 * transaction. A text past the description's bound is refused. A
 * change that moved the text is kept as a revision under its writer, which
 * names the writer as the last of each section it moved; one that moved
 * nothing saves the text as it stood. Every comment thread's anchor is
 * carried over the change in the same transaction, or set where the
 * developer's editor reported it, so a thread never stands on words the text
 * no longer holds there (`@repo/database/models/description-comments`). A change
 * that refuses the description as it found it answers its refusal, and nothing is
 * saved.
 */
function savedUnderLock<T extends TextTaken, F>(
  binding: DescriptionDocumentBinding,
  writer: DescriptionWriter,
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
    let txid: string | undefined;
    if (moved) {
      txid = yield* recordRevision({
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
      yield* moveDescriptionCommentAnchors(binding.taskId, before, after, taken.anchors);
    }
    const saved = yield* saveDescriptionText(
      binding.userId,
      binding.taskId,
      after,
      taken.agentEdits === undefined ? {} : { agentEdits: taken.agentEdits },
    );
    if (Option.isNone(saved)) return NO_TASK_RESULT;
    // A member's own edit is counted, from the window or an outside agent alike; a restore is none.
    if (writer.actor === DESCRIPTION_ACTOR.DEVELOPER && writer.restoredFrom === undefined) {
      const workspaceId = saved.value.workspaceId;
      yield* recordServerEvent(
        SERVER_EVENT.DESCRIPTION_EDIT,
        { userId: binding.userId, workspaceId },
        {},
      );
    }
    return { status: DESCRIPTION_SAVE_STATUS.SAVED, task: saved.value, taken, moved, txid };
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

/** A save's failure logged and answered as the store being out of reach, so every outcome is a result. */
function reachedStore<A>(
  save: Effect.Effect<A, StoreFailure, DatabaseServices>,
): Effect.Effect<A | DescriptionNotSaved, never, DatabaseServices> {
  return save.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed<DescriptionNotSaved>({
        status: DESCRIPTION_SAVE_STATUS.NOT_SAVED,
        reason: DESCRIPTION_SAVE_REFUSAL.UNAVAILABLE,
      }),
    ),
  );
}

/** The notetaker off any call: a writer a test, or a run with no call to name, saves as. */
const NOTETAKER: DescriptionWriter = { actor: DESCRIPTION_ACTOR.NOTETAKER };

/** The developer, as the writer of every edit the window sends. */
const DEVELOPER: DescriptionWriter = { actor: DESCRIPTION_ACTOR.DEVELOPER };

/** Notes already read under the notes' schema, taken into the description the service bound, kept as a revision under their writer, the notetaker where none is named. */
export function saveNotes(
  binding: DescriptionDocumentBinding,
  notes: readonly DescriptionNote[],
  writer: DescriptionWriter = NOTETAKER,
): Effect.Effect<DescriptionSaveResult, never, DatabaseServices> {
  const take = (stored: StoredTask, now: number) =>
    Effect.sync((): Result.Result<TextTaken, NotesConflict> => {
      const noted = applyNotesToText(stored.text, notes);
      if (noted.missed !== undefined) {
        return Result.fail({
          status: DESCRIPTION_SAVE_STATUS.CONFLICT,
          current: stored.text,
          missed: noted.missed,
        });
      }
      // An agent's save is journaled with its notes; one that took none changed nothing to journal.
      const journaled =
        writer.actor === DESCRIPTION_ACTOR.AGENT && notes.length > 0
          ? {
              agentEdits: withAgentEdit(stored.agentEdits, {
                agentId: writer.agentId,
                at: now,
                notes,
              }),
            }
          : undefined;
      return Result.succeed({ text: noted.text, changes: notes.length, ...journaled });
    });
  const saved = Effect.map(
    savedUnderLock(binding, writer, take),
    (result): DescriptionSaveResult => {
      if (result.status !== DESCRIPTION_SAVE_STATUS.SAVED) return result;
      const { task } = result;
      return {
        status: DESCRIPTION_SAVE_STATUS.SAVED,
        document: task.document,
        sectionEdits: task.sectionEdits ?? [],
        savedAt: task.updatedAt,
        moved: result.moved,
      };
    },
  );
  return reachedStore(saved);
}

/** What the developer's edit answers: the description as saved, the text as it stands where the edit conflicts with it, or why nothing was saved. */
export type DescriptionEditSaveResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      /** The transaction the edit's revision was written in; none where it moved no text. */
      readonly txid: string | undefined;
    }
  | DescriptionConflict
  | DescriptionNotSaved;

/**
 * Who wrote the text a developer's edit met: whoever last changed a section
 * both the edit and the text since its base changed, the newest of them,
 * as the description read under the save's lock names each section's writer; the
 * description's last edit where no such section names one, as where the edit
 * cleared the text or the sections were renamed meanwhile.
 */
function conflictWriter(
  stored: StoredTask,
  edit: DescriptionEditRequest,
  current: string,
): DescriptionLastEdit | undefined {
  const { base, value } = edit.document;
  const mine = new Set(changedSections(base, value));
  const contested = new Set(changedSections(base, current).filter((heading) => mine.has(heading)));
  const writers = (stored.task.sectionEdits ?? []).filter(({ section }) => contested.has(section));
  const newest = writers.reduce<(typeof writers)[number] | undefined>(
    (latest, each) => (latest === undefined || each.at > latest.at ? each : latest),
    undefined,
  );
  if (newest === undefined) return stored.task.lastEdit;
  const { section: _section, ...by } = newest;
  return by;
}

/**
 * The developer's edit of the whole text, taken into the text as it stands,
 * or the conflict it meets, naming who wrote the text it met.
 */
function takeDocumentEdit(
  stored: StoredTask,
  edit: DescriptionEditRequest,
): Result.Result<TextTaken, DescriptionConflict> {
  const outcome = applyDocumentEdit(stored.text, edit);
  if ("conflict" in outcome) {
    const { current } = outcome.conflict;
    const by = conflictWriter(stored, edit, current);
    const status = DESCRIPTION_SAVE_STATUS.CONFLICT;
    return Result.fail(by === undefined ? { status, current } : { status, current, by });
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
 * The developer's own edit of the description's whole text, taken into the description the
 * service bound under its lock and kept as a revision of theirs: set where
 * the text still holds the edit's base, the developer's change laid over it
 * where another writer wrote meanwhile, and a conflict naming that writer,
 * with nothing saved, where it cannot be (`@repo/features/description-edit`).
 */
export function saveDeveloperEdit(
  binding: DescriptionDocumentBinding,
  edit: DescriptionEditRequest,
): Effect.Effect<DescriptionEditSaveResult, never, DatabaseServices> {
  const take = (stored: StoredTask) =>
    Effect.succeed<Result.Result<TextTaken, DescriptionConflict | DescriptionNotSaved>>(
      takeDocumentEdit(stored, edit),
    );
  const saved = Effect.map(
    savedUnderLock(binding, DEVELOPER, take),
    (result): DescriptionEditSaveResult =>
      result.status === DESCRIPTION_SAVE_STATUS.SAVED
        ? { status: DESCRIPTION_SAVE_STATUS.SAVED, task: result.task, txid: result.txid }
        : result,
  );
  return reachedStore(saved);
}

/** A restore answered: the description as it now stands saved, or why it was not. */
export type TaskRestoreResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      /** The transaction the restore's revision was written in; none where it changed nothing. */
      readonly txid: string | undefined;
    }
  | DescriptionNotSaved;

/**
 * The developer's restore of one of the description's revisions: the description's text put
 * back as the revision held it, through the same locked save as notes, and
 * kept as a revision of the developer's naming the one it restored, so the
 * text it replaced stays in the history to restore in turn. A revision that
 * holds what the description holds now saves nothing new and answers the description as it
 * stands. Note that a restore's changes are counted by the sections it
 * changes.
 */
export function restoreRevision(
  binding: DescriptionDocumentBinding,
  seq: number,
): Effect.Effect<TaskRestoreResult, never, DatabaseServices> {
  const restored = Effect.gen(function* (): Effect.fn.Return<
    TaskRestoreResult,
    StoreFailure,
    DatabaseServices
  > {
    const content = yield* readRevisionContent(binding.userId, binding.taskId, seq);
    if (Option.isNone(content)) {
      return {
        status: DESCRIPTION_SAVE_STATUS.NOT_SAVED,
        reason: DESCRIPTION_SAVE_REFUSAL.NO_REVISION,
      } as const;
    }
    const text = content.value;
    const take = (stored: StoredTask) =>
      Effect.succeed<Result.Result<TextTaken, DescriptionNotSaved>>(
        Result.succeed({ text, changes: changedSections(stored.text, text).length }),
      );
    const saved = yield* savedUnderLock(
      binding,
      { actor: DESCRIPTION_ACTOR.DEVELOPER, restoredFrom: seq },
      take,
    );
    return saved.status === DESCRIPTION_SAVE_STATUS.SAVED
      ? { status: saved.status, task: saved.task, txid: saved.txid }
      : saved;
  });
  return reachedStore(restored);
}
