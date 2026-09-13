import type { LiveRecord } from "@sidecar/voice/live-session";
import { Deferred, Effect, Queue, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { CONVERSATION_ENTRY_KIND } from "../core.js";
import {
  STORE_WRITE_EFFECT,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
} from "../hosted/store/index.js";
import { LIVE_SERVER_EVENT, type LiveServerEvent } from "../live.js";

/**
 * The hosted implementation of the live record: the voice writer over
 * Postgres, which keeps the plan's split — every transcript delta a segment,
 * the developer's spoken ask a message cut where the delegation places it,
 * and an exchange the voice model answered itself two messages of its own:
 * the developer's settled utterance as a user row and Luke's settled answer
 * as an assistant row, each cut from the segments over the span the service
 * settled, so the Conversation keeps what was said whether or not the brain
 * was consulted. The service hands every server event here in arrival order
 * and the writer takes what it keeps of each; the two utterance doors are
 * answered on the same queue, after every delta that arrived ahead of the
 * settle has taken its place, so a row is cut from segments already on
 * record and never from a grouping the service kept beside them.
 *
 * A delegation is the one event not consumed as it arrives. The writer cuts
 * the ask from the developer's segments already on record before the
 * delegation's offset, and the API may deliver a delegation ahead of the
 * transcript deltas it is about; so the event is held, and consumed only when
 * the service asks for the developer's utterance to be written under it, by
 * which time every delta that arrived ahead of that ask has taken its place
 * in the sequence. The service makes that write for every delegated ask,
 * whether or not the utterance had settled and been written undelegated
 * before, and awaits it ahead of the reply, so the write answers true only
 * when the ask is on record and the service speaks no reply to an ask the
 * record refused. The writer's own idempotency on the delegation id makes a
 * repeated write the same message.
 *
 * Every face here answers an effect and none of them runs one: the write
 * itself is made on the scoped fiber below, under the `SqlClient` the
 * socket's scope was built on, and what a caller is handed is the wait on
 * that write's own `Deferred`.
 */

type DelegationCreated = Extract<
  LiveServerEvent,
  { type: typeof LIVE_SERVER_EVENT.DELEGATION_CREATED }
>;

export interface HostedLiveRecordOptions {
  readonly writer: VoiceWriter;
  readonly target: VoiceTarget;
}

export interface HostedLiveRecord extends LiveRecord {
  /** One server event of the session's stream, in arrival order; answers what the writer did with it. */
  observe(event: LiveServerEvent): Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>;
  /** Settles once every write started so far has landed or failed; a caller closing the session waits on it so no write is cut. */
  drained(): Effect.Effect<void>;
}

/** A delegation is held for the ask that names it, and the stream itself writes nothing for it yet. */
const HELD: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };

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
    const held = new Map<string, DelegationCreated>();
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
      Queue.unsafeOffer(waiting, { write, landed });
      return Deferred.await(landed);
    }

    const consume = (event: LiveServerEvent) => enqueue(writer.consume(target, event));

    /** Whether the record took an utterance: landed, found standing, or owed nothing; a refusal or a failure is not taken. */
    const taken = (write: Effect.Effect<VoiceWriteResult, SqlError | Schema.SchemaError>) =>
      write.pipe(
        Effect.map((written) => written.ok),
        Effect.catchAll(() => Effect.succeed(false)),
        Effect.catchAllDefect(() => Effect.succeed(false)),
      );

    return {
      observe(event) {
        if (event.type === LIVE_SERVER_EVENT.DELEGATION_CREATED) {
          held.set(event.delegation.id, event);
          return Effect.succeed(HELD);
        }
        return consume(event);
      },
      writeDeveloperUtterance: (record) =>
        Effect.suspend(() => {
          if (record.delegationId === null) {
            return taken(
              enqueue(
                writer.recordSpokenLine(target, {
                  startMs: record.startMs,
                  endMs: record.endMs,
                }),
              ),
            );
          }
          const delegation = held.get(record.delegationId);
          if (delegation === undefined) return Effect.succeed(false);
          // A write the store refused and one it died on are both an ask not
          // on record, as they were when the promise rejected; an interruption
          // is neither, and is the socket's scope closing under the wait.
          return consume(delegation).pipe(
            Effect.map((written) => written.ok && written.effect !== STORE_WRITE_EFFECT.IGNORED),
            Effect.catchAll(() => Effect.succeed(false)),
            Effect.catchAllDefect(() => Effect.succeed(false)),
          );
        }),
      writeLukeUtterance: (record) =>
        record.role === CONVERSATION_ENTRY_KIND.REPLY
          ? taken(
              enqueue(
                writer.recordSpokenReply(target, {
                  startMs: record.startMs,
                  endMs: record.endMs,
                }),
              ),
            )
          : Effect.succeed(true),
      drained: () =>
        Effect.suspend(() =>
          last === undefined ? Effect.void : Effect.ignore(Deferred.await(last)),
        ),
    };
  });
}
