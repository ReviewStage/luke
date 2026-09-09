import {
  cancelResponseEvents,
  clearOutputAudioEvents,
  truncateResponseEvents,
} from "@sidecar/realtime";
import type { WireRecord } from "@sidecar/wire";

/** Bounds interruption events whose successful requests receive no matching acknowledgement. */
const MAXIMUM_PENDING_INTERRUPTIONS = 24;

const INTERRUPTION_EVENT_KIND = {
  CANCELLATION: "cancellation",
  AUDIO_CLEAR: "audio-clear",
  TRUNCATION: "truncation",
} as const;

type InterruptionEventKind = (typeof INTERRUPTION_EVENT_KIND)[keyof typeof INTERRUPTION_EVENT_KIND];

const NO_ACTIVE_RESPONSE_CANCELLATION = /^Cancellation failed:\s*no active response\b/i;

/**
 * The server refusing to trim a reply past its own end. The trim measures how
 * long the reply was audible on a wall clock, which outruns the audio itself
 * when a stop lands at the reply's very end — the words all played, the clock
 * kept counting. A reply refused this way was heard whole, so the record the
 * trim would have corrected is already right.
 */
const TRUNCATION_PAST_AUDIO_END = /^Audio content of \d+ms is already shorter than\b/i;

/**
 * What to trim the cut-off reply to: the message being spoken, and how much of
 * it reached the room. The span is measured by the call that owns the clock;
 * nothing is trimmed when there was nothing to correct.
 */
export interface InterruptedSpan {
  itemId: string;
  audioEndMs: number;
}

export interface InterruptionOptions {
  send(events: readonly WireRecord[]): void;
  onError(message: string): void;
}

/**
 * Cutting a reply off, and the ledger that tells the refusals it draws from
 * everyone else's.
 *
 * The requests an interrupt sends are stamped with names of its own so their
 * errors can be recognized: those errors belong to the reply that was
 * interrupted, so they must never finish a newer turn. Only the
 * redundant-cancel race and a trim refused for asking past the audio's end
 * stay quiet, while every genuine refusal still reaches the developer.
 */
export class Interruption {
  readonly #options: InterruptionOptions;
  /** Cancel, clear, and trim requests not yet answered with an error, by their stamped names. */
  #pending = new Map<string, InterruptionEventKind>();
  #sequence = 0;

  constructor(options: InterruptionOptions) {
    this.#options = options;
  }

  /**
   * Whether the message is the past-the-end trim refusal. It names no event
   * this ledger could match it by — `error.event_id` is null on the wire — so
   * it is recognized by its sentence and never shown.
   */
  static pastAudioEnd(message: string): boolean {
    return TRUNCATION_PAST_AUDIO_END.test(message);
  }

  /**
   * Stops what is already on its way and then what would follow it: the audio
   * is cleared, generation is cancelled when the server still owes a reply,
   * and what Luke believes he said is corrected — or the next answer is free
   * to refer back to a sentence that never reached the room.
   */
  cut(input: { cancelGeneration: boolean; truncate: InterruptedSpan | undefined }): void {
    this.#sequence += 1;
    const cancellationEventId = `response_cancel_${this.#sequence}`;
    const clearEventId = `output_audio_clear_${this.#sequence}`;
    const truncationEventId = `item_truncate_${this.#sequence}`;
    const truncateEvents = input.truncate
      ? truncateResponseEvents({ ...input.truncate, truncationEventId })
      : [];
    const interruptionCount =
      (input.cancelGeneration ? 2 : 1) + (truncateEvents.length > 0 ? 1 : 0);
    while (this.#pending.size + interruptionCount > MAXIMUM_PENDING_INTERRUPTIONS) {
      const [oldest] = this.#pending.keys();
      if (oldest === undefined) break;
      this.#pending.delete(oldest);
    }
    if (input.cancelGeneration) {
      this.#pending.set(cancellationEventId, INTERRUPTION_EVENT_KIND.CANCELLATION);
      this.#pending.set(clearEventId, INTERRUPTION_EVENT_KIND.AUDIO_CLEAR);
      this.#options.send(cancelResponseEvents({ cancellationEventId, clearEventId }));
    } else {
      this.#pending.set(clearEventId, INTERRUPTION_EVENT_KIND.AUDIO_CLEAR);
      this.#options.send(clearOutputAudioEvents(clearEventId));
    }
    if (truncateEvents.length > 0) {
      this.#pending.set(truncationEventId, INTERRUPTION_EVENT_KIND.TRUNCATION);
      this.#options.send(truncateEvents);
    }
  }

  /**
   * Answers an error that came back for one of these requests, reporting
   * whether it was one — so an old reply's failure never finishes the new turn
   * that interrupted it. The documented no-active-response race is quiet;
   * every other refusal still reaches the developer as a real voice error.
   */
  error(event: { message: string; eventId?: string; errorType?: string }): boolean {
    if (event.eventId === undefined) return false;
    const kind = this.#pending.get(event.eventId);
    if (kind === undefined) return false;
    this.#pending.delete(event.eventId);
    const benignCancellation =
      kind === INTERRUPTION_EVENT_KIND.CANCELLATION &&
      event.errorType === "invalid_request_error" &&
      NO_ACTIVE_RESPONSE_CANCELLATION.test(event.message);
    if (!benignCancellation) this.#options.onError(event.message);
    return true;
  }

  /**
   * Forgets the answers still owed. They belong to a call that is over: the
   * next one is opened afresh, and its own sequence keeps counting so no two
   * requests on one call can share a name.
   */
  reset(): void {
    this.#pending.clear();
  }
}
