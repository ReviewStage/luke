import {
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  type ProactiveSpeechTurn,
} from "@sidecar/live";

/**
 * What Luke wants to say unprompted, waiting for a session to say it into:
 * briefings the brain decided, the two onboarding beats, and the launch
 * greeting. A beat is one
 * line, asked for once until it is spoken, refused, or withdrawn, and spent
 * for the run once spoken to the end. A request older than the notice age is
 * dropped rather than said as though it just happened. The launch greeting
 * opens the conversation, so wherever it joins the backlog it stands ahead of
 * everything else waiting: a briefing claimed at a launch's first session is
 * said after the greeting rather than cut off by it.
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

interface ProactiveQueueOptions {
  now: () => number;
}

export class ProactiveQueue<Delivery extends { briefing: string; decidedAt: number }> {
  readonly #options: ProactiveQueueOptions;
  #pending: ProactiveRequest<Delivery>[] = [];
  readonly #spentBeats = new Set<BeatKind>();
  /** Beats requested and not yet spoken, refused, or withdrawn. */
  readonly #activeBeats = new Set<BeatKind>();

  constructor(options: ProactiveQueueOptions) {
    this.#options = options;
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
    this.#activeBeats.delete(kind);
  }

  /** Takes every pending request still worth saying, in order; the stale are dropped on the way. */
  take(): readonly ProactiveRequest<Delivery>[] {
    const taken: ProactiveRequest<Delivery>[] = [];
    for (const request of this.#pending.splice(0)) {
      if (this.#stale(request)) {
        this.release(request);
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
  }

  #admit(request: ProactiveRequest<Delivery>): boolean {
    if (this.#stale(request)) {
      this.release(request);
      return false;
    }
    this.#pend(request);
    return true;
  }

  /** Joins the backlog: the launch greeting at its head, since it opens the conversation; everything else at its tail. */
  #pend(request: ProactiveRequest<Delivery>): void {
    if (request.kind === PROACTIVE_SPEECH_KIND.LAUNCH) this.#pending.unshift(request);
    else this.#pending.push(request);
  }

  #stale(request: ProactiveRequest<Delivery>): boolean {
    return this.#options.now() - request.turn.decidedAt > SPOKEN_NOTICE_MAX_AGE_MS;
  }
}
