import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type BrainTranscriptDelta,
  type CloudAgentProviderId,
  dispatchRead,
  isCloudAgentProviderId,
  type SessionIdentity,
  type SessionProviderPlugin,
  type WireRecord,
} from "../../core.js";
import type { HostedStoreRun } from "../store/database.js";
import { BRAIN_HOST } from "./bounds.js";
import { type HostedRoster, observedSession } from "./roster.js";

/**
 * The brain's two transcript reads of a cloud chat, through the provider's
 * own documented reader and never through a pass: the whole tail, at the
 * `read_transcript` tool's ask, and what a chat gained since the host last
 * looked, for an observation turn. Both answer only for a session the stored
 * roster holds, and only for a provider this build reads. The incremental
 * read keeps its bookmark in `provider_cursors`, one row per observed session
 * per account, advanced only past a cursor the provider itself handed back,
 * and only over the bookmark the read began from.
 */

export interface TranscriptReadSeams {
  /** The runner the cursor's own reads and writes are answered through. */
  readonly run: HostedStoreRun;
  readonly userId: string;
  /** The roster as the snapshot holds it now, read again for every read. */
  readonly roster: () => Promise<HostedRoster>;
  /** The provider's plugin over the account's own key, built once per provider per host. */
  readonly pluginFor: (providerId: CloudAgentProviderId) => SessionProviderPlugin;
  readonly now: () => number;
}

/** One incremental reading and the bookmark it reached, kept only once the turn that carries it is accepted. */
interface TranscriptDeltaReading {
  readonly delta: BrainTranscriptDelta;
  /** The cursor the provider handed back, to keep once the words reached a turn; absent when the read moved nothing. */
  readonly cursor?: string;
  /** The bookmark the read began from, which a keep must still find standing; absent where none was kept yet. */
  readonly from?: string;
}

export interface HostedTranscriptReads {
  /** The whole tail, as the tool answers it: the provider's result, whatever its status. */
  whole(identity: SessionIdentity): Promise<WireRecord>;
  /** What the session gained since the cursor kept for it; nothing for a session no observation turn reads. Keeps no bookmark. */
  since(identity: SessionIdentity): Promise<TranscriptDeltaReading | undefined>;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const CursorKeySchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
});

const CursorRowSchema = Schema.Struct({ cursor: Schema.String });

const findCursor = SqlSchema.findOne({
  Request: CursorKeySchema,
  Result: CursorRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select cursor
        from provider_cursors
        where user_id = ${key.userId}
          and provider_id = ${key.providerId}
          and provider_session_id = ${key.providerSessionId}
      `,
    ),
});

const NOT_OBSERVED = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "No observed session matches that identity.",
} as const;

const NOT_CLOUD = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "That session's provider is not one the service reads.",
} as const;

const CursorKeepSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
  cursor: Schema.String,
  /** The bookmark the read began from; null where none was kept, which lets the insert land only where none has been kept since. */
  from: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

/**
 * The upsert as one statement: a new row lands where none stands, and a
 * standing row moves only while it still holds the bookmark the read began
 * from — a null `from` compares to nothing, so a read that began from no
 * bookmark moves no row another reader has since kept.
 */
const keepCursorRow = SqlSchema.void({
  Request: CursorKeepSchema,
  execute: (write) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        insert into provider_cursors (user_id, provider_id, provider_session_id, cursor, updated_at)
        values (${write.userId}, ${write.providerId}, ${write.providerSessionId}, ${write.cursor}, ${write.updatedAt}::timestamptz)
        on conflict (user_id, provider_id, provider_session_id) do update
          set cursor = excluded.cursor, updated_at = excluded.updated_at
          where provider_cursors.cursor = ${write.from}
      `,
    ),
});

/**
 * Keeps the bookmark a reading reached, as a statement over the ambient
 * client: the opener runs it inside the transaction that consumes the diffs
 * the reading was for, so the two move together or not at all. The keep is a
 * compare-and-set on the bookmark the reading began from: a cursor is
 * opaque, so nothing can say which of two is the later, and a reader that
 * ran long — an opening that outran its tick while the next tick's read went
 * past it — must not put the bookmark back behind a newer one. Where the
 * read began from no bookmark, the keep lands only where none has been kept
 * since. The one writer of the row.
 */
export function keepTranscriptCursor(
  userId: string,
  identity: SessionIdentity,
  cursor: string,
  from: string | undefined,
  now: Date,
): Effect.Effect<void, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return keepCursorRow({
    userId,
    providerId: identity.providerId,
    providerSessionId: identity.providerSessionId,
    cursor,
    from: from ?? null,
    updatedAt: now.toISOString(),
  });
}

export function hostedTranscriptReads(seams: TranscriptReadSeams): HostedTranscriptReads {
  const cursorFor = (identity: SessionIdentity): Promise<string | undefined> =>
    seams.run(
      Effect.map(
        findCursor({
          userId: seams.userId,
          providerId: identity.providerId,
          providerSessionId: identity.providerSessionId,
        }),
        (found) => Option.getOrUndefined(Option.map(found, (row) => row.cursor)),
      ),
    );

  return {
    async whole(identity) {
      if (!observedSession(await seams.roster(), identity)) return NOT_OBSERVED;
      if (!isCloudAgentProviderId(identity.providerId)) return NOT_CLOUD;
      const read = await dispatchRead(
        seams.pluginFor(identity.providerId),
        "transcript",
        identity.providerSessionId,
      );
      const answer: WireRecord =
        read.status === ACTION_RESULT_STATUS.ACCEPTED
          ? { status: read.status, transcript: read.transcript }
          : { status: read.status, reason: read.reason };
      return answer;
    },
    async since(identity) {
      // Any observed chat is read, whatever its status now: the wake that
      // names a chat is most often the one that just finished or failed,
      // and its last words are the ones the turn is opened for.
      if (!observedSession(await seams.roster(), identity)) return undefined;
      if (!isCloudAgentProviderId(identity.providerId)) return undefined;
      const from = await cursorFor(identity);
      const read = await dispatchRead(
        seams.pluginFor(identity.providerId),
        "transcriptSince",
        identity.providerSessionId,
        from,
      );
      if (read.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        return { delta: { text: "", truncated: false, status: read.status } };
      }
      const overflow = Math.max(0, read.text.length - BRAIN_HOST.TRANSCRIPT_DELTA_CHARS);
      return {
        delta: {
          text: read.text.slice(overflow),
          truncated: read.truncated || overflow > 0,
          status: read.status,
        },
        ...(read.cursor !== undefined ? { cursor: read.cursor } : undefined),
        ...(from !== undefined ? { from } : undefined),
      };
    },
  };
}
