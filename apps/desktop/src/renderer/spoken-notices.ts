import type { AttentionSpeech, RealtimeStatus } from "@sidecar/core";
import { REALTIME_STATUS, type UnparsedWireValue } from "@sidecar/core";

/**
 * How long a notice stays worth saying. News about a session is news for
 * minutes, not for whenever a long conversation happens to end: a sentence
 // SAFETY: The preceding check establishes the asserted contract.
 * older than this is dropped rather than read out as though it just happened —
 * the panel has shown the state the whole time.
 */
export const SPOKEN_NOTICE_MAX_AGE_MS = 2 * 60_000;

/**
 * How long Luke's own call lingers once everything queued has been said.
 * Sessions finish in clusters — one merge often ends three agents — so the
 * call waits for the stragglers rather than paying the handshake three times,
 * and then puts itself away.
 */
export const ANNOUNCER_LINGER_MS = 60_000;

/** A backlog is stale news read in order; only this many notices ever wait. */
export const MAXIMUM_QUEUED_NOTICES = 8;

/**
 * How long a backlog waits after a refused call before trying again. The
 * refusal this exists for is the transient kind — a rate limit at the voice
 * service, a network mid-blink — where seconds are the difference between an
 * announcement arriving late and not arriving at all.
 */
export const ANNOUNCER_RETRY_DELAY_MS = 20_000;

/**
 * How many times one backlog may try to open Luke's own call. Together with
 * {@link SPOKEN_NOTICE_MAX_AGE_MS} this is what keeps a persistent refusal
 * from becoming a loop: the attempts run out, and anything still queued has
 * aged out of being news long before a fourth try could matter.
 */
export const MAXIMUM_CONNECT_ATTEMPTS = 3;

/**
 * The slice of the voice session the announcer drives. `microphoneCall` is the
 * ownership question: true means the call up or coming is the developer's own,
 * which the announcer may speak on but must never close.
 */
export interface AnnouncerSession {
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly status: RealtimeStatus;
  readonly microphoneCall: boolean;
  connect(options: { microphone: false }): Promise<boolean>;
  speak(speech: AttentionSpeech): boolean;
  stopSpeaking(): boolean;
  close(): Promise<void>;
}

export interface SpokenNoticeAnnouncerOptions {
  session: () => AnnouncerSession;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: UnparsedWireValue) => void;
}

/**
 * Speaks proactive notices whether or not a conversation is open.
 *
 * A notice arriving while the developer's call is up rides it, exactly as
 * attention speech always has. One arriving into silence is what this class
 * exists for: it opens a call of Luke's own — speak-only, no microphone, no
 * context — reads the queue out one reply at a time, lingers briefly for the
 * cluster of finishes that usually follows the first, and closes the call it
 * opened. It never closes the developer's call.
 *
 * A call that is refused keeps the backlog and tries again on a short clock,
 * because the refusal this path actually meets is transient — a rate limit,
 * a network mid-blink — and a first-try-only announcer turns each one into
 * permanent silence. The retry cannot become a loop: the attempts are capped
 * per backlog, and every queued sentence ages out of being news regardless.
 * A backlog that outlives its attempts is dropped, because every notice is
 * still standing in the panel.
 *
 * The meeting quiet reaches it through {@link setMeetingQuiet}: quiet
 * beginning silences it at once — the announcement mid-sentence on Luke's
 * own call included — and holds it silent until the quiet ends.
 */
export class SpokenNoticeAnnouncer {
  readonly #options: SpokenNoticeAnnouncerOptions;
  #queue: AttentionSpeech[] = [];
  /** Whether the call now up is one this announcer opened, and so must close. */
  #ownsCall = false;
  #lingerTimer: unknown;
  /** How many times the backlog now queued has tried to open Luke's own call. */
  #connectAttempts = 0;
  #retryTimer: unknown;
  /** Whether the meeting quiet is holding, which silences this announcer. */
  #quiet = false;

  constructor(options: SpokenNoticeAnnouncerOptions) {
    this.#options = options;
  }

  /**
   * Follows the meeting quiet the main process decided. Quiet beginning —
   * the setting switched on mid-meeting, or a meeting starting under it — is
   * asked-for silence right now: the announcement mid-sentence on Luke's own
   * call is cut off and the call closed rather than left lingering into the
   * meeting, and the backlog is dropped rather than played — every notice in
   * it is still standing in the panel, and anything decided from here waits
   * in the main process for the release. The developer's own call is never
   * touched: a conversation they are holding passes, meeting or not. Quiet
   * ending needs no act here — the main process re-sends what the meeting
   // SAFETY: The preceding check establishes the asserted contract.
   * held, and that arrives as a fresh backlog.
   */
  setMeetingQuiet(active: boolean): void {
    this.#quiet = active;
    if (!active) return;
    this.#queue = [];
    this.#connectAttempts = 0;
    this.#cancelRetry();
    this.#cancelLinger();
    if (!this.#ownsCall) return;
    this.#ownsCall = false;
    const session = this.#options.session();
    if (session.microphoneCall) return;
    session.stopSpeaking();
    void session.close();
  }

  /** Takes notices the main process decided to voice, and starts saying them. */
  enqueue(notices: readonly AttentionSpeech[]): void {
    if (this.#quiet || notices.length === 0) return;
    this.#queue.push(...notices);
    // The oldest waiting sentence is the least newsworthy one; a bounded queue
    // sheds from the front.
    if (this.#queue.length > MAXIMUM_QUEUED_NOTICES) {
      this.#queue = this.#queue.slice(this.#queue.length - MAXIMUM_QUEUED_NOTICES);
    }
    this.#cancelLinger();
    this.#flush();
  }

  /**
   * Follows the session's status, which is the announcer's only clock: READY
   * is when a queued sentence can be spoken and when an empty queue starts the
   * linger toward closing Luke's own call.
   */
  onStatus(status: RealtimeStatus): void {
    // The developer's call replaced or absorbed Luke's; nothing here may
    // close it, however it ends.
    if (this.#options.session().microphoneCall) {
      this.#ownsCall = false;
      this.#cancelLinger();
    }
    if (status === REALTIME_STATUS.READY) {
      this.#flush();
      return;
    }
    if (
      status === REALTIME_STATUS.IDLE ||
      status === REALTIME_STATUS.FAILED ||
      status === REALTIME_STATUS.UNAVAILABLE
    ) {
      this.#cancelLinger();
      this.#ownsCall = false;
      // The backlog survives the call it was waiting on — a developer's call
      // that ended mid-queue, or Luke's own that dropped — and the retry clock
      // is what picks it back up. The connect path arms the same clock when an
      // open is refused, so arming here is idempotent.
      this.#armRetry();
    }
  }

  #flush(): void {
    // Quiet holds everything: nothing may speak, and an empty queue must not
    // start the linger toward closing a call the quiet already closed.
    if (this.#quiet) return;
    const now = this.#options.now?.() ?? Date.now();
    this.#queue = this.#queue.filter((item) => now - item.decidedAt <= SPOKEN_NOTICE_MAX_AGE_MS);
    const session = this.#options.session();
    if (this.#queue.length === 0) {
      this.#connectAttempts = 0;
      this.#armLinger();
      return;
    }
    if (session.isConnected) {
      // One reply at a time: the first speak takes the turn and the second is
      // refused, so the loop stops itself and READY resumes it.
      // SAFETY: The preceding check establishes the asserted contract.
      while (this.#queue.length > 0 && session.speak(this.#queue[0] as AttentionSpeech)) {
        this.#queue.shift();
      }
      // A backlog waiting on a refused speak is normally resumed by the READY
      // edge, but that edge is the session's promise, not this class's: the
      // retry clock keeps the backlog from depending on it. Redundant on the
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
   * Decides what a refused connect leaves behind. A backlog still owed a try
   * keeps it, on the retry clock; one that has had its tries is dropped here,
   * at the moment of the final refusal, so notices arriving afterwards start
   * a fresh backlog with tries of its own rather than dying against a spent
   * counter. What is dropped is still standing in the panel.
   */
  #retreatOrRetry(): void {
    if (this.#connectAttempts >= MAXIMUM_CONNECT_ATTEMPTS) {
      this.#queue = [];
      this.#connectAttempts = 0;
      return;
    }
    this.#armRetry();
  }

  /**
   * Starts the clock on another try at a backlog whose call could not open or
   * did not last. Idempotent, because a refused connect and the failed status
   * it causes both land here; the queue's own age filter and the attempt cap
   * in {@link #retreatOrRetry} are what keep the clock from ticking forever.
   */
  #armRetry(): void {
    if (this.#queue.length === 0) return;
    this.#retryTimer ??= (this.#options.schedule ?? setTimeout)(() => {
      this.#retryTimer = undefined;
      this.#flush();
    }, ANNOUNCER_RETRY_DELAY_MS);
  }

  #cancelRetry(): void {
    if (this.#retryTimer === undefined) return;
    // SAFETY: The preceding check establishes the asserted contract.
    (this.#options.cancel ?? clearTimeout)(this.#retryTimer as Parameters<typeof clearTimeout>[0]);
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
    // SAFETY: The preceding check establishes the asserted contract.
    (this.#options.cancel ?? clearTimeout)(this.#lingerTimer as Parameters<typeof clearTimeout>[0]);
    this.#lingerTimer = undefined;
  }

  #closeOwnCall(): void {
    const session = this.#options.session();
    // Everything is re-checked at the moment of closing, because a minute is
    // long: the developer may have taken the call, or something new may be
    // queued and about to speak.
    if (!this.#ownsCall || !session.isConnected || session.microphoneCall) return;
    if (this.#queue.length > 0 || session.status !== REALTIME_STATUS.READY) return;
    this.#ownsCall = false;
    void session.close();
  }
}
