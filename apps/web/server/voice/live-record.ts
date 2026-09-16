import type { LiveRecord } from "@sidecar/voice/live-session";
import { Deferred, Effect, Queue, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  STORE_WRITE_EFFECT,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
} from "../hosted/store/index.js";
import { type LiveServerEvent, TRANSCRIPT_SPEAKER } from "../live.js";

/**
 * The hosted implementation of the live record: the voice writer over
 * Postgres, which keeps the plan's split — every transcript delta a segment,
 * and each speaker's utterance a row of its own, the developer's a user row
 * and Luke's an assistant row, upserted under the id the service's ledger
 * minted and grown as its fragments arrive, its words read from the segments
 * over the span the ledger holds it at, so the Conversation keeps what was
 * said whether or not the brain was consulted. The service hands every
 * server event here in arrival order and the writer takes what it keeps of
 * each; the upserts are answered on the same queue, after every delta that
 * arrived ahead of the write has taken its place, so a row is read from
 * segments already on record and never from a grouping the service kept
 * beside them.
 *
 * A delegation cuts nothing. The stream's own delegation event is consumed
 * like any other and the writer keeps nothing of it; what puts an ask on
 * record is the service's write for the developer's utterance under the
 * delegation, which the record answers by writing the row as the ledger
 * holds it then — so a last fragment the API delivered after the delegation
 * is on the row — and attaching that row to the delegation in place, its id
 * the ledger's still. The service makes that write for every delegated ask
 * and awaits it ahead of the reply, so the write answers true only when a
 * row of the ask stands on record under the delegation, and the service
 * speaks no reply to an ask the record refused. The store's own rule that a
 * row already a delegation's is left as it is makes a repeated write the
 * same rows.
 *
 * Every face here answers an effect and none of them runs one: the write
 * itself is made on the scoped fiber below, under the `SqlClient` the
 * socket's scope was built on, and what a caller is handed is the wait on
 * that write's own `Deferred`.
 */

/** One row as the service names it to the record. */
type SpokenRowUpsert = Parameters<LiveRecord["upsertSpokenRow"]>[0];

interface HostedLiveRecordOptions {
  readonly writer: VoiceWriter;
  readonly target: VoiceTarget;
}

interface HostedLiveRecord extends LiveRecord {
  /** One server event of the session's stream, in arrival order; answers what the writer did with it. */
  observe(event: LiveServerEvent): Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>;
  /** Settles once every write started so far has landed or failed; a caller closing the session waits on it so no write is cut. */
  drained(): Effect.Effect<void>;
}

type Write = Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** One write waiting its turn at the writer, and what the caller that handed it over is waiting on. */
interface PendingWrite {
  readonly write: Write;
  readonly landed: Deferred.Deferred<VoiceWriteResult, SqlError | Schema.SchemaError>;
}

export function hostedLiveRecord({
  writer,
  target,
}: HostedLiveRecordOptions): Effect.Effect<
  HostedLiveRecord,
  never,
  Scope.Scope | SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const waiting = yield* Queue.unbounded<PendingWrite>();
    let last: PendingWrite["landed"] | undefined;

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(waiting), (pending) =>
          Effect.flatMap(Effect.exit(pending.write), (written) =>
            Deferred.done(pending.landed, written),
          ),
        ),
      ),
    );

    /**
     * Every write of one session takes its turn, so a segment's place in the
     * sequence is its arrival: the write is put on the queue where it is
     * called for, and the effect handed back is the wait on that write alone.
     */
    function enqueue(write: Write): Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError> {
      const landed = Deferred.makeUnsafe<VoiceWriteResult, SqlError | Schema.SchemaError>();
      last = landed;
      Queue.offerUnsafe(waiting, { write, landed });
      return Deferred.await(landed);
    }

    /** Whether the record took an utterance: landed, found standing, or owed nothing; a refusal or a failure is not taken. */
    const taken = (write: Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>) =>
      write.pipe(
        Effect.map((written) => written.ok),
        Effect.catch(() => Effect.succeed(false)),
        Effect.catchDefect(() => Effect.succeed(false)),
      );

    /** The row as the service names it, written or grown from the segments on record over its span. */
    const upsert = (row: SpokenRowUpsert): Write =>
      writer.upsertSpokenRow(target, {
        rowId: row.rowId,
        speaker: row.speaker,
        startMs: row.startMs,
        endMs: row.endMs,
      });

    return {
      observe: (event) => enqueue(writer.consume(target, event)),
      upsertSpokenRow: (row) => taken(enqueue(upsert(row))),
      writeDeveloperUtterance: (record) =>
        // The row is written as the ledger holds it now and then given the
        // delegation, as one turn at the writer: one entry on the queue, so
        // the drain a closing session waits on covers the attach with the
        // write, and a close between the two cannot leave the row written
        // and never the delegation's. A write the store refused and one it
        // died on are both an ask not on record; an interruption is neither,
        // and is the socket's scope closing under the wait.
        enqueue(
          Effect.flatMap(
            upsert({
              rowId: record.rowId,
              speaker: TRANSCRIPT_SPEAKER.USER,
              voiceSessionId: record.voiceSessionId,
              startMs: record.startMs,
              endMs: record.endMs,
            }),
            (written) =>
              written.ok
                ? writer.attachSpokenAsk(target, {
                    delegationId: record.delegationId,
                    rowIds: [record.rowId],
                  })
                : Effect.succeed(written),
          ),
        ).pipe(
          Effect.map((attached) => attached.ok && attached.effect !== STORE_WRITE_EFFECT.IGNORED),
          Effect.catch(() => Effect.succeed(false)),
          Effect.catchDefect(() => Effect.succeed(false)),
        ),
      drained: () =>
        Effect.suspend(() =>
          last === undefined ? Effect.void : Effect.ignore(Deferred.await(last)),
        ),
    };
  });
}
