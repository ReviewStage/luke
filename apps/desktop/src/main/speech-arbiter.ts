import type { BrainDelivery } from "@sidecar/brain";
import type { SpeechTraceRecord } from "@sidecar/devtrace";
import {
  ARRIVAL_SPEECH_KIND,
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  type ProactiveSpeechTurn,
} from "@sidecar/realtime";
import { SPEECH_OUTCOME, type SpeechOffer, type SpeechOutcome } from "#shared/wire/speech";

/**
 * How long a proactive turn stays worth saying. News about a session is news
 * for minutes, not for whenever a long conversation happens to end: a request
 * older than this is settled stale rather than read out as though it just
 * happened — the panel has shown the state the whole time. The same window
 * is the offer's deadline: an offer the mouth never settled, because the
 * renderer that held it reloaded or crashed, is reclaimed here when it
 * passes, and the next request is offered in its place.
 */
export const SPOKEN_NOTICE_MAX_AGE_MS = 2 * 60_000;

/**
 * How many briefings wait, whether through a meeting's quiet or behind a long
 * reply. A backlog that outlives the news is a backlog that would replay the
 * morning: the brain re-decides a held backlog in one turn at the release and
 * the mouth reads a live one in order, and either wants the recent few.
 */
export const MAXIMUM_PENDING_BRIEFINGS = 8;

export type SpeechKind = ProactiveSpeechTurn["kind"];

/** The scripted beats, each spoken at most once to the end per run. */
export type OnboardingBeatKind = Exclude<SpeechKind, typeof BRIEFING_SPEECH_KIND>;

/**
 * What the arbiter decided about a request, as the development trace records
 * it: the four outcomes the mouth can report, plus the three moments only the
 * arbiter sees. Nothing worded is ever traced beside one.
 */
export const SPEECH_DECISION = {
  REQUESTED: "requested",
  OFFERED: "offered",
  DROPPED: "dropped",
  ...SPEECH_OUTCOME,
} as const;

export type SpeechDecision = (typeof SPEECH_DECISION)[keyof typeof SPEECH_DECISION];

/**
 * One proactive turn waiting to be offered. A briefing keeps the whole
 * delivery so the brain's hold release receives exactly what it decided; a
 * beat is its kind alone, worded by the mouth at speak time from what the
 * renderer already draws.
 */
export type SpeechRequest = {
  id: string;
  requestedAt: number;
  /** Whether the request waits out the announcement hold rather than the clock. */
  held: boolean;
} & (
  | { kind: typeof BRIEFING_SPEECH_KIND; delivery: BrainDelivery }
  | { kind: typeof ARRIVAL_SPEECH_KIND }
  | { kind: typeof CALENDAR_ONBOARDING_SPEECH_KIND }
);

export type SpeechRequestInput =
  | { kind: typeof BRIEFING_SPEECH_KIND; delivery: BrainDelivery }
  | { kind: OnboardingBeatKind };

export interface SpeechSettlement {
  kind: SpeechKind;
  outcome: SpeechOutcome;
  request: SpeechRequest;
}

export interface SpeechArbiterOptions {
  now: () => number;
  nextId: () => string;
  trace?: (record: SpeechTraceRecord) => void;
}

function isBeat(request: SpeechRequest): request is SpeechRequest & { kind: OnboardingBeatKind } {
  return request.kind !== BRIEFING_SPEECH_KIND;
}

/**
 * The one owner of everything Luke says unprompted: which requests stand,
 * in what order, whether now, and what became of each. The mouth in the
 * renderer holds at most one offer at a time and reports its outcome by id;
 * only then is the next offered. A renderer therefore holds nothing a reload
 * or a hold can destroy, and a request that reached the mouth and came back
 * held rejoins the head rather than dying in a queue the hold emptied.
 *
 * Quiet — the developer's pause or a meeting's — is applied here and only
 * here: a request arriving under it, or standing when it begins, is marked
 * held. A held beat is released with a fresh clock when the quiet ends. A
 * held briefing is not spoken as it stood: it is handed back to the brain for
 * one re-decision, because the sessions may have moved on while the meeting
 * ran, and what the brain decides afresh arrives as a new request.
 *
 * A beat is spent for the run only by a terminal outcome — spoken, refused,
 * or stale — never by being sent, held, or withdrawn, so a beat a meeting
 * silenced speaks after the meeting instead of waiting for the next launch.
 */
export class SpeechArbiter {
  readonly #options: SpeechArbiterOptions;
  #pending: SpeechRequest[] = [];
  /** The head request the mouth holds, and the deadline it was offered under. */
  #offered: { id: string; speakBy: number } | undefined;
  #quiet = false;
  readonly #spentThisRun = new Set<OnboardingBeatKind>();

  constructor(options: SpeechArbiterOptions) {
    this.#options = options;
  }

  get quiet(): boolean {
    return this.#quiet;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  get heldBriefingCount(): number {
    return this.#heldBriefings().length;
  }

  get offeredId(): string | undefined {
    return this.#offered?.id;
  }

  /**
   * Takes one turn something decided to voice. A beat already pending,
   * offered, or spent this run is dropped: each is one line, said once. A
   * briefing joins the backlog, and the backlog sheds its oldest whole past
   * the bound — a briefing is one sentence the brain already worded, with no
   * half to keep — except the one the mouth already holds, which is settled
   * by the mouth and never taken out from under it.
   */
  request(input: SpeechRequestInput): void {
    const now = this.#options.now();
    if (input.kind !== BRIEFING_SPEECH_KIND) {
      const duplicate =
        this.#spentThisRun.has(input.kind) ||
        this.#pending.some((request) => request.kind === input.kind);
      if (duplicate) {
        this.#trace(input.kind, SPEECH_DECISION.DROPPED);
        return;
      }
      this.#pending.push({
        id: this.#options.nextId(),
        requestedAt: now,
        held: this.#quiet,
        kind: input.kind,
      });
      this.#trace(input.kind, SPEECH_DECISION.REQUESTED);
      return;
    }
    this.#pending.push({
      id: this.#options.nextId(),
      requestedAt: now,
      held: this.#quiet,
      kind: BRIEFING_SPEECH_KIND,
      delivery: input.delivery,
    });
    this.#trace(BRIEFING_SPEECH_KIND, SPEECH_DECISION.REQUESTED);
    let excess = this.#briefingCount() - MAXIMUM_PENDING_BRIEFINGS;
    while (excess > 0) {
      const oldest = this.#pending.find(
        (request) => request.kind === BRIEFING_SPEECH_KIND && request.id !== this.#offered?.id,
      );
      if (!oldest) return;
      this.#remove(oldest.id);
      this.#trace(BRIEFING_SPEECH_KIND, SPEECH_DECISION.DROPPED);
      excess -= 1;
    }
  }

  /**
   * Follows the announcement hold. Quiet beginning marks every pending
   * request held; the one the mouth holds comes back through its HELD
   * settle. Quiet ending releases the beats with a fresh clock, so a beat
   * that waited out a meeting is not stale the moment it may speak; the
   * briefings stay held until the brain takes them for its re-decision.
   */
  setQuiet(quiet: boolean): void {
    if (quiet === this.#quiet) return;
    this.#quiet = quiet;
    if (quiet) {
      for (const request of this.#pending) request.held = true;
      return;
    }
    const now = this.#options.now();
    for (const request of this.#pending) {
      if (!isBeat(request)) continue;
      request.held = false;
      request.requestedAt = now;
    }
  }

  /**
   * Removes and returns the held briefings in the order they were decided,
   * for the brain to re-decide as one backlog. One the mouth still holds is
   * left for its settle, and is taken on the pass after it comes back.
   */
  takeHeldBriefings(): readonly BrainDelivery[] {
    const taken = this.#heldBriefings();
    for (const request of taken) this.#remove(request.id);
    return taken.map((request) => request.delivery);
  }

  /**
   * Discards every briefing that has not reached the mouth: no brain can
   * stand to re-decide them, or the quiet that held them has lost its
   * reason. One the mouth holds is settled by the mouth.
   */
  dropBriefings(): void {
    for (const request of [...this.#pending]) {
      if (request.kind !== BRIEFING_SPEECH_KIND || request.id === this.#offered?.id) continue;
      this.#remove(request.id);
      this.#trace(BRIEFING_SPEECH_KIND, SPEECH_DECISION.DROPPED);
    }
  }

  /**
   * Removes a pending beat whose reason has gone — the gate it explained
   * stood down, the account it greeted signed out. Withdrawal does not spend
   * the kind. When the beat was the one offered, its id is returned so the
   * caller can take it back from the mouth as well.
   */
  retract(kind: OnboardingBeatKind): string | undefined {
    const request = this.#pending.find((candidate) => candidate.kind === kind);
    if (!request) return undefined;
    const wasOffered = this.#offered?.id === request.id;
    if (wasOffered) this.#offered = undefined;
    this.#remove(request.id);
    this.#trace(kind, SPEECH_DECISION.DROPPED);
    return wasOffered ? request.id : undefined;
  }

  /**
   * Offers the head request, or nothing. An outstanding offer whose deadline
   * has passed unsettled is settled stale here first: this is the whole
   * recovery from a renderer that reloaded, crashed, or lost the settle.
   * Nothing is offered under quiet or while an offer stands. Unheld requests
   * past their age are settled stale on the way; a held one waits out the
   * hold, not the clock, and is never offered: a held beat is released by the
   * quiet ending, and a held briefing belongs to the brain's re-decision.
   */
  next(): SpeechOffer | undefined {
    const now = this.#options.now();
    if (this.#offered && now > this.#offered.speakBy) {
      this.#settleTerminal(this.#offered.id, SPEECH_OUTCOME.STALE);
      this.#offered = undefined;
    }
    if (this.#quiet || this.#offered) return undefined;
    for (const request of [...this.#pending]) {
      if (request.held || now - this.#decidedAt(request) <= SPOKEN_NOTICE_MAX_AGE_MS) continue;
      this.#settleTerminal(request.id, SPEECH_OUTCOME.STALE);
    }
    const head = this.#pending.find((request) => !request.held);
    if (!head) return undefined;
    const decidedAt = this.#decidedAt(head);
    const offer: SpeechOffer = {
      id: head.id,
      speakBy: decidedAt + SPOKEN_NOTICE_MAX_AGE_MS,
      turn: this.#turn(head),
    };
    this.#offered = { id: offer.id, speakBy: offer.speakBy };
    this.#trace(head.kind, SPEECH_DECISION.OFFERED);
    return offer;
  }

  /**
   * Takes the mouth's report on the offer it holds. An id no longer known —
   * withdrawn, or reclaimed at its deadline — is a late report and is
   * ignored. SPOKEN and STALE end the request and spend a beat's kind. HELD
   * keeps it at the head for the release — or, reported while no quiet
   * stands here, unheld, so the next reconcile offers it again: the mouth
   * read a hold the panel still drew after it had ended, and a request
   * marked held against a quiet already gone would wait for a release that
   * can never come. REFUSED is a call that could not
   * be opened within its attempts, which ends every pending request: each is
   * still standing in the panel, and a fresh request starts a fresh backlog.
   */
  settle(id: string, outcome: SpeechOutcome): SpeechSettlement | undefined {
    if (this.#offered?.id !== id) return undefined;
    const request = this.#pending.find((candidate) => candidate.id === id);
    this.#offered = undefined;
    if (!request) return undefined;
    switch (outcome) {
      case SPEECH_OUTCOME.HELD:
        request.held = this.#quiet;
        this.#trace(request.kind, SPEECH_OUTCOME.HELD);
        break;
      case SPEECH_OUTCOME.SPOKEN:
      case SPEECH_OUTCOME.STALE:
        this.#settleTerminal(id, outcome);
        break;
      case SPEECH_OUTCOME.REFUSED:
        for (const pending of [...this.#pending]) {
          this.#settleTerminal(pending.id, SPEECH_OUTCOME.REFUSED);
        }
        break;
    }
    return { kind: request.kind, outcome, request };
  }

  #settleTerminal(id: string, outcome: SpeechOutcome): void {
    const request = this.#pending.find((candidate) => candidate.id === id);
    if (!request) return;
    this.#remove(id);
    if (isBeat(request)) this.#spentThisRun.add(request.kind);
    this.#trace(request.kind, outcome);
  }

  #remove(id: string): void {
    this.#pending = this.#pending.filter((request) => request.id !== id);
  }

  #briefingCount(): number {
    return this.#pending.filter((request) => request.kind === BRIEFING_SPEECH_KIND).length;
  }

  #heldBriefings(): Array<SpeechRequest & { kind: typeof BRIEFING_SPEECH_KIND }> {
    const held: Array<SpeechRequest & { kind: typeof BRIEFING_SPEECH_KIND }> = [];
    for (const request of this.#pending) {
      if (request.kind !== BRIEFING_SPEECH_KIND || !request.held) continue;
      if (request.id === this.#offered?.id) continue;
      held.push(request);
    }
    return held;
  }

  /** When the request became news: a briefing's decision, a beat's request. */
  #decidedAt(request: SpeechRequest): number {
    return request.kind === BRIEFING_SPEECH_KIND ? request.delivery.decidedAt : request.requestedAt;
  }

  #turn(request: SpeechRequest): ProactiveSpeechTurn {
    switch (request.kind) {
      case BRIEFING_SPEECH_KIND:
        return {
          kind: BRIEFING_SPEECH_KIND,
          briefing: request.delivery.briefing,
          decidedAt: request.delivery.decidedAt,
        };
      case ARRIVAL_SPEECH_KIND:
        return { kind: ARRIVAL_SPEECH_KIND, decidedAt: request.requestedAt };
      case CALENDAR_ONBOARDING_SPEECH_KIND:
        return { kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: request.requestedAt };
    }
  }

  #trace(kind: SpeechKind, decision: SpeechDecision): void {
    this.#options.trace?.({ kind, decision, pendingCount: this.#pending.length });
  }
}
