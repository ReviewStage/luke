import {
  LIVE_SESSION_PHASE,
  type LiveSessionPhase,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import { LIVE_CLOSE_REASON, LIVE_STATUS, type LiveStatus, liveExchangeActive } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import type { LiveCaptionRow, LiveVoiceCall, LiveVoiceCallEvents } from "./live-voice-call.js";
import { NoticeStrip } from "./notice-strip.js";

/**
 * What the orchestrator reads rather than owns: whether a voice stands at
 * all, whether the captions are wanted, whether the output is silent, and
 * whether the microphone is granted. Amended whole from the document each
 * time it moves.
 */
export interface LiveVoiceSurroundings {
  voiceAvailable: boolean | undefined;
  captionsEnabled: boolean;
  outputSilent: boolean;
  microphoneGranted: boolean;
}

/** What a panel needs to draw the live conversation, reported whole on every edge. */
export interface LiveVoiceView {
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  /** Whether a press is still waiting on the session it opened. */
  talkOpening: boolean;
  /** Luke's rows while he speaks, when the captions preference or a silent output asks for them. */
  lukeCaptions: readonly string[] | undefined;
  /** Both speakers' rows still being spoken, ahead of the record the host writes once each settles. */
  liveConversationEntries: readonly ConversationEntry[];
  /** Whether the developer is being heard and has not been transcribed yet. */
  spokenAskPending: boolean;
}

/** Who opened the exchange the count is about: a press, or Luke's own speech into a session opened for it. */
export interface LiveVoiceExchangeOpening {
  microphoneCall: boolean;
}

/** Everything the policy asks of the process that hosts it. */
export interface LiveVoiceBridge {
  reportView(view: LiveVoiceView, exchange: LiveVoiceExchangeOpening | undefined): void;
  /** Asks the system for the microphone, answering whether it is granted. */
  requestMicrophone(): Promise<boolean>;
  /** The neutral note said when the hosted service's ceiling refuses a session. */
  hostedUnavailableNote(): Promise<string | undefined>;
}

export interface LiveVoiceOrchestratorOptions {
  bridge: LiveVoiceBridge;
  createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
}

const MICROPHONE_REFUSED_NOTE =
  "The talk key needs the microphone. Allow it in System Settings, " +
  "under Privacy & Security, Microphone — or type to Luke instead.";

function sameView(left: LiveVoiceView, right: LiveVoiceView): boolean {
  return (
    left.voiceStatus === right.voiceStatus &&
    left.voiceError === right.voiceError &&
    left.voiceNotice === right.voiceNotice &&
    left.talkOpening === right.talkOpening &&
    left.lukeCaptions === right.lukeCaptions &&
    left.liveConversationEntries === right.liveConversationEntries &&
    left.spokenAskPending === right.spokenAskPending
  );
}

/**
 * The one voice session as the desktop drives it, following the live guide's
 * one-owner rule: the renderer owns the microphone switch and the hang-up,
 * the host owns every append and the close decision. The talk key opens the
 * session if none stands and unmutes it; pressed again while the developer is
 * heard, it mutes, as the stop key does. The host's `voiceLiveSession.changed`
 * is obeyed rather than reasoned about: wanted opens a session muted for
 * whatever Luke has to say, closing hangs up, and a session lost with the
 * microphone live is listened to again on the session that replaces it. No
 * turn is committed, no reply is claimed, and no words are written here: both
 * speakers' lines are the host's, from the transcript its sideband receives.
 */
export class LiveVoiceOrchestrator {
  readonly #bridge: LiveVoiceBridge;
  readonly #createCall: (events: LiveVoiceCallEvents) => LiveVoiceCall;
  readonly #strip = new NoticeStrip({ onChanged: () => this.#touch() });
  #call: LiveVoiceCall | undefined;
  #surroundings: LiveVoiceSurroundings = {
    voiceAvailable: undefined,
    captionsEnabled: false,
    outputSilent: false,
    microphoneGranted: false,
  };
  #status: LiveStatus = LIVE_STATUS.IDLE;
  #rows: readonly LiveCaptionRow[] = [];
  #lukeCaptions: readonly string[] | undefined;
  #liveEntries: readonly ConversationEntry[] = [];
  #talkOpening = false;
  /** Whether the microphone was last heard live, kept across the call's own end so a lost session knows what it was carrying. */
  #lastListening = false;
  /** Whether the developer was being heard when the session was lost, so its replacement listens again. */
  #resumeListening = false;
  /** Whether the session standing was opened by a press rather than for Luke's own speech. */
  #openedByPress = false;
  #opening: Promise<boolean> | undefined;
  /** A stop pressed while a press's session was still opening: the press ends muted rather than unmuting a session nobody wants heard. */
  #pressStopped = false;
  #reported: LiveVoiceView | undefined;
  /** The call whose exchange has been counted, so a session pausing between Luke's sentences is not a second exchange. */
  #countedCall: LiveVoiceCall | undefined;
  #counted = false;
  #queued = false;
  #stopped = false;

  constructor(options: LiveVoiceOrchestratorOptions) {
    this.#bridge = options.bridge;
    this.#createCall = options.createCall;
  }

  surround(surroundings: LiveVoiceSurroundings): void {
    const stoodAvailable = this.#surroundings.voiceAvailable;
    this.#surroundings = surroundings;
    if (surroundings.voiceAvailable === false && stoodAvailable !== false && this.#call) {
      void this.#call.close();
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The talk key. Against no session it opens one and unmutes it; against a
   * muted session it unmutes; against a listening one it mutes, so the key
   * alone can end what it began.
   */
  async beginTalk(): Promise<void> {
    if (this.#surroundings.voiceAvailable === false) {
      const unavailable = await this.#bridge.hostedUnavailableNote();
      if (unavailable) this.#strip.showNotice(unavailable);
      return;
    }
    const standing = this.#call;
    if (standing?.listening) {
      await standing.mute();
      return;
    }
    if (!this.#surroundings.microphoneGranted) {
      const granted = await this.#bridge.requestMicrophone();
      if (!granted) {
        this.#strip.showError(MICROPHONE_REFUSED_NOTE);
        return;
      }
    }
    this.#pressStopped = false;
    const call = await this.#ensureSession({ byPress: true });
    if (call && !this.#pressStopped) await call.unmute();
    // The press is answered once the session hears the developer; between the
    // offer and the unmute the session passes through muted, which is not the
    // exchange ending.
    this.#talkOpening = false;
    this.#touch();
  }

  /**
   * The stop key, and the panel's Escape: the microphone closes and the host
   * tells the model to stop. Pressed while a press's session is still
   * opening, it cancels that press's unmute, so the session opens muted.
   */
  async stopSpeaking(): Promise<boolean> {
    // A session still being opened has no peer to mute yet; the stop is
    // remembered for the press, which then leaves the session muted.
    if (this.#opening) {
      this.#pressStopped = true;
      return true;
    }
    const call = this.#call;
    if (!call?.standing) return false;
    await call.mute();
    return true;
  }

  /**
   * What the document held when this window came up. A wanted the host
   * announced before the window subscribed would otherwise be a briefing left
   * queued until the next drain, so the standing phase is obeyed once at
   * adoption; every later phase arrives as its own event.
   */
  adoptStanding(phase: LiveSessionPhase | undefined): void {
    if (phase === LIVE_SESSION_PHASE.WANTED) this.obeySessionChange({ phase });
  }

  /** The panel asking for the microphone from its own row. */
  async requestMicrophoneAccess(): Promise<void> {
    await this.#bridge.requestMicrophone();
  }

  /**
   * The host's word on the one session. Wanted is Luke with something to say
   * and no session to say it into, so one opens muted; closing is the host's
   * decision to end it, so the peer hangs up; a close that lost the developer
   * mid-conversation is remembered so the next session listens again.
   */
  obeySessionChange(change: VoiceLiveSessionChanged): void {
    switch (change.phase) {
      case LIVE_SESSION_PHASE.WANTED:
        if (this.#surroundings.voiceAvailable === false) return;
        void this.#ensureSession({ byPress: false }).then(async (call) => {
          if (call && this.#resumeListening) {
            this.#resumeListening = false;
            await call.unmute();
          }
        });
        return;
      case LIVE_SESSION_PHASE.CLOSING:
        if (this.#aboutThisCall(change)) void this.#call?.close();
        return;
      case LIVE_SESSION_PHASE.CLOSED: {
        // A call still standing that the word is not about is left alone; no
        // call at all is the peer having ended first, and the word still says
        // whether the developer was being heard when the session was lost.
        if (this.#call && !this.#aboutThisCall(change)) return;
        // The host's word ends the session whatever the peer still shows: the
        // call is let go of here so the wanted that may follow opens a new
        // one, and it finishes its own hang-up behind. Whether the developer
        // was being heard is read from the last status the call reported,
        // since its own end may have landed before this event did.
        this.#resumeListening =
          this.#lastListening &&
          (change.reason === LIVE_CLOSE_REASON.EXPIRED ||
            change.reason === LIVE_CLOSE_REASON.CONNECTION_LOST);
        this.#lastListening = false;
        const ended = this.#call;
        if (ended) {
          this.#call = undefined;
          this.#status = LIVE_STATUS.IDLE;
          this.#rows = [];
          this.#openedByPress = false;
          void ended.close();
          this.#recomposeCaptions();
          this.#touch();
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Whether the host's word names the session this call holds. The host
   * closes a session it still held before creating the next, and that close
   * names the old session: a call still waiting for its offer to be answered
   * holds no session yet, and one answered holds another, so neither is the
   * one the host means.
   */
  #aboutThisCall(change: VoiceLiveSessionChanged): boolean {
    const held = this.#call?.sessionId;
    return held !== undefined && (change.sessionId === undefined || change.sessionId === held);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const call = this.#call;
    this.#call = undefined;
    if (call) await call.close();
  }

  /**
   * The session standing or coming up, or a new one opened now. One opening
   * at a time: a second ask while the first is still negotiating waits for
   * it rather than offering the host a second peer.
   */
  async #ensureSession(input: { byPress: boolean }): Promise<LiveVoiceCall | undefined> {
    if (this.#call?.standing) return this.#call;
    if (this.#opening) {
      const opened = await this.#opening;
      return opened ? this.#call : undefined;
    }
    this.#openedByPress = input.byPress;
    this.#strip.clear();
    const call = this.#createCall({
      onStatus: (status) => this.#onStatus(call, status),
      onCaptions: (rows) => this.#onCaptions(call, rows),
      onError: (message) => this.#strip.showError(message),
    });
    this.#call = call;
    this.#talkOpening = input.byPress;
    this.#touch();
    this.#opening = call.open();
    const opened = await this.#opening;
    this.#opening = undefined;
    if (!opened) {
      this.#talkOpening = false;
      if (this.#call === call) this.#call = undefined;
      const unavailable = await this.#bridge.hostedUnavailableNote();
      if (unavailable) this.#strip.showNotice(unavailable);
      this.#touch();
      return undefined;
    }
    this.#touch();
    return call;
  }

  #onStatus(call: LiveVoiceCall, status: LiveStatus): void {
    if (this.#call !== call) return;
    this.#status = status;
    if (status === LIVE_STATUS.LISTENING) this.#lastListening = true;
    else if (status === LIVE_STATUS.MUTED || status === LIVE_STATUS.SPEAKING) {
      this.#lastListening = call.listening;
    }
    if (status === LIVE_STATUS.IDLE || status === LIVE_STATUS.FAILED) {
      this.#call = undefined;
      this.#rows = [];
      this.#openedByPress = false;
    }
    this.#recomposeCaptions();
    this.#touch();
  }

  #onCaptions(call: LiveVoiceCall, rows: readonly LiveCaptionRow[]): void {
    if (this.#call !== call) return;
    this.#rows = rows;
    this.#recomposeCaptions();
    this.#touch();
  }

  /**
   * The captions as the panel draws them: Luke's words under the housing
   * while he speaks and there is a reason to read them, and every row still
   * being spoken as a line the Conversation tab draws ahead of the record.
   */
  #recomposeCaptions(): void {
    const unsettled = this.#rows.filter((row) => !row.settled);
    const lukeRows = unsettled
      .filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.REPLY)
      .map((row) => row.entry.words);
    const wanted =
      (this.#surroundings.captionsEnabled || this.#surroundings.outputSilent) &&
      this.#status === LIVE_STATUS.SPEAKING;
    const nextCaptions = wanted && lukeRows.length > 0 ? lukeRows : undefined;
    if (!sameWords(this.#lukeCaptions, nextCaptions)) this.#lukeCaptions = nextCaptions;
    const nextEntries = unsettled.map((row) => row.entry);
    if (!sameEntries(this.#liveEntries, nextEntries)) this.#liveEntries = nextEntries;
  }

  #compose(): LiveVoiceView {
    return {
      voiceStatus: this.#status,
      voiceError: this.#strip.error,
      voiceNotice: this.#strip.notice,
      talkOpening: this.#talkOpening,
      lukeCaptions: this.#lukeCaptions,
      liveConversationEntries: this.#liveEntries,
      spokenAskPending:
        this.#status === LIVE_STATUS.LISTENING &&
        !this.#liveEntries.some((entry) => entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK),
    };
  }

  /**
   * Two facts moving together are one report, folded until the microtask
   * drains; a view that did not move is not reported at all, since the report
   * becomes a version of the document this same window reads. The count of
   * exchanges rides the report on the opening edge alone.
   */
  #touch(): void {
    if (this.#stopped || this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.#stopped) return;
      const view = this.#compose();
      if (this.#reported !== undefined && sameView(this.#reported, view)) return;
      this.#reported = view;
      const active = liveExchangeActive(view);
      const rising = active && !this.#counted && this.#call !== this.#countedCall;
      this.#counted = active;
      if (rising) this.#countedCall = this.#call;
      this.#bridge.reportView(view, rising ? { microphoneCall: this.#openedByPress } : undefined);
    });
  }
}

function sameWords(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((word, index) => word === right[index]);
}

function sameEntries(left: readonly ConversationEntry[], right: readonly ConversationEntry[]) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entry.kind === other.kind && entry.words === other.words;
  });
}
