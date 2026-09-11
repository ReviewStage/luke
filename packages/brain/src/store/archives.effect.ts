/**
 * The recoverable deletion's failing surface in Effect's own terms.
 * `archives.ts` is a port in shape of OpenClaw `b7528507`'s session archive
 * and imports nothing from `effect`, so its Effect surface lives here:
 * `deleteConversation` and `removeArchive` each answer `undefined`/`false`
 * where they refuse rather than throwing, restated as typed refusals
 * carrying the code the caller already had to infer from the missing value,
 * and `publishPendingArchives` restated as an effect with no failure of its
 * own, since a publication that could not land is reported in its answer
 * rather than thrown.
 */
import type { SessionKey } from "@sidecar/runtime/vocabulary";
import { Data, Effect } from "effect";
import {
  type DeletionOptions,
  type DeletionOutcome,
  deleteConversation,
  publishPendingArchives,
  removeArchive,
} from "./archives.js";
import type { StoreDatabase } from "./database.js";

/** Why an archive operation named nothing the store could act on. */
export const ARCHIVE_REFUSAL = {
  /** No conversation stands at that session key. */
  CONVERSATION_NOT_FOUND: "conversation-not-found",
  /** No archive is registered at that id. */
  ARCHIVE_NOT_FOUND: "archive-not-found",
} as const;

export type ArchiveRefusal = (typeof ARCHIVE_REFUSAL)[keyof typeof ARCHIVE_REFUSAL];

export class ArchiveOperationRefused extends Data.TaggedError("ArchiveOperationRefused")<{
  readonly code: ArchiveRefusal;
}> {}

/** The recoverable deletion; fails when no conversation stands at that session key. */
export const deleteConversationEffect = (
  database: StoreDatabase,
  agentRoot: string,
  sessionKey: SessionKey,
  now: number,
  options?: DeletionOptions,
): Effect.Effect<DeletionOutcome, ArchiveOperationRefused> =>
  Effect.suspend(() => {
    const outcome = deleteConversation(database, agentRoot, sessionKey, now, options);
    return outcome
      ? Effect.succeed(outcome)
      : Effect.fail(new ArchiveOperationRefused({ code: ARCHIVE_REFUSAL.CONVERSATION_NOT_FOUND }));
  });

/** Forgets one archive's registry row and its file; fails when no archive is registered at that id. */
export const removeArchiveEffect = (
  database: StoreDatabase,
  agentRoot: string,
  archiveId: string,
): Effect.Effect<void, ArchiveOperationRefused> =>
  Effect.suspend(() => {
    const removed = removeArchive(database, agentRoot, archiveId);
    return removed
      ? Effect.void
      : Effect.fail(new ArchiveOperationRefused({ code: ARCHIVE_REFUSAL.ARCHIVE_NOT_FOUND }));
  });

/** Retries every publication a crash interrupted; answers the ids still unpublished. */
export const publishPendingArchivesEffect = (
  database: StoreDatabase,
  agentRoot: string,
): Effect.Effect<readonly string[]> =>
  Effect.sync(() => publishPendingArchives(database, agentRoot));
