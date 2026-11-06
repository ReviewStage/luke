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

export interface DescriptionDocumentBinding {
  readonly userId: string;
  readonly taskId: string;
}

export interface DescriptionNoteAuthor {
  readonly agentId: string;
}

export const DESCRIPTION_SAVE_STATUS = {
  SAVED: "saved",
  CONFLICT: "conflict",
  NOT_SAVED: "not-saved",
} as const;

export const DESCRIPTION_SAVE_REFUSAL = {
  TOO_LONG: "Not saved: the description is longer than a description may be.",
  NO_TASK: "Not saved: this task no longer exists.",
  NO_REVISION: "Not saved: this description has no such revision.",
  UNAVAILABLE: "Not saved: the service could not reach its store.",
} as const;

export type DescriptionSaveResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly document: DescriptionDocument;
      readonly savedAt: number;
      readonly moved: boolean;
      readonly sectionEdits: readonly DescriptionSectionEdit[];
    }
  | NotesConflict
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.NOT_SAVED;
      readonly reason: string;
    };

interface NotesConflict {
  readonly status: typeof DESCRIPTION_SAVE_STATUS.CONFLICT;
  readonly current: string;
  readonly missed: DescriptionNote;
}

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

interface TextTaken {
  readonly text: string;
  readonly changes: number;
  readonly agentEdits?: readonly DescriptionAgentEdit[];
  readonly anchors?: ReportedAnchors;
}

type LockedSave<T> =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      readonly taken: T;
      readonly moved: boolean;
      readonly txid: string | undefined;
    }
  | DescriptionNotSaved;

interface DescriptionConflict {
  readonly status: typeof DESCRIPTION_SAVE_STATUS.CONFLICT;
  readonly current: string;
  readonly by?: DescriptionLastEdit;
}

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

const NOTETAKER: DescriptionWriter = { actor: DESCRIPTION_ACTOR.NOTETAKER };

const DEVELOPER: DescriptionWriter = { actor: DESCRIPTION_ACTOR.DEVELOPER };

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

export type DescriptionEditSaveResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      readonly txid: string | undefined;
    }
  | DescriptionConflict
  | DescriptionNotSaved;

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

export type TaskRestoreResult =
  | {
      readonly status: typeof DESCRIPTION_SAVE_STATUS.SAVED;
      readonly task: Task;
      readonly txid: string | undefined;
    }
  | DescriptionNotSaved;

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
