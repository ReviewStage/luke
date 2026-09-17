import { serialQueue } from "@sidecar/runtime/effect";
import type { LiveRecord, SpokenAskAttach } from "@sidecar/voice/live-session";
import { Deferred, Effect, Result, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  STORE_WRITE_EFFECT,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
} from "../hosted/store/index.js";
import type { LiveServerEvent } from "../live.js";

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
 * record is the service's attach, handing over the developer's rows the
 * delegation is about as its ledger holds them, each written as it stands
 * and then given the delegation in one turn at the writer, so the attach
 * finds every row with its last word on it and a closing session drains the
 * two together. The rows take the delegation in place, their ids the
 * ledger's still. The service makes that attach for every delegated ask and awaits it
 * ahead of the reply, so it answers true only when a row of the ask stands on
 * record under the delegation, and the service speaks no reply to an ask the
 * record refused. The store's own rule that a row already a delegation's is
 * left as it is makes a repeated attach the same rows.
 *
 * Every face here answers an effect and none of them runs one: the write
 * itself is made on the scoped fiber below, under the `SqlClient` the
 * socket's scope was built on, and what a caller is handed is the wait on
 * that write's own `Deferred`.
 */

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

/** What the caller that handed a write over is waiting on. */
type Landed = Deferred.Deferred<VoiceWriteResult, SqlError | Schema.SchemaError>;

export function hostedLiveRecord({
  writer,
  target,
}: HostedLiveRecordOptions): Effect.Effect<
  HostedLiveRecord,
  never,
  Scope.Scope | SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    // Every end of a write, its death included, is the exit its deferred is
    // settled with, so the queue itself is handed nothing to catch.
    const waiting = yield* serialQueue<SqlClient.SqlClient>({
      onDefect: (cause) => Effect.logError("a live record write could not be settled", cause),
    });
    let last: Landed | undefined;

    /**
     * Every write of one session takes its turn, so a segment's place in the
     * sequence is its arrival: the write is put on the queue where it is
     * called for, and the effect handed back is the wait on that write alone.
     */
    function enqueue(write: Write): Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError> {
      const landed = Deferred.makeUnsafe<VoiceWriteResult, SqlError | Schema.SchemaError>();
      last = landed;
      waiting.offerUnsafe(
        Effect.flatMap(Effect.exit(write), (written) =>
          Effect.asVoid(Deferred.done(landed, written)),
        ),
      );
      return Deferred.await(landed);
    }

    /** Whether the record took an utterance: landed, found standing, or owed nothing; a refusal or a failure is not taken. */
    const taken = (write: Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>) =>
      write.pipe(
        Effect.map(Result.isSuccess),
        Effect.catch(() => Effect.succeed(false)),
        Effect.catchDefect(() => Effect.succeed(false)),
      );

    /** The row as the service names it, written or grown from the segments on record over its span. */
    const upsert = (row: SpokenAskAttach["rows"][number]): Write =>
      writer.upsertSpokenRow(target, {
        rowId: row.rowId,
        speaker: row.speaker,
        startMs: row.startMs,
        endMs: row.endMs,
      });

    return {
      observe: (event) => enqueue(writer.consume(target, event)),
      upsertSpokenRow: (row) => taken(enqueue(upsert(row))),
      attachSpokenAsk: (attach) =>
        // The rows are written as the service holds them and then given the
        // delegation, as one turn at the writer on one queue entry, so the
        // drain a closing session waits on covers the attach with the writes.
        // An attach that found no row is an ask not on record, as are one the
        // store refused and one it died on; an interruption is neither, and
        // is the socket's scope closing under the wait.
        enqueue(
          Effect.flatMap(Effect.forEach(attach.rows, upsert, { discard: true }), () =>
            writer.attachSpokenAsk(target, {
              delegationId: attach.delegationId,
              rowIds: attach.rows.map((row) => row.rowId),
            }),
          ),
        ).pipe(
          Effect.map(
            (attached) =>
              Result.isSuccess(attached) && attached.success !== STORE_WRITE_EFFECT.IGNORED,
          ),
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
