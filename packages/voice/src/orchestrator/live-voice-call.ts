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
export interface LiveVoiceCall {
  readonly status: LiveStatus;
  /** Whether a session stands or is coming up, so a second press unmutes rather than opening again. */
  readonly standing: boolean;
  /** Whether the developer's microphone is being heard. */
  readonly listening: boolean;
  /**
   * Builds the peer, hands the offer to the host, and waits for the session
   * to start; the microphone track rides the offer disabled. Answers whether
   * a session stands at the end of it.
   */
  open(): Promise<boolean>;
  /** Asks the session to hear the microphone; the track enables on the acknowledgment. */
  unmute(): Promise<boolean>;
  /** Asks the session to stop hearing the microphone; the track disables on the acknowledgment. */
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
