import {
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  type ProactiveSpeechTurn,
} from "@sidecar/live";
import { LIVE_TRACE_DECISION, type LiveTrace } from "./live-trace.js";

/**
 * What Luke wants to say unprompted, waiting for a session to say it into:
 * briefings the brain decided, the two onboarding beats, and the launch
 * greeting. Quiet — a
 * meeting's or the developer's pause — is applied here and only here: a
 * request arriving under it, or standing when it begins, is held; a held beat
 * is released with a fresh clock when the quiet ends, and a held briefing is
 * handed back for one re-decision rather than said as it stood. A beat is one
 * line, asked for once until it is spoken, refused, or withdrawn, and spent
 * for the run once spoken to the end. A request older than the notice age is
 * dropped rather than said as though it just happened.
 */

/** How long a proactive turn stays worth saying before it is dropped as stale rather than said late. */
const SPOKEN_NOTICE_MAX_AGE_MS = 2 * 60_000;

/** The most briefings that wait; older news is dropped rather than replayed. */
const MAXIMUM_PENDING_BRIEFINGS = 8;

export type BeatKind = Exclude<ProactiveSpeechKind, typeof PROACTIVE_SPEECH_KIND.BRIEFING>;

export type BeatTurn = Exclude<
  ProactiveSpeechTurn,
  { kind: typeof PROACTIVE_SPEECH_KIND.BRIEFING }
>;

export type ProactiveRequest<Delivery> =
  | { kind: typeof PROACTIVE_SPEECH_KIND.BRIEFING; delivery: Delivery; turn: ProactiveSpeechTurn }
  | { kind: BeatKind; turn: BeatTurn };

export interface ProactiveQueueOptions {
  now: () => number;
  trace: LiveTrace;
}

export class ProactiveQueue<Delivery extends { briefing: string; decidedAt: number }> {
  readonly #options: ProactiveQueueOptions;
  #pending: ProactiveRequest<Delivery>[] = [];
  #held: ProactiveRequest<Delivery>[] = [];
  #quiet = false;
  readonly #spentBeats = new Set<BeatKind>();
  /** Beats requested and not yet spoken, refused, or withdrawn. */
  readonly #activeBeats = new Set<BeatKind>();

  constructor(options: ProactiveQueueOptions) {
    this.#options = options;
  }

  /** How many requests stand, pending or held. */
  get size(): number {
    return this.#pending.length + this.#held.length;
  }

  /** Whether anything waits to be said into a session. */
  get hasPending(): boolean {
    return this.#pending.length > 0;
  }

  /** A briefing joins the backlog, which sheds its oldest past the bound. */
  requestBriefing(delivery: Delivery): void {
    const request: ProactiveRequest<Delivery> = {
      kind: PROACTIVE_SPEECH_KIND.BRIEFING,
      delivery,
      turn: {
        kind: PROACTIVE_SPEECH_KIND.BRIEFING,
        briefing: delivery.briefing,
        decidedAt: delivery.decidedAt,
      },
    };
    if (!this.#admit(request)) return;
    const briefings = this.#pending.filter(
      (candidate) => candidate.kind === PROACTIVE_SPEECH_KIND.BRIEFING,
    );
    if (briefings.length > MAXIMUM_PENDING_BRIEFINGS) {
      const oldest = briefings[0];
      this.#pending = this.#pending.filter((candidate) => candidate !== oldest);
      this.#options.trace(LIVE_TRACE_DECISION.DROPPED);
    }
  }

  /** A beat already active or spent this run is one line said once, and is refused. */
  requestBeat(turn: BeatTurn): void {
    if (this.#spentBeats.has(turn.kind) || this.#activeBeats.has(turn.kind)) return;
    this.#activeBeats.add(turn.kind);
    this.#admit({ kind: turn.kind, turn });
  }

  /** Removes a beat whose reason has gone; withdrawal does not spend the kind. */
  withdrawBeat(kind: BeatKind): void {
    this.#pending = this.#pending.filter((request) => request.kind !== kind);
    this.#held = this.#held.filter((request) => request.kind !== kind);
    this.#activeBeats.delete(kind);
  }

  /** Discards every briefing not yet taken; answers whether any went. */
  dropBriefings(): boolean {
    const before = this.size;
    const notBriefing = (request: ProactiveRequest<Delivery>) =>
      request.kind !== PROACTIVE_SPEECH_KIND.BRIEFING;
    this.#pending = this.#pending.filter(notBriefing);
    this.#held = this.#held.filter(notBriefing);
    const dropped = before !== this.size;
    if (dropped) this.#options.trace(LIVE_TRACE_DECISION.DROPPED);
    return dropped;
  }

  /**
   * Follows the announcement hold. Quiet beginning holds every pending
   * request; quiet ending releases the beats with a fresh clock and answers
   * the held briefings for the caller to hand back for re-decision.
   */
  setQuiet(quiet: boolean): readonly Delivery[] {
    if (quiet === this.#quiet) return [];
    this.#quiet = quiet;
    if (quiet) {
      this.#held.push(...this.#pending);
      this.#pending = [];
      if (this.#held.length > 0) this.#options.trace(LIVE_TRACE_DECISION.HELD);
      return [];
    }
    const released = this.#held;
    this.#held = [];
    const briefings: Delivery[] = [];
    const now = this.#options.now();
    for (const request of released) {
      if (request.kind === PROACTIVE_SPEECH_KIND.BRIEFING) {
        briefings.push(request.delivery);
        continue;
      }
      this.#pending.push({ ...request, turn: { ...request.turn, decidedAt: now } });
    }
    return briefings;
  }

  /** Takes every pending request still worth saying, in order; the stale are dropped on the way. */
  take(): readonly ProactiveRequest<Delivery>[] {
    const taken: ProactiveRequest<Delivery>[] = [];
    for (const request of this.#pending.splice(0)) {
      if (this.#stale(request)) {
        this.release(request);
        this.#options.trace(LIVE_TRACE_DECISION.DROPPED);
        continue;
      }
      taken.push(request);
    }
    return taken;
  }

  /** The request was spoken to its end: a beat is spent for the run. */
  spoken(request: ProactiveRequest<Delivery>): void {
    if (request.kind !== PROACTIVE_SPEECH_KIND.BRIEFING) {
      this.#spentBeats.add(request.kind);
      this.#activeBeats.delete(request.kind);
    }
  }

  /** The request will not be spoken from this attempt: a beat may be asked for again. */
  release(request: ProactiveRequest<Delivery>): void {
    if (request.kind !== PROACTIVE_SPEECH_KIND.BRIEFING) this.#activeBeats.delete(request.kind);
  }

  clear(): void {
    this.#pending = [];
    this.#held = [];
  }

  #admit(request: ProactiveRequest<Delivery>): boolean {
    if (this.#stale(request)) {
      this.release(request);
      this.#options.trace(LIVE_TRACE_DECISION.DROPPED);
      return false;
    }
    if (this.#quiet) {
      this.#held.push(request);
      this.#options.trace(LIVE_TRACE_DECISION.HELD);
      return false;
    }
    this.#pending.push(request);
    return true;
  }

  #stale(request: ProactiveRequest<Delivery>): boolean {
    return this.#options.now() - request.turn.decidedAt > SPOKEN_NOTICE_MAX_AGE_MS;
  }
}
