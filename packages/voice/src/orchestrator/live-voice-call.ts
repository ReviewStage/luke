import type { LiveStatus } from "@sidecar/live";
import type { ConversationEntry } from "@sidecar/session";

/**
 * The one GPT Live session as the policy above the peer drives it. The peer
 * connection, the microphone track, the data channel, and the element Luke's
 * voice plays through are the surface's; what the policy reaches is the four
 * verbs the server-controls guide leaves to the renderer — open, unmute,
 * mute, close — and the status the peer reads off its own transport and
 * playback. Nothing here appends to the model: every append is the host's,
 * over its trusted sideband, so the call can carry no authority to speak.
 */
/**
 * Who opened the session, which decides whether a capture device rides its
 * offer: a press is the user action the WebRTC guide asks the microphone be
 * requested from, and a session opened for Luke's own speech carries none.
 */
export interface LiveVoiceCallOpening {
  byPress: boolean;
}

export interface LiveVoiceCall {
  readonly status: LiveStatus;
  /** The session the host created for this call, once its offer was answered; what the host's word about a session is matched against. */
  readonly sessionId: string | undefined;
  /** Whether a session stands or is coming up, so a second press unmutes rather than opening again. */
  readonly standing: boolean;
  /** Whether the developer's microphone is being heard. */
  readonly listening: boolean;
  /**
   * Builds the peer, hands the offer to the host, and waits for the session
   * to start; a press's microphone track rides the offer disabled, and any
   * other opening carries no device. Answers whether a session stands at the
   * end of it.
   */
  open(opening: LiveVoiceCallOpening): Promise<boolean>;
  /** Opens the capture device if none stands and asks the session to hear it; the track enables on the acknowledgment. */
  unmute(): Promise<boolean>;
  /**
   * Asks the session to stop hearing the microphone, then releases the
   * capture device whatever the session answered: the key coming up is the
   * developer's decision and the device is theirs. The answer stays the
   * session's own word on the switch.
   */
  mute(): Promise<boolean>;
  /** The graceful hang-up: `session.closed` registered, `session.close` sent, waited for under the guide's bound. */
  close(): Promise<void>;
}

/** What the call tells the policy as it moves, so the view can be reported. */
export interface LiveVoiceCallEvents {
  onStatus(status: LiveStatus): void;
  /**
   * The caption rows as the transcript ledger groups them, both speakers,
   * each row stable once opened and growing in place: Luke's rows while he
   * speaks are the captions, and every row still being spoken is a line the
   * Conversation tab draws ahead of the record.
   */
  onCaptions(rows: readonly LiveCaptionRow[]): void;
  /** The one failure a session can end in that the panel should say. */
  onError(message: string): void;
}

/** One caption row: whose it is, its words so far, and whether a fragment may still join it. */
export interface LiveCaptionRow {
  rowId: number;
  entry: ConversationEntry;
  settled: boolean;
}
