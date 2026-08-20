import type { AttentionSpeech, RealtimeStatus, ScheduledTimer } from "@sidecar/realtime";
import { REALTIME_STATUS } from "@sidecar/realtime";

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
 * How long the developer keeps the floor once Luke has answered them. A reply
 * invites the next ask, and an announcement speaking into that pause takes
 * the very turn the developer was about to open — so the queue waits, and
 * only a pause the developer leaves empty is announced into. Luke's own
 * announcements chain without waiting: the readout is already his turn, and
 * a backlog read one sentence per window would outlive its own news.
 */
export const ANNOUNCER_GRACE_MS = 10_000;

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
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
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
 * An evaluator summary is a narrower passenger. It may only ride the
 * developer's own call — never open one — so it waits here for that call's
 * next READY edge instead of being refused against a busy turn and lost:
 * one review pass can decide several summaries at once, and the first
 * taking the turn left the rest nowhere to go. The wait is the call's own:
 * a summary is dropped the moment the developer's call ends, ages out like
 * a notice does, and yields every edge to the notices the developer asked
 * to hear.
 *
 * The meeting quiet reaches it through {@link setMeetingQuiet}: quiet
 * beginning silences it at once — the announcement mid-sentence on Luke's
 * own call included — and holds it silent until the quiet ends.
 *
 * On the developer's own call, a reply Luke just gave them holds the whole
 * backlog for {@link ANNOUNCER_GRACE_MS}: the pause after an answer is where
 * the developer's next ask lives, and an announcement speaking into it takes
 * that turn from them. Luke's own announcements chain without the wait — the
 * readout is already his turn.
 */
export class SpokenNoticeAnnouncer {
  readonly #options: SpokenNoticeAnnouncerOptions;
  #queue: AttentionSpeech[] = [];
  /**
   * Evaluator summaries waiting for the developer's own call to pause. They
   * may only ride that call: nothing here opens one for them, and they are
   * dropped the moment the call they were waiting on ends.
   */
  #rideQueue: AttentionSpeech[] = [];
  /** Whether the call now up is one this announcer opened, and so must close. */
  #ownsCall = false;
  /** The last status seen, which tells a reply's READY from a connect's. */
  #lastStatus: RealtimeStatus | undefined;
  /** Whether the reply now under way — or just ended — is one this announcer spoke. */
  #ownReply = false;
  /** Until when the developer keeps the floor, as the injected clock reads it. */
  #holdUntil = 0;
  #holdTimer: unknown;
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
   * held, and that arrives as a fresh backlog.
   */
  setMeetingQuiet(active: boolean): void {
    this.#quiet = active;
    if (!active) return;
    this.#queue = [];
    this.#rideQueue = [];
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
   * Takes evaluator summaries, which may only ride the developer's open call.
   * A summary arriving while Luke is mid-reply — or several deciding at once,
   * which one review pass can produce — waits for the READY edge the queue
   * already paces itself by, instead of being refused against the busy turn
   * and lost. Nothing here may open a call: a summary with no developer's
   * call to ride is dropped, still standing in the panel.
   */
  enqueueRide(summaries: readonly AttentionSpeech[]): void {
    if (this.#quiet || summaries.length === 0) return;
    if (!this.#options.session().microphoneCall) return;
    this.#rideQueue.push(...summaries);
    if (this.#rideQueue.length > MAXIMUM_QUEUED_NOTICES) {
      this.#rideQueue = this.#rideQueue.slice(this.#rideQueue.length - MAXIMUM_QUEUED_NOTICES);
    }
    this.#flush();
  }

  /**
   * Follows the session's status, which is the announcer's only clock: READY
   * is when a queued sentence can be spoken and when an empty queue starts the
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
      // The call a summary was riding is gone, and it may ride no other:
      // what it said is still standing in the panel.
      this.#rideQueue = [];
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
    // A summary may only ride the developer's own call, so the call no longer
    // being theirs takes the wait with it, and age fells the rest.
    this.#rideQueue = session.microphoneCall
      ? this.#rideQueue.filter((item) => now - item.decidedAt <= SPOKEN_NOTICE_MAX_AGE_MS)
      : [];
    if (this.#queue.length === 0 && this.#rideQueue.length === 0) {
      this.#connectAttempts = 0;
      this.#armLinger();
      return;
    }
    if (session.isConnected) {
      // The developer keeps the floor for the grace window after Luke answers
      // them; the backlog comes back when the window closes.
      const floorHeld = this.#holdUntil - now;
      if (floorHeld > 0 && session.microphoneCall) {
        this.#armHold(floorHeld);
        return;
      }
      // One reply at a time: the first speak takes the turn and the second is
      // refused, so the loop stops itself and READY resumes it. Notices go
      // first — the developer asked to hear them — and a summary rides only
      // the edges the notices leave.
      while (this.#queue.length > 0) {
        const next = this.#queue[0];
        if (!next || !session.speak(next)) break;
        this.#ownReply = true;
        this.#queue.shift();
      }
      while (this.#queue.length === 0 && this.#rideQueue.length > 0) {
        const next = this.#rideQueue[0];
        if (!next || !session.speak(next)) break;
        this.#ownReply = true;
        this.#rideQueue.shift();
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
    // Only a notice may open a call of Luke's own: a summary with nothing to
    // ride was already dropped above, and opening for one would turn a
    // passenger into a driver.
    if (this.#queue.length === 0) return;
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
    if (this.#queue.length === 0 && this.#rideQueue.length === 0) return;
    this.#retryTimer ??= (this.#options.schedule ?? setTimeout)(() => {
      this.#retryTimer = undefined;
      this.#flush();
    }, ANNOUNCER_RETRY_DELAY_MS);
  }

  /** Comes back for the backlog once the developer's floor window closes. */
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
    // queued and about to speak.
    if (!this.#ownsCall || !session.isConnected || session.microphoneCall) return;
    if (this.#queue.length > 0 || session.status !== REALTIME_STATUS.READY) return;
    this.#ownsCall = false;
    void session.close();
  }
}
