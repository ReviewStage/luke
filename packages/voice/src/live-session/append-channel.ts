import { LIVE_CLIENT_EVENT, type LiveAppendEvent } from "@sidecar/live";
import { Clock, Deferred, Duration, Effect, Exit, FiberId, Option, Queue } from "effect";
import type { LiveSideband } from "../live-socket.js";
import { LIVE_TRACE_DECISION, type LiveTrace } from "./live-trace.js";

/**
 * The host's sends on one session, in order, each awaiting the acknowledgment
 * or the error that names it. An error naming no client event is never read
 * as success, silence past the timeout counts as the append not taken, and a
 * commentary that was taken is settled spoken by the first output transcript
 * past its end and un-settled if a moderation error cuts that speech, as the
 * conversations guide has it. Closing the channel refuses everything still
 * waiting, so a dead session's deliveries are discarded rather than left
 * hanging.
 */

/** How long an append waits for its acknowledgment or error before it is counted as not taken. */
const APPEND_ACK_TIMEOUT_MS = 10_000;

type Acknowledgment = { ok: true; endMs: number } | { ok: false };

const NOT_TAKEN: Acknowledgment = { ok: false };

/** A commentary append acknowledged and not yet heard: settled by the first output transcript past its end. */
interface AwaitingSpeech {
  endMs: number;
  onSpoken: () => void;
}

interface PendingAck {
  acknowledged: Deferred.Deferred<Acknowledgment>;
  /** For a commentary append: registered to await its speech the instant the acknowledgment lands, before any output delta can follow it. */
  onSpoken: (() => void) | undefined;
}

/**
 * What a send may ask of the channel beside the append itself: the callback a
 * commentary's speech settles, and whether the send is one the session should
 * be kept alive for. Both default to what an ordinary reply wants.
 */
export interface SendOptions {
  /** For a commentary append: called once its speech has settled. */
  onSpoken?: () => void;
  /** Whether this send moves the idle clock. A note about the desk does not. */
  countsForIdle?: boolean;
}

export interface AppendChannelOptions {
  sideband: LiveSideband;
  report: (message: string) => void;
  trace: LiveTrace;
}

export class AppendChannel {
  readonly #options: AppendChannelOptions;
  readonly #pending = new Map<string, PendingAck>();
  #awaiting: AwaitingSpeech[] = [];
  /** The commentary appends heard so far, newest last, so a moderation cut can un-settle the one it interrupted. */
  readonly #spoken: AwaitingSpeech[] = [];
  readonly #work: Queue.Queue<Effect.Effect<void>>;
  /** Settled by `close`, so the fiber serializing the sends ends where it waits rather than outliving the session. */
  readonly #closed = Deferred.unsafeMake<void>(FiberId.none);
  #shut = false;
  /**
   * When the host last appended anything the session is worth keeping open
   * for. A send asked not to count for idle leaves it where it was, so a note
   * the host writes about the desk cannot hold a quiet session open forever.
   */
  lastSentAt: number | undefined;

  private constructor(options: AppendChannelOptions, work: Queue.Queue<Effect.Effect<void>>) {
    this.#options = options;
    this.#work = work;
  }

  /**
   * The channel and the fiber that serializes its sends: the caller runs
   * `serve` on a fiber of its own scope, since the channel starts nothing on
   * a runtime of its own, and `close` is what ends that fiber.
   */
  static make(
    options: AppendChannelOptions,
  ): Effect.Effect<{ channel: AppendChannel; serve: Effect.Effect<void> }> {
    return Effect.gen(function* () {
      const work = yield* Queue.unbounded<Effect.Effect<void>>();
      const channel = new AppendChannel(options, work);
      return { channel, serve: channel.#serve() };
    });
  }

  /**
   * Serializes the host's sends: each unit of work runs after the last has
   * settled, and none once the channel is closed. A close while a unit is in
   * flight lets that unit finish and takes no other, so a delivery already
   * under way settles as its sender wrote it.
   */
  enqueue(work: Effect.Effect<void>): void {
    if (this.#shut) return;
    Queue.unsafeOffer(this.#work, work);
  }

  /** Sends one append and answers whether the session took it. */
  send(event: LiveAppendEvent, options: SendOptions = {}): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      if (this.#shut) return false;
      const { onSpoken, countsForIdle = true } = options;
      const speech =
        event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND
          ? () => {
              this.#options.trace(LIVE_TRACE_DECISION.SPOKEN);
              onSpoken?.();
            }
          : undefined;
      const acknowledged = yield* Deferred.make<Acknowledgment>();
      this.#pending.set(event.event_id, { acknowledged, onSpoken: speech });
      if (countsForIdle) this.lastSentAt = yield* Clock.currentTimeMillis;
      yield* this.#options.sideband.send(event);
      const settled = yield* Effect.timeoutOption(
        Deferred.await(acknowledged),
        Duration.millis(APPEND_ACK_TIMEOUT_MS),
      );
      if (Option.isNone(settled)) this.#pending.delete(event.event_id);
      const acknowledgment = Option.getOrElse(settled, () => NOT_TAKEN);
      this.#options.trace(
        acknowledgment.ok ? LIVE_TRACE_DECISION.APPENDED : LIVE_TRACE_DECISION.APPEND_REFUSED,
      );
      return acknowledgment.ok;
    });
  }

  /** The `*.appended` acknowledgment naming one of this channel's appends. */
  acknowledge(eventId: string, endMs: number): void {
    this.#settle(eventId, { ok: true, endMs });
  }

  /** An error naming one of this channel's appends. */
  refuse(eventId: string): void {
    this.#settle(eventId, NOT_TAKEN);
  }

  /** Output transcript reached this instant: every commentary whose injection ended before it has been heard. */
  outputReached(endMs: number): void {
    const heard = this.#awaiting.filter((awaiting) => endMs > awaiting.endMs);
    if (heard.length === 0) return;
    this.#awaiting = this.#awaiting.filter((awaiting) => !heard.includes(awaiting));
    for (const awaiting of heard) {
      this.#spoken.push(awaiting);
      awaiting.onSpoken();
    }
  }

  /** A moderation cut interrupted Luke mid-speech: the commentary he was saying is no longer counted delivered. */
  interruptSpeech(): void {
    if (this.#spoken.pop()) this.#options.trace(LIVE_TRACE_DECISION.UNSETTLED);
  }

  /** The session is gone: nothing waiting is taken, and nothing further leaves. */
  close(): void {
    this.#shut = true;
    for (const [eventId, pending] of [...this.#pending]) {
      this.#pending.delete(eventId);
      Deferred.unsafeDone(pending.acknowledged, Effect.succeed(NOT_TAKEN));
    }
    this.#awaiting = [];
    Deferred.unsafeDone(this.#closed, Exit.void);
  }

  #serve(): Effect.Effect<void> {
    const next = Effect.raceFirst(
      Effect.as(Deferred.await(this.#closed), Option.none<Effect.Effect<void>>()),
      Effect.map(Queue.take(this.#work), Option.some),
    );
    return Effect.iterate(true, {
      while: (open) => open,
      body: () =>
        Effect.flatMap(next, (work) =>
          Option.isNone(work)
            ? Effect.succeed(false)
            : Effect.as(
                Effect.catchAllDefect(work.value, (defect) =>
                  Effect.sync(() => {
                    this.#options.report(
                      `A live append failed: ${defect instanceof Error ? defect.message : String(defect)}`,
                    );
                  }),
                ),
                !this.#shut,
              ),
        ),
    }).pipe(Effect.asVoid);
  }

  #settle(eventId: string, acknowledgment: Acknowledgment): void {
    const pending = this.#pending.get(eventId);
    if (!pending) return;
    this.#pending.delete(eventId);
    if (acknowledgment.ok && pending.onSpoken) {
      this.#awaiting.push({ endMs: acknowledgment.endMs, onSpoken: pending.onSpoken });
    }
    Deferred.unsafeDone(pending.acknowledged, Effect.succeed(acknowledgment));
  }
}
