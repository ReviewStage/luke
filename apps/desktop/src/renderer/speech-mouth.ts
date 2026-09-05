import type { ProactiveSpeechTurn, RealtimeStatus, ScheduledTimer } from "@sidecar/realtime";
import { REALTIME_STATUS } from "@sidecar/realtime";
import { SPEECH_OUTCOME, type SpeechOffer, type SpeechOutcome } from "#shared/wire/speech";

/**
 * How long Luke's own call lingers once what it was opened for has been said.
 * Sessions finish in clusters — one merge often ends three agents — so the
 * call waits for the stragglers rather than paying the handshake three times,
 * and then puts itself away.
 */
export const ANNOUNCER_LINGER_MS = 60_000;

/**
 * How long an offer waits after a refused call before trying again. The
 * refusal this exists for is the transient kind — a rate limit at the voice
 * service, a network mid-blink — where seconds are the difference between an
 * announcement arriving late and not arriving at all.
 */
export const ANNOUNCER_RETRY_DELAY_MS = 20_000;

/**
 * How many times one offer may try to open Luke's own call. Together with the
 * offer's own deadline this is what keeps a persistent refusal from becoming
 * a loop: the attempts run out and the offer is settled refused, and anything
 * the arbiter still holds has aged out of being news long before a fourth try
 * could matter.
 */
export const MAXIMUM_CONNECT_ATTEMPTS = 3;

/**
 * How long the developer keeps the floor once Luke has answered them. A reply
 * invites the next ask, and an announcement speaking into that pause takes
 * the very turn the developer was about to open — so the mouth waits, and
 * only a pause the developer leaves empty is announced into. Luke's own
 * announcements chain without waiting: the readout is already his turn, and
 * a backlog read one sentence per window would outlive its own news.
 */
export const ANNOUNCER_GRACE_MS = 10_000;

/**
 * The slice of the voice session the mouth drives. `microphoneCall` is the
 * ownership question: true means the call up or coming is the developer's own,
 * which the mouth may speak on but must never close.
 */
export interface SpeechMouthSession {
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly status: RealtimeStatus;
  readonly microphoneCall: boolean;
  connect(options: { microphone: false }): Promise<boolean>;
  speak(speech: ProactiveSpeechTurn): boolean;
  stopSpeaking(): boolean;
  close(): Promise<void>;
}

export interface SpeechMouthOptions {
  session: () => SpeechMouthSession;
  /** Reports what became of an offer, by its id, so the arbiter can offer the next. */
  settle: (id: string, outcome: SpeechOutcome) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

/**
 * Speaks the one proactive turn the speech arbiter has offered, whether or
 * not a conversation is open, and reports what became of it. The mouth holds
 * no backlog: the arbiter in the main process owns every pending request and
 * offers the next only once this one is settled, so nothing a reload, a
 * hold, or a refused call meets here is anything but the one offer in hand.
 *
 * An offer arriving while the developer's call is up rides it. One arriving
 * into silence is what this class exists for: it opens a call of Luke's own —
 * speak-only, no microphone, no context — says the turn as one reply, lingers
 * briefly for the next offer the same cluster of finishes usually brings, and
 * closes the call it opened. It never closes the developer's call.
 *
 * A call that is refused keeps the offer and tries again on a short clock,
 * because the refusal this path actually meets is transient — a rate limit,
 * a network mid-blink — and a first-try-only mouth turns each one into
 * permanent silence. The retry cannot become a loop: the attempts are capped
 * per offer, and past them the offer is settled refused rather than kept.
 *
 * The announcement hold reaches it through {@link setHeld}: a hold beginning
 * — the developer's pause or a meeting's quiet — silences it at once, the
 * announcement mid-sentence on Luke's own call included, and hands an offer
 * not yet begun back to the arbiter as held, where it waits for the release.
 *
 * On the developer's own call, a reply Luke just gave them holds the offer
 * for {@link ANNOUNCER_GRACE_MS}: the pause after an answer is where the
 * developer's next ask lives, and an announcement speaking into it takes
 * that turn from them. Luke's own announcements chain without the wait — the
 * readout is already his turn.
 */
export class SpeechMouth {
  readonly #options: SpeechMouthOptions;
  /** The one offer in hand, until it is spoken, refused, held, stale, or withdrawn. */
  #current: SpeechOffer | undefined;
  /** Whether the call now up is one this mouth opened, and so must close. */
  #ownsCall = false;
  /** The last status seen, which tells a reply's READY from a connect's. */
  #lastStatus: RealtimeStatus | undefined;
  /** Whether the reply now under way — or just ended — is one this mouth spoke. */
  #ownReply = false;
  /** Until when the developer keeps the floor, as the injected clock reads it. */
  #holdUntil = 0;
  #holdTimer: unknown;
  #lingerTimer: unknown;
  /** How many times the offer now in hand has tried to open Luke's own call. */
  #connectAttempts = 0;
  #retryTimer: unknown;
  /**
   * Whether the hold, as the panel last drew it, is standing. Read by nothing
   * that decides whether to speak: the main process is the authority on the
   * quiet and never offers under it, and the panel's copy reaches here a
   * render behind, so gating an offer on it would hand a released beat back
   * held against a quiet that had already ended. It stands only so a hold
   * beginning can cut a reply and settle the unspoken offer.
   */
  #quiet = false;

  constructor(options: SpeechMouthOptions) {
    this.#options = options;
  }

  /**
   * Follows the announcement hold the main process decided. A hold beginning
   * — the pause switched on, the quiet switched on mid-meeting, or a meeting
   * starting under it — is asked-for silence right now: the announcement
   * mid-sentence on Luke's own call is cut off and the call closed rather
   * than left lingering into the hold, and an offer not yet begun goes back
   * to the arbiter as held rather than being dropped — it is the arbiter's
   * to keep for the release. The developer's own call is never touched: a
   * conversation they are holding passes, held or not. A hold ending needs
   * no act here — the arbiter offers what it held when the quiet ends.
   */
  setHeld(active: boolean): void {
    this.#quiet = active;
    if (!active) return;
    this.#settleCurrent(SPEECH_OUTCOME.HELD);
    this.#connectAttempts = 0;
    this.#cancelRetry();
    this.#cancelHold();
    this.#cancelLinger();
    if (!this.#ownsCall) return;
    this.#ownsCall = false;
    const session = this.#options.session();
    if (session.microphoneCall) return;
    session.stopSpeaking();
    void session.close();
  }

  /**
   * Takes the one turn the arbiter decided to voice, and starts saying it. The
   * same offer again is the same offer; the arbiter never sends a second while
   * one is outstanding, so there is no displacement to decide. An offer is
   * never refused for a quiet the panel still draws: the arbiter offers only
   * once the quiet has ended, and its word outranks the render behind.
   */
  offer(offer: SpeechOffer): void {
    if (this.#current?.id === offer.id) return;
    this.#current = offer;
    this.#connectAttempts = 0;
    this.#cancelLinger();
    this.#flush();
  }

  /**
   * Takes back an offer not yet begun: the beat's reason has gone, and a
   * sentence asking for what was just given would speak over the answer. No
   * settle is reported — the arbiter already forgot the id. A reply already
   * begun is not this offer any more and finishes.
   */
  withdraw(id: string): void {
    if (this.#current?.id !== id) return;
    this.#current = undefined;
    this.#connectAttempts = 0;
    this.#cancelRetry();
    this.#armLinger();
  }

  /**
   * Follows the session's status, which is the mouth's only clock: READY
   * is when the offer in hand can be spoken and when an empty hand starts the
   * linger toward closing Luke's own call.
   */
  onStatus(status: RealtimeStatus): void {
    const previous = this.#lastStatus;
    this.#lastStatus = status;
    // The developer's call replaced or absorbed Luke's; nothing here may
    // close it, however it ends.
    if (this.#options.session().microphoneCall) {
      this.#ownsCall = false;
      this.#cancelLinger();
    }
    // The developer taking the turn is the very act the floor was theirs for:
    // whatever reply follows is an answer to them, not a readout, and the
    // clock waiting to speak into their pause has nothing left to wait for —
    // the reply's own end starts the next window.
    if (status === REALTIME_STATUS.LISTENING) {
      this.#ownReply = false;
      this.#cancelHold();
      return;
    }
    if (status === REALTIME_STATUS.READY) {
      const own = this.#ownReply;
      this.#ownReply = false;
      // A reply to the developer invites their next ask, and an announcement
      // speaking into that pause takes the very turn they were about to
      // open: the floor stays the developer's for the grace window, and only
      // a pause they leave empty is announced into. Only a READY that ends a
      // reply holds the floor — one that opens the call has answered nothing.
      if (
        !own &&
        previous === REALTIME_STATUS.RESPONDING &&
        this.#options.session().microphoneCall
      ) {
        this.#holdUntil = (this.#options.now?.() ?? Date.now()) + ANNOUNCER_GRACE_MS;
        // A fresh window gets a fresh clock: one still armed for an older
        // window would come back early and find the floor still held.
        this.#cancelHold();
      }
      this.#flush();
      return;
    }
    if (
      status === REALTIME_STATUS.IDLE ||
      status === REALTIME_STATUS.FAILED ||
      status === REALTIME_STATUS.UNAVAILABLE
    ) {
      this.#cancelLinger();
      // The conversation the floor was being held for is gone with the call.
      this.#cancelHold();
      this.#holdUntil = 0;
      this.#ownReply = false;
      this.#ownsCall = false;
      // The offer survives the call it was waiting on — a developer's call
      // that ended mid-wait, or Luke's own that dropped — and the retry clock
      // is what picks it back up. The connect path arms the same clock when an
      // open is refused, so arming here is idempotent.
      this.#armRetry();
    }
  }

  #flush(): void {
    const now = this.#options.now?.() ?? Date.now();
    // The deadline is read at the last moment, so news that waited out a long
    // reply is settled stale rather than read as though it just happened.
    if (this.#current && now > this.#current.speakBy) {
      this.#settleCurrent(SPEECH_OUTCOME.STALE);
    }
    const session = this.#options.session();
    if (!this.#current) {
      this.#connectAttempts = 0;
      this.#armLinger();
      return;
    }
    if (session.isConnected) {
      // The developer keeps the floor for the grace window after Luke answers
      // them; the offer comes back when the window closes.
      const floorHeld = this.#holdUntil - now;
      if (floorHeld > 0 && session.microphoneCall) {
        this.#armHold(floorHeld);
        return;
      }
      if (session.speak(this.#current.turn)) {
        this.#ownReply = true;
        this.#settleCurrent(SPEECH_OUTCOME.SPOKEN);
        return;
      }
      // An offer waiting on a refused speak is normally resumed by the READY
      // edge, but that edge is the session's promise, not this class's: the
      // retry clock keeps the offer from depending on it. Redundant on the
      // ordinary path — the edge lands first and says everything — and what
      // stands between an announcement and permanent silence when it does not.
      this.#armRetry();
      return;
    }
    if (session.isConnecting) return;
    // Silence, and something to say into it: open a call of Luke's own.
    this.#connectAttempts += 1;
    this.#ownsCall = true;
    void session
      .connect({ microphone: false })
      .then((opened) => {
        if (opened) {
          this.#connectAttempts = 0;
          this.#flush();
          return;
        }
        this.#ownsCall = false;
        this.#retreatOrRetry();
      })
      .catch(() => {
        this.#ownsCall = false;
        this.#retreatOrRetry();
      });
  }

  /**
   * Decides what a refused connect leaves behind. An offer still owed a try
   * keeps it, on the retry clock; one that has had its tries is settled
   * refused here, at the moment of the final refusal, so the next offer
   * starts with tries of its own rather than dying against a spent counter.
   * What is refused is still standing in the panel.
   */
  #retreatOrRetry(): void {
    if (this.#connectAttempts >= MAXIMUM_CONNECT_ATTEMPTS) {
      this.#settleCurrent(SPEECH_OUTCOME.REFUSED);
      this.#connectAttempts = 0;
      return;
    }
    this.#armRetry();
  }

  /** Hands the offer in hand back to the arbiter with its outcome, and empties the hand. */
  #settleCurrent(outcome: SpeechOutcome): void {
    const current = this.#current;
    if (!current) return;
    this.#current = undefined;
    this.#options.settle(current.id, outcome);
  }

  /**
   * Starts the clock on another try at an offer whose call could not open or
   * did not last. Idempotent, because a refused connect and the failed status
   * it causes both land here; the offer's own deadline and the attempt cap
   * in {@link #retreatOrRetry} are what keep the clock from ticking forever.
   */
  #armRetry(): void {
    if (!this.#current) return;
    this.#retryTimer ??= (this.#options.schedule ?? setTimeout)(() => {
      this.#retryTimer = undefined;
      this.#flush();
    }, ANNOUNCER_RETRY_DELAY_MS);
  }

  /** Comes back for the offer once the developer's floor window closes. */
  #armHold(delayMs: number): void {
    this.#holdTimer ??= (this.#options.schedule ?? setTimeout)(() => {
      this.#holdTimer = undefined;
      this.#flush();
    }, delayMs);
  }

  #cancelHold(): void {
    if (this.#holdTimer === undefined) return;
    // SAFETY: The handle is whatever `schedule ?? setTimeout` returned, and the
    // fallbacks are paired — a handle from `setTimeout` can only reach
    // `clearTimeout`. The cast satisfies that signature; nothing reads it as a
    // number.
    (this.#options.cancel ?? clearTimeout)(this.#holdTimer as number);
    this.#holdTimer = undefined;
  }

  #cancelRetry(): void {
    if (this.#retryTimer === undefined) return;
    // SAFETY: The handle is whatever `schedule ?? setTimeout` returned, and the
    // fallbacks are paired — a handle from `setTimeout` can only reach
    // `clearTimeout`. The cast satisfies that signature; nothing reads it as a
    // number.
    (this.#options.cancel ?? clearTimeout)(this.#retryTimer as number);
    this.#retryTimer = undefined;
  }

  #armLinger(): void {
    const session = this.#options.session();
    if (!this.#ownsCall || !session.isConnected || session.microphoneCall) return;
    if (session.status !== REALTIME_STATUS.READY) return;
    this.#lingerTimer ??= (this.#options.schedule ?? setTimeout)(() => {
      this.#lingerTimer = undefined;
      this.#closeOwnCall();
    }, ANNOUNCER_LINGER_MS);
  }

  #cancelLinger(): void {
    if (this.#lingerTimer === undefined) return;
    // SAFETY: The handle is whatever `schedule ?? setTimeout` returned, and the
    // fallbacks are paired — a handle from `setTimeout` can only reach
    // `clearTimeout`. The cast satisfies that signature; nothing reads it as a
    // number.
    (this.#options.cancel ?? clearTimeout)(this.#lingerTimer as number);
    this.#lingerTimer = undefined;
  }

  #closeOwnCall(): void {
    const session = this.#options.session();
    // Everything is re-checked at the moment of closing, because a minute is
    // long: the developer may have taken the call, or something new may be
    // offered and about to speak.
    if (!this.#ownsCall || !session.isConnected || session.microphoneCall) return;
    if (this.#current !== undefined || session.status !== REALTIME_STATUS.READY) return;
    this.#ownsCall = false;
    void session.close();
  }
}
