import { SqlClient, SqlSchema } from "@effect/sql";
import { Effect, Option, Schema } from "effect";
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
 * per account, advanced only past a cursor the provider itself handed back.
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
}

export interface HostedTranscriptReads {
  /** The whole tail, as the tool answers it: the provider's result, whatever its status. */
  whole(identity: SessionIdentity): Promise<WireRecord>;
  /** What the session gained since the cursor kept for it; nothing for a session no observation turn reads. Keeps no bookmark. */
  since(identity: SessionIdentity): Promise<TranscriptDeltaReading | undefined>;
  /** Advances the bookmark a reading reached, once the turn that read it was accepted; a refused turn keeps the old one. */
  keep(identity: SessionIdentity, cursor: string): Promise<void>;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const CursorKeySchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
});

const CursorWriteSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
  cursor: Schema.String,
  updatedAt: Schema.DateFromSelf,
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

const upsertCursor = SqlSchema.void({
  Request: CursorWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into provider_cursors (user_id, provider_id, provider_session_id, cursor, updated_at)
        values (${write.userId}, ${write.providerId}, ${write.providerSessionId}, ${write.cursor}, ${write.updatedAt})
        on conflict (user_id, provider_id, provider_session_id) do update
          set cursor = excluded.cursor, updated_at = excluded.updated_at
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
  const keepCursor = (identity: SessionIdentity, cursor: string): Promise<void> =>
    seams.run(
      upsertCursor({
        userId: seams.userId,
        providerId: identity.providerId,
        providerSessionId: identity.providerSessionId,
        cursor,
        updatedAt: new Date(seams.now()),
      }),
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
      const read = await dispatchRead(
        seams.pluginFor(identity.providerId),
        "transcriptSince",
        identity.providerSessionId,
        await cursorFor(identity),
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
      };
    },
    keep: keepCursor,
  };
}
