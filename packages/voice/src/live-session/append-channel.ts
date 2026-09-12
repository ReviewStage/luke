import { LIVE_CLIENT_EVENT, type LiveAppendEvent } from "@sidecar/live";
import type { LiveSideband } from "../live-socket.js";
import type { TimerHandle } from "../scheduled-timer.js";
import { LIVE_TRACE_DECISION, type LiveTrace } from "./live-trace.js";

export type { TimerHandle } from "../scheduled-timer.js";

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

/** A commentary append acknowledged and not yet heard: settled by the first output transcript past its end. */
interface AwaitingSpeech {
  endMs: number;
  onSpoken: () => void;
}

interface PendingAck {
  resolve: (acknowledgment: Acknowledgment) => void;
  timer: TimerHandle;
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
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (timer: TimerHandle) => void;
  report: (message: string) => void;
  trace: LiveTrace;
}

export class AppendChannel {
  readonly #options: AppendChannelOptions;
  readonly #pending = new Map<string, PendingAck>();
  #awaiting: AwaitingSpeech[] = [];
  /** The commentary appends heard so far, newest last, so a moderation cut can un-settle the one it interrupted. */
  readonly #spoken: AwaitingSpeech[] = [];
  #chain: Promise<void> = Promise.resolve();
  #closed = false;
  /**
   * When the host last appended anything the session is worth keeping open
   * for. A send asked not to count for idle leaves it where it was, so a note
   * the host writes about the desk cannot hold a quiet session open forever.
   */
  lastSentAt: number | undefined;

  constructor(options: AppendChannelOptions) {
    this.#options = options;
  }

  /** Serializes the host's sends: each unit of work runs after the last has settled, and none once the channel is closed. */
  enqueue(work: () => Promise<void>): void {
    this.#chain = this.#chain.then(async () => {
      if (this.#closed) return;
      try {
        await work();
      } catch (error) {
        this.#options.report(
          `A live append failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  /** Sends one append and answers whether the session took it. */
  async send(event: LiveAppendEvent, options: SendOptions = {}): Promise<boolean> {
    if (this.#closed) return false;
    const { onSpoken, countsForIdle = true } = options;
    const speech =
      event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND
        ? () => {
            this.#options.trace(LIVE_TRACE_DECISION.SPOKEN);
            onSpoken?.();
          }
        : undefined;
    const acknowledged = new Promise<Acknowledgment>((resolve) => {
      const timer = this.#options.schedule(() => {
        this.#pending.delete(event.event_id);
        resolve({ ok: false });
      }, APPEND_ACK_TIMEOUT_MS);
      this.#pending.set(event.event_id, { resolve, timer, onSpoken: speech });
    });
    if (countsForIdle) this.lastSentAt = this.#options.now();
    this.#options.sideband.send(event);
    const acknowledgment = await acknowledged;
    this.#options.trace(
      acknowledgment.ok ? LIVE_TRACE_DECISION.APPENDED : LIVE_TRACE_DECISION.APPEND_REFUSED,
    );
    return acknowledgment.ok;
  }

  /** The `*.appended` acknowledgment naming one of this channel's appends. */
  acknowledge(eventId: string, endMs: number): void {
    this.#settle(eventId, { ok: true, endMs });
  }

  /** An error naming one of this channel's appends. */
  refuse(eventId: string): void {
    this.#settle(eventId, { ok: false });
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
    this.#closed = true;
    for (const [eventId, pending] of [...this.#pending]) {
      this.#pending.delete(eventId);
      this.#options.cancel(pending.timer);
      pending.resolve({ ok: false });
    }
    this.#awaiting = [];
  }

  #settle(eventId: string, acknowledgment: Acknowledgment): void {
    const pending = this.#pending.get(eventId);
    if (!pending) return;
    this.#pending.delete(eventId);
    this.#options.cancel(pending.timer);
    if (acknowledgment.ok && pending.onSpoken) {
      this.#awaiting.push({ endMs: acknowledgment.endMs, onSpoken: pending.onSpoken });
    }
    pending.resolve(acknowledgment);
  }
}
