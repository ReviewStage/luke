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

/**
 * How long Luke's own call lingers when a sample is all it has said. A sample
 * answers a click on a settings row, and rows like that are clicked in runs —
 * four voices tried against each other — so the call waits for the next pick
 * rather than paying the handshake for each. Far shorter than a notice's
 * linger all the same: hearing a voice is not news anyone is owed, and a
 * settings tweak must not hold a call open for a minute.
 */
export const PREVIEW_LINGER_MS = 8_000;

/**
 * How long a sample stays worth playing. It answers an act the developer just
 * performed; one that waited out a long reply is answering a click they have
 * already moved on from, and arrives as an interruption rather than a sample.
 */
export const VOICE_PREVIEW_MAX_AGE_MS = 20_000;

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
  /** Says the fixed sample line in the voice and at the pace now stored. */
  speakPreview(): boolean;
  close(): Promise<void>;
}

/**
 * An ask to hear the voice and pace now stored. Identity is what distinguishes
 * two of them: every ask is its own object, so a slot still holding the one a
 * call was opened for is a slot nothing has superseded.
 */
interface VoicePreviewRequest {
  readonly requestedAt: number;
}

export interface SpokenNoticeAnnouncerOptions {
  session: () => AnnouncerSession;
  /**
   * Whether the developer's own call is between a close and the reopen that
   * follows it — what a changed voice does, since the voice is baked into the
   * credential. The session answers "not connected, not connecting" across
   * that gap, and it is the one time that answer must not be taken as silence:
   * a call of Luke's own opened into it is torn down mid-sentence by the one
   * coming back, which is also the call anything waiting belongs on.
   */
  reopening?: () => boolean;
  /**
   * Whether the call now up, or the one still coming up, was minted for a
   * voice that no longer stands. A voice change owed against a call cannot be
   * paid until the call settles, so between the pick and the teardown there is
   * a live call speaking in the voice being replaced.
   *
   * News may ride such a call: a session that finished is the same news in any
   * voice. A sample may not, because the sample *is* the voice — played there
   * it would audition the voice the developer just moved off, and be spent by
   * the time the call it was actually owed opens. Held instead, it is asked for
   * again the moment that call ends, which is the path a stranded sample
   * already takes.
   */
  revoicing?: () => boolean;
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
 * The sample a changed voice or pace asks for is said the same way, and lives
 * here for the same reason: "speak into silence, opening a call if that is
 * what it takes, and close the call I opened" is one job, and a second owner
 * racing this one for the same session would be a bug farm. It is not news,
 * though, so it keeps none of the news rules — a single slot rather than a
 * queue, since only the latest pick matters; no retry, since a call opening
 * twenty seconds after a click is a call nobody asked for; and a shorter
 * linger, since a settings tweak must not hold a call open for a minute.
 */
export class SpokenNoticeAnnouncer {
  readonly #options: SpokenNoticeAnnouncerOptions;
  #queue: AttentionSpeech[] = [];
  /**
   * The sample waiting to be played, if one is. A slot rather than a queue
   * entry: two picks in a row are one ask to hear the second one.
   */
  #preview: VoicePreviewRequest | undefined;
  /** Whether the call now up is one this announcer opened, and so must close. */
  #ownsCall = false;
  /**
   * Whether the call Luke opened has said nothing but samples. It is what
   * chooses the linger: a call opened to audition voices puts itself away in
   * seconds, where one that read out news waits a minute for the cluster that
   * usually follows. Set true by the connect that opens a call and false by
   * the first notice spoken on it — the only two moments it can change,
   * because it describes the call now up and nothing else.
   */
  #previewOnlyCall = false;
  #lingerTimer: unknown;
  /** How many times the backlog now queued has tried to open Luke's own call. */
  #connectAttempts = 0;
  #retryTimer: unknown;

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
   * Takes the ask to hear the voice and pace the developer just chose. The
   * slot is filled rather than appended to: a pick made while the last one is
   * still waiting supersedes it, because the only sample worth hearing is the
   * one for the setting that now stands.
   */
  requestPreview(): void {
    this.#preview = { requestedAt: this.#options.now?.() ?? Date.now() };
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
      // A sample waiting when a call ends is the voice restart's own path: the
      // call was closed precisely so the next one could be minted in the new
      // voice, and the sample is what is waiting to be heard in it. It is
      // asked for again here rather than on the queue's retry clock, which is
      // twenty seconds the developer would spend wondering.
      if (this.#preview) {
        this.#flush();
        return;
      }
      // The backlog survives the call it was waiting on — a developer's call
      // that ended mid-queue, or Luke's own that dropped — and the retry clock
      // is what picks it back up. The connect path arms the same clock when an
      // open is refused, so arming here is idempotent.
      this.#armRetry();
    }
  }

  #flush(): void {
    const now = this.#options.now?.() ?? Date.now();
    if (this.#preview && now - this.#preview.requestedAt > VOICE_PREVIEW_MAX_AGE_MS) {
      this.#preview = undefined;
    }
    this.#queue = this.#queue.filter((item) => now - item.decidedAt <= SPOKEN_NOTICE_MAX_AGE_MS);
    const session = this.#options.session();
    if (this.#preview === undefined && this.#queue.length === 0) {
      this.#connectAttempts = 0;
      this.#armLinger();
      return;
    }
    if (session.isConnected) {
      // The sample goes first. It answers something the developer did a moment
      // ago; the notices behind it are news, and news keeps. Unless this call
      // is the one a changed voice is already owed against, in which case the
      // sample waits for the call that replaces it — the voice it exists to
      // play is not the voice this one would say it in.
      if (this.#preview && this.#options.revoicing?.() !== true && session.speakPreview()) {
        this.#preview = undefined;
      }
      // One reply at a time: the first speak takes the turn and the second is
      // refused, so the loop stops itself and READY resumes it.
      while (this.#queue.length > 0 && session.speak(this.#queue[0] as AttentionSpeech)) {
        this.#queue.shift();
        // Something other than a sample has now been said on this call, so it
        // has earned the full linger.
        this.#previewOnlyCall = false;
      }
      // A backlog waiting on a refused speak is normally resumed by the READY
      // edge, but that edge is the session's promise, not this class's: the
      // retry clock keeps the backlog from depending on it. Redundant on the
      // ordinary path — the edge lands first and says everything — and what
      // stands between an announcement and permanent silence when it does not.
      this.#armRetry();
      return;
    }
    // A call being opened, or one on its way back in a changed voice: either
    // way there is a call coming, and it is the one to say this on.
    if (session.isConnecting || this.#options.reopening?.() === true) return;
    // Silence, and something to say into it: open a call of Luke's own.
    //
    // The attempts are the backlog's ledger, so only a call with news behind it
    // spends one. A sample opens calls too and answers to no retry clock of its
    // own — a refused sample that drew on this would leave the news it never
    // shared a queue with fewer tries than a transient refusal is owed.
    if (this.#queue.length > 0) this.#connectAttempts += 1;
    this.#ownsCall = true;
    // Until a notice speaks on it, whatever this call is opened for, it has
    // said nothing that is owed the long linger.
    this.#previewOnlyCall = true;
    // Which sample this call is being opened for, so a refusal can tell it from
    // one the developer picked while the handshake was still going.
    const attempted = this.#preview;
    void session
      .connect({ microphone: false })
      .then((opened) => {
        if (opened) {
          this.#connectAttempts = 0;
          // The call that just opened is the one this announcer asked for,
          // whatever status arrived while it was opening: the call it replaced
          // ending is not this call ending, and taking ownership away on that
          // would leave the new one with nobody to close it — open for the
          // session's own idle retirement rather than the few seconds it is
          // owed. Unless what came up is the developer's own call, which is
          // never Luke's to close.
          this.#ownsCall = !session.microphoneCall;
          this.#flush();
          return;
        }
        this.#ownsCall = false;
        this.#retreatOrRetry(attempted);
      })
      .catch(() => {
        this.#ownsCall = false;
        this.#retreatOrRetry(attempted);
      });
  }

  /**
   * Decides what a refused connect leaves behind. A backlog still owed a try
   * keeps it, on the retry clock; one that has had its tries is dropped here,
   * at the moment of the final refusal, so notices arriving afterwards start
   * a fresh backlog with tries of its own rather than dying against a spent
   * counter. What is dropped is still standing in the panel.
   */
  #retreatOrRetry(attempted: VoicePreviewRequest | undefined): void {
    // The sample this call was opened for goes with the refusal, whatever the
    // backlog does next. It is the answer to a click, and the retry clock is
    // twenty seconds long: a call opening then would be Luke introducing
    // himself to someone who has gone back to work.
    //
    // A pick made while the handshake was still going is a different ask, and
    // not this refusal's to drop — it is the newer click, still waiting on an
    // answer, and the status this refusal raises is what asks for it again.
    if (this.#preview === attempted) this.#preview = undefined;
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

  #armLinger(): void {
    const session = this.#options.session();
    if (!this.#ownsCall || !session.isConnected || session.microphoneCall) return;
    if (session.status !== REALTIME_STATUS.READY) return;
    this.#lingerTimer ??= (this.#options.schedule ?? setTimeout)(
      () => {
        this.#lingerTimer = undefined;
        this.#closeOwnCall();
      },
      this.#previewOnlyCall ? PREVIEW_LINGER_MS : ANNOUNCER_LINGER_MS,
    );
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
    if (this.#preview || this.#queue.length > 0) return;
    if (session.status !== REALTIME_STATUS.READY) return;
    this.#ownsCall = false;
    void session.close();
  }
}
