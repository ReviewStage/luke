import { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import type { LiveRecord } from "@sidecar/voice/live-session";
import { Deferred, Effect, FiberId, type ParseResult, Queue, type Scope } from "effect";
import { runOverClient } from "../hosted/fiber-runner.js";
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
 * the developer's spoken ask the one message a session leaves, cut where the
 * delegation places it, and nothing Luke spoke a message at all. The service
 * hands every server event here in arrival order and the writer takes what it
 * keeps of each; the two utterance writes the record door names are answered
 * from that stream rather than written again, so the service's grouped
 * utterances never reach a row of their own.
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
  observe(event: LiveServerEvent): Promise<VoiceWriteResult>;
  /** Settles once every write started so far has landed or failed; a caller closing the session waits on it so no write is cut. */
  drained(): Promise<void>;
}

/** A delegation is held for the ask that names it, and the stream itself writes nothing for it yet. */
const HELD: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };

/** One event waiting its turn at the writer, and what the caller that handed it over is waiting on. */
interface PendingWrite {
  readonly event: LiveServerEvent;
  readonly landed: Deferred.Deferred<VoiceWriteResult, SqlError | ParseResult.ParseError>;
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
    const run = runOverClient(yield* SqlClient.SqlClient);
    const held = new Map<string, DelegationCreated>();
    const waiting = yield* Queue.unbounded<PendingWrite>();
    let last: PendingWrite["landed"] | undefined;

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(waiting), (pending) =>
          Effect.flatMap(Effect.exit(writer.consume(target, pending.event)), (written) =>
            Deferred.done(pending.landed, written),
          ),
        ),
      ),
    );

    /** Every write of one session takes its turn, so a segment's place in the sequence is its arrival. */
    function consume(event: LiveServerEvent): Promise<VoiceWriteResult> {
      const landed = Deferred.unsafeMake<VoiceWriteResult, SqlError | ParseResult.ParseError>(
        FiberId.none,
      );
      last = landed;
      Queue.unsafeOffer(waiting, { event, landed });
      return run(Deferred.await(landed));
    }

    return {
      observe(event) {
        if (event.type === LIVE_SERVER_EVENT.DELEGATION_CREATED) {
          held.set(event.delegation.id, event);
          return Promise.resolve(HELD);
        }
        return consume(event);
      },
      async writeDeveloperUtterance(record) {
        if (record.delegationId === null) return true;
        const delegation = held.get(record.delegationId);
        if (delegation === undefined) return false;
        try {
          const written = await consume(delegation);
          return written.ok && written.effect !== STORE_WRITE_EFFECT.IGNORED;
        } catch {
          return false;
        }
      },
      writeLukeUtterance: () => Promise.resolve(true),
      drained: () =>
        last === undefined ? Promise.resolve() : run(Effect.ignore(Deferred.await(last))),
    };
  });
}
