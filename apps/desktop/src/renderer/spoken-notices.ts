import type { AttentionSpeech, RealtimeStatus } from "@sidecar/core";
import { REALTIME_STATUS } from "@sidecar/core";

/**
 * How long a notice stays worth saying. News about a session is news for
 * minutes, not for whenever a long conversation happens to end: a sentence
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
  speak(speech: readonly AttentionSpeech[]): boolean;
  close(): Promise<void>;
}

export interface SpokenNoticeAnnouncerOptions {
  session: () => AnnouncerSession;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/**
 * Speaks proactive notices whether or not a conversation is open.
 *
 * A notice arriving while the developer's call is up rides it, exactly as
 * attention speech always has. One arriving into silence is what this class
 * exists for: it opens a call of Luke's own — speak-only, no microphone, no
 * context — reads the queue out one reply at a time, lingers briefly for the
 * cluster of finishes that usually follows the first, and closes the call it
 * opened. It never closes the developer's call, and it never retries a
 * connection that answered: a queue that cannot be delivered is dropped,
 * because every notice is still standing in the panel.
 */
export class SpokenNoticeAnnouncer {
  readonly #options: SpokenNoticeAnnouncerOptions;
  #queue: AttentionSpeech[] = [];
  /** Whether the call now up is one this announcer opened, and so must close. */
  #ownsCall = false;
  #lingerTimer: unknown;

  constructor(options: SpokenNoticeAnnouncerOptions) {
    this.#options = options;
  }

  /** Takes notices the main process decided to voice, and starts saying them. */
  enqueue(notices: readonly AttentionSpeech[]): void {
    if (notices.length === 0) return;
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
      // A call that failed or was refused is not retried into a loop; the
      // notices it would have carried are still shown in the panel.
      if (status !== REALTIME_STATUS.IDLE) this.#queue = [];
    }
  }

  #flush(): void {
    const now = this.#options.now?.() ?? Date.now();
    this.#queue = this.#queue.filter((item) => now - item.decidedAt <= SPOKEN_NOTICE_MAX_AGE_MS);
    const session = this.#options.session();
    if (this.#queue.length === 0) {
      this.#armLinger();
      return;
    }
    if (session.isConnected) {
      // One reply at a time: the first speak takes the turn and the second is
      // refused, so the loop stops itself and READY resumes it.
      // Everything waiting goes as one turn. A turn already under way refuses
      // the next, so sentences handed over one at a time would leave all but
      // the first unsaid — and a hold that has just ended is exactly when
      // several are waiting at once. A refusal keeps the queue for the next
      // READY rather than dropping it.
      if (session.speak(this.#queue)) this.#queue = [];
      return;
    }
    if (session.isConnecting) return;
    // Silence, and something to say into it: open a call of Luke's own.
    this.#ownsCall = true;
    void session
      .connect({ microphone: false })
      .then((opened) => {
        if (opened) {
          this.#flush();
          return;
        }
        this.#ownsCall = false;
        this.#queue = [];
      })
      .catch(() => {
        this.#ownsCall = false;
        this.#queue = [];
      });
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
