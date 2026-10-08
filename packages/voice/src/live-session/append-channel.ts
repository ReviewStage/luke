import type { LiveAppendEvent } from "@sidecar/live";
import { Clock, Deferred, Duration, Effect, Exit, Option, Queue } from "effect";
import type { LiveSideband } from "../live-socket.js";

/**
 * The host's sends on one session, in order, each awaiting the acknowledgment
 * or the error that names it. An error naming no client event is never read
 * as success, and silence past the timeout counts as the append not taken.
 * Closing the channel refuses everything still waiting, so a dead session's
 * deliveries are discarded rather than left hanging.
 */

/** How long an append waits for its acknowledgment or error before it is counted as not taken. */
const APPEND_ACK_TIMEOUT_MS = 10_000;

/**
 * What became of one append: taken, refused by an error naming it, never
 * answered inside the timeout, or never sent because the channel is closed.
 * A refusal is the one outcome that says the session did not take the words;
 * an append left unanswered may still reach the timeline once it moves again,
 * as the conversations guide has it, so the two are told apart.
 */
export const APPEND_OUTCOME = {
  TAKEN: "taken",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
  CLOSED: "closed",
} as const;

export type AppendOutcome = (typeof APPEND_OUTCOME)[keyof typeof APPEND_OUTCOME];

/** What settles a waiting append before its timeout: an acknowledgment, an error, or the close. */
type Acknowledgment = Exclude<AppendOutcome, typeof APPEND_OUTCOME.UNANSWERED>;

/**
 * What a send may ask of the channel beside the append itself: whether the
 * send is one the session should be kept alive for, which by default it is.
 */
interface SendOptions {
  /** Whether this send moves the idle clock. The stop instruction does not. */
  countsForIdle?: boolean;
}

interface AppendChannelOptions {
  sideband: LiveSideband;
  report: (message: string) => void;
}

export class AppendChannel {
  readonly #options: AppendChannelOptions;
  readonly #pending = new Map<string, Deferred.Deferred<Acknowledgment>>();
  readonly #work: Queue.Queue<Effect.Effect<void>>;
  /** Settled by `close`, so the fiber serializing the sends ends where it waits rather than outliving the session. */
  readonly #closed = Deferred.makeUnsafe<void>();
  #shut = false;
  /**
   * When the host last appended anything the session is worth keeping open
   * for. A send asked not to count for idle leaves it where it was, so an
   * instruction the host writes cannot hold a quiet session open forever.
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
    Queue.offerUnsafe(this.#work, work);
  }

  /** Sends one append and answers whether the session took it. */
  send(event: LiveAppendEvent, options: SendOptions = {}): Effect.Effect<boolean> {
    return Effect.map(this.deliver(event, options), (outcome) => outcome === APPEND_OUTCOME.TAKEN);
  }

  /** Sends one append and answers what became of it. */
  deliver(event: LiveAppendEvent, options: SendOptions = {}): Effect.Effect<AppendOutcome> {
    return Effect.gen({ self: this }, function* () {
      if (this.#shut) return APPEND_OUTCOME.CLOSED;
      const { countsForIdle = true } = options;
      const acknowledged = yield* Deferred.make<Acknowledgment>();
      this.#pending.set(event.event_id, acknowledged);
      if (countsForIdle) this.lastSentAt = yield* Clock.currentTimeMillis;
      yield* this.#options.sideband.send(event);
      const settled = yield* Effect.timeoutOption(
        Deferred.await(acknowledged),
        Duration.millis(APPEND_ACK_TIMEOUT_MS),
      );
      if (Option.isNone(settled)) {
        this.#pending.delete(event.event_id);
        return APPEND_OUTCOME.UNANSWERED;
      }
      return settled.value;
    });
  }

  /** The `*.appended` acknowledgment naming one of this channel's appends. */
  acknowledge(eventId: string): void {
    this.#settle(eventId, APPEND_OUTCOME.TAKEN);
  }

  /** An error naming one of this channel's appends. */
  refuse(eventId: string): void {
    this.#settle(eventId, APPEND_OUTCOME.REFUSED);
  }

  /** The session is gone: nothing waiting is taken, and nothing further leaves. */
  close(): void {
    this.#shut = true;
    for (const [eventId, acknowledged] of [...this.#pending]) {
      this.#pending.delete(eventId);
      Deferred.doneUnsafe(acknowledged, Effect.succeed(APPEND_OUTCOME.CLOSED));
    }
    Deferred.doneUnsafe(this.#closed, Exit.void);
  }

  #serve(): Effect.Effect<void> {
    const next = Effect.raceFirst(
      Effect.as(Deferred.await(this.#closed), Option.none<Effect.Effect<void>>()),
      Effect.map(Queue.take(this.#work), Option.some),
    );
    // The loop is the channel's own statement rather than a combinator: it
    // stands open until the close wins the race or a take leaves the channel
    // shut, which is the same condition the iteration carried as its state.
    return Effect.gen({ self: this }, function* () {
      let open = true;
      while (open) {
        const work = yield* next;
        if (Option.isNone(work)) {
          open = false;
          continue;
        }
        yield* Effect.catchDefect(work.value, (defect) =>
          Effect.sync(() => {
            this.#options.report(
              `A live append failed: ${defect instanceof Error ? defect.message : String(defect)}`,
            );
          }),
        );
        open = !this.#shut;
      }
    });
  }

  #settle(eventId: string, acknowledgment: Acknowledgment): void {
    const acknowledged = this.#pending.get(eventId);
    if (!acknowledged) return;
    this.#pending.delete(eventId);
    Deferred.doneUnsafe(acknowledged, Effect.succeed(acknowledgment));
  }
}
