import type { BrainUtterance } from "@sidecar/brain";
import type { SpeechTraceRecord } from "@sidecar/devtrace";
import {
  ARRIVAL_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  type ProactiveSpeechTurn,
  UTTERANCE_SPEECH_KIND,
} from "@sidecar/realtime";
import { SPEECH_OUTCOME, type SpeechOffer, type SpeechOutcome } from "@sidecar/realtime/speech";

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
 * How many utterances wait behind a long reply. A backlog that outlives the
 * news is a backlog that would replay the morning: the mouth reads them in
 * order, and wants the recent few.
 */
export const MAXIMUM_PENDING_UTTERANCES = 8;

export type SpeechKind = ProactiveSpeechTurn["kind"];

/** The scripted beats, each spoken at most once to the end per run. */
export type OnboardingBeatKind = Exclude<SpeechKind, typeof UTTERANCE_SPEECH_KIND>;

/**
 * What the arbiter decided about a request, as the development trace records
 * it: the four outcomes the mouth can report, plus the three moments only the
 * arbiter sees. Nothing worded is ever traced beside one.
 */
export const SPEECH_DECISION = {
  REQUESTED: "requested",
  OFFERED: "offered",
  DROPPED: "dropped",
  RECLAIMED: "reclaimed",
  ...SPEECH_OUTCOME,
} as const;

export type SpeechDecision = (typeof SPEECH_DECISION)[keyof typeof SPEECH_DECISION];

/**
 * One proactive turn waiting to be offered. An utterance keeps the words the
 * brain decided; a beat is its kind alone, worded by the mouth at speak time
 * from what the renderer already draws.
 */
export type SpeechRequest = {
  id: string;
  requestedAt: number;
  /** Whether the request waits out the announcement hold rather than the clock; only a beat ever does. */
  held: boolean;
} & (
  | { kind: typeof UTTERANCE_SPEECH_KIND; utterance: BrainUtterance }
  | { kind: typeof ARRIVAL_SPEECH_KIND }
  | { kind: typeof CALENDAR_ONBOARDING_SPEECH_KIND }
);

export type SpeechRequestInput =
  | { kind: typeof UTTERANCE_SPEECH_KIND; utterance: BrainUtterance }
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
  return request.kind !== UTTERANCE_SPEECH_KIND;
}

/**
 * The one owner of everything Luke says unprompted: which requests stand,
 * in what order, whether now, and what became of each. The mouth in the
 * renderer holds at most one offer at a time and reports its outcome by id;
 * only then is the next offered. A renderer therefore holds nothing a reload
 * or a hold can destroy.
 *
 * Quiet — the developer's pause or a meeting's — is applied here and only
 * here, and it is a wall, not a waiting room. A beat arriving under it, or
 * standing when it begins, is marked held and released with a fresh clock
 * when the quiet ends. An utterance is not held at all: one arriving under
 * quiet, standing when it begins, or coming back from the mouth held is
 * dropped, because the sessions move on while a meeting runs and the words
 * were decided against a roster that no longer stands. The brain is not
 * ticked while quiet stands, and the first tick after it sees everything
 * that changed across the quiet and decides afresh.
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

  get pendingCount(): number {
    return this.#pending.length;
  }

  get offeredId(): string | undefined {
    return this.#offered?.id;
  }

  /**
   * Takes one turn something decided to voice. A beat already pending,
   * offered, or spent this run is dropped: each is one line, said once. An
   * utterance under quiet is dropped; otherwise it joins the backlog, and the
   * backlog sheds its oldest whole past the bound — an utterance is one
   * sentence the brain already worded, with no half to keep — except the one
   * the mouth already holds, which is settled by the mouth and never taken
   * out from under it.
   */
  request(input: SpeechRequestInput): void {
    const now = this.#options.now();
    if (input.kind !== UTTERANCE_SPEECH_KIND) {
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
    if (this.#quiet) {
      this.#trace(UTTERANCE_SPEECH_KIND, SPEECH_DECISION.DROPPED);
      return;
    }
    this.#pending.push({
      id: this.#options.nextId(),
      requestedAt: now,
      held: false,
      kind: UTTERANCE_SPEECH_KIND,
      utterance: input.utterance,
    });
    this.#trace(UTTERANCE_SPEECH_KIND, SPEECH_DECISION.REQUESTED);
    let excess = this.#utteranceCount() - MAXIMUM_PENDING_UTTERANCES;
    while (excess > 0) {
      const oldest = this.#pending.find(
        (request) => request.kind === UTTERANCE_SPEECH_KIND && request.id !== this.#offered?.id,
      );
      if (!oldest) return;
      this.#remove(oldest.id);
      this.#trace(UTTERANCE_SPEECH_KIND, SPEECH_DECISION.DROPPED);
      excess -= 1;
    }
  }

  /**
   * Follows the announcement hold. Quiet beginning marks every pending beat
   * held and drops every pending utterance that has not reached the mouth;
   * the one the mouth holds comes back through its HELD settle and is dropped
   * there. Quiet ending releases the beats with a fresh clock, so a beat that
   * waited out a meeting is not stale the moment it may speak.
   */
  setQuiet(quiet: boolean): void {
    if (quiet === this.#quiet) return;
    this.#quiet = quiet;
    if (quiet) {
      for (const request of [...this.#pending]) {
        if (isBeat(request)) {
          request.held = true;
          continue;
        }
        if (request.id === this.#offered?.id) continue;
        this.#remove(request.id);
        this.#trace(UTTERANCE_SPEECH_KIND, SPEECH_DECISION.DROPPED);
      }
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
   * Withdraws every utterance, the one the mouth holds included: the
   * generation that decided them has been cleared or has died, or no brain
   * stands any more, and words not yet spoken are that generation's. An offer
   * is not proof the words were said, so the offered one goes too, and its
   * id is answered so the caller can take it back from the mouth; a settle
   * that still arrives for it is a late report and is ignored. Speech already
   * begun is the mouth's to finish.
   */
  withdrawUtterances(): string | undefined {
    let offered: string | undefined;
    for (const request of [...this.#pending]) {
      if (request.kind !== UTTERANCE_SPEECH_KIND) continue;
      if (request.id === this.#offered?.id) {
        offered = request.id;
        this.#offered = undefined;
      }
      this.#remove(request.id);
      this.#trace(UTTERANCE_SPEECH_KIND, SPEECH_DECISION.DROPPED);
    }
    return offered;
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
   * Takes back the outstanding offer from a receiver that is gone — the voice
   * renderer reloaded, crashed, or was replaced with the offer in hand — and
   * returns the request to the head unspoken, so the next receiver is offered
   * it at once rather than after the deadline. Nothing here says whether the
   * words were heard: an offer is not proof of speech, and a proactive turn
   * said twice across a crash is the price of not losing it altogether. The
   * request takes a fresh id on the way back, so the old offer's id is dead.
   */
  reclaimOffer(): void {
    const offered = this.#offered;
    if (!offered) return;
    this.#offered = undefined;
    const request = this.#pending.find((candidate) => candidate.id === offered.id);
    if (!request) return;
    // Under a fresh id, so a settle the vanished renderer still had in flight
    // names an offer nobody holds, rather than the one about to be made.
    request.id = this.#options.nextId();
    this.#trace(request.kind, SPEECH_DECISION.RECLAIMED);
  }

  /**
   * Offers the head request, or nothing. An outstanding offer whose deadline
   * has passed unsettled is settled stale here first: this is the whole
   * recovery from a renderer that reloaded, crashed, or lost the settle.
   * Nothing is offered under quiet or while an offer stands. Unheld requests
   * past their age are settled stale on the way; a held beat waits out the
   * hold, not the clock, and is never offered until the quiet ends.
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
   * drops an utterance, whose words were decided against a roster the quiet
   * lets move on; a beat it keeps at the head for the release — or, reported
   * while no quiet stands here, unheld, so the next reconcile offers it
   * again: the mouth read a hold the panel still drew after it had ended, and
   * a beat marked held against a quiet already gone would wait for a release
   * that can never come. REFUSED is a call that could not be opened within
   * its attempts, which ends every pending request: each is still standing in
   * the panel, and a fresh request starts a fresh backlog.
   */
  settle(id: string, outcome: SpeechOutcome): SpeechSettlement | undefined {
    if (this.#offered?.id !== id) return undefined;
    const request = this.#pending.find((candidate) => candidate.id === id);
    this.#offered = undefined;
    if (!request) return undefined;
    switch (outcome) {
      case SPEECH_OUTCOME.HELD:
        if (isBeat(request)) {
          request.held = this.#quiet;
          this.#trace(request.kind, SPEECH_OUTCOME.HELD);
          break;
        }
        this.#remove(id);
        this.#trace(request.kind, SPEECH_DECISION.DROPPED);
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

  #utteranceCount(): number {
    return this.#pending.filter((request) => request.kind === UTTERANCE_SPEECH_KIND).length;
  }

  /** When the request became news: an utterance's decision, a beat's request. */
  #decidedAt(request: SpeechRequest): number {
    return request.kind === UTTERANCE_SPEECH_KIND
      ? request.utterance.decidedAt
      : request.requestedAt;
  }

  #turn(request: SpeechRequest): ProactiveSpeechTurn {
    switch (request.kind) {
      case UTTERANCE_SPEECH_KIND:
        return {
          kind: UTTERANCE_SPEECH_KIND,
          text: request.utterance.text,
          decidedAt: request.utterance.decidedAt,
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
