import type { LiveAppendEvent } from "@luke/live";
import { Clock, Deferred, Duration, Effect, Exit, Option, Queue } from "effect";
import type { LiveSideband } from "../live-socket.js";

/**
 * The host's appends on one session: put on the wire in the order they were
 * queued, each tracked against the acknowledgment or the error that names
 * it. An append never waits for an earlier one's acknowledgment, because an
 * acknowledgment says the session timeline reached the end of that context,
 * which for a sentence of commentary is about as long as saying it; waiting
 * for each in turn held every later reply, note, and instruction behind the
 * speech before it. An error naming no client event is never read as
 * success, and silence past the timeout counts as the append not taken.
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
 * as the conversations guide has it, so the two are told apart. One withdrawn
 * was given up by its sender while it waited for the wire.
 */
export const APPEND_OUTCOME = {
  TAKEN: "taken",
  REFUSED: "refused",
  UNANSWERED: "unanswered",
  CLOSED: "closed",
  /** Never sent: whoever queued it gave it up before its turn on the wire came. */
  WITHDRAWN: "withdrawn",
} as const;

export type AppendOutcome = (typeof APPEND_OUTCOME)[keyof typeof APPEND_OUTCOME];

/** What settles a waiting append before its timeout: an acknowledgment, an error, the close, or its withdrawal. */
type Acknowledgment = Exclude<AppendOutcome, typeof APPEND_OUTCOME.UNANSWERED>;

/**
 * What a send may ask of the channel beside the append itself: whether the
 * send is one the session should be kept alive for, which by default it is.
 */
interface SendOptions {
  /** Whether this send moves the idle clock. The stop instruction does not. */
  countsForIdle?: boolean;
  /** Read as the append's turn on the wire comes: true gives it up unsent, as a reply silenced while it waited. */
  withdrawn?: () => boolean;
}

interface AppendChannelOptions {
  sideband: LiveSideband;
  report: (message: string) => void;
}

export class AppendChannel {
  readonly #options: AppendChannelOptions;
  readonly #pending = new Map<string, Deferred.Deferred<Acknowledgment>>();
  /** Each queued append's turn on the wire, oldest first: a send alone, never the wait for its answer. */
  readonly #work: Queue.Queue<Effect.Effect<void>>;
  /** Settled by `close`, so the fiber putting appends on the wire ends where it waits rather than outliving the session. */
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
   * The channel and the fiber that puts its appends on the wire in order: the caller runs
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
   * Puts one append in line now, behind every append queued before it, and
   * answers the wait for what became of it: its acknowledgment, its refusal,
   * the timeout, or the close. The append goes on the wire when its turn
   * comes, whether or not anyone waits on the answer and whatever became of
   * the appends ahead of it, so wire order is queue order while the
   * acknowledgments settle each its own append, in whatever order they come.
   */
  queue(event: LiveAppendEvent, options: SendOptions = {}): Effect.Effect<AppendOutcome> {
    if (this.#shut) return Effect.succeed(APPEND_OUTCOME.CLOSED);
    const { countsForIdle = true, withdrawn } = options;
    const acknowledged = Deferred.makeUnsafe<Acknowledgment>();
    this.#pending.set(event.event_id, acknowledged);
    Queue.offerUnsafe(
      this.#work,
      Effect.gen({ self: this }, function* () {
        if (withdrawn?.() === true) {
          this.#settle(event.event_id, APPEND_OUTCOME.WITHDRAWN);
          return;
        }
        if (countsForIdle) this.lastSentAt = yield* Clock.currentTimeMillis;
        yield* this.#options.sideband.send(event);
      }),
    );
    return Effect.gen({ self: this }, function* () {
      const settled = yield* Effect.timeoutOption(
        Deferred.await(acknowledged),
        Duration.millis(APPEND_ACK_TIMEOUT_MS),
      );
      if (Option.isSome(settled)) return settled.value;
      this.#pending.delete(event.event_id);
      return APPEND_OUTCOME.UNANSWERED;
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
