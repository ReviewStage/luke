import type { LiveStatus } from "@sidecar/live";
import type { LiveConversationLine } from "@sidecar/session";
import type { Effect } from "effect";

/**
 * The one GPT Live session as the policy above the peer drives it. The peer
 * connection, the microphone track, the data channel, and the element Luke's
 * voice plays through are the surface's; what the policy reaches is the five
 * verbs the server-controls guide leaves to the renderer — open, unmute,
 * mute, close, and silencing the output — and the status the peer reads off
 * its own transport and playback. Nothing here appends to the model: every append is the host's,
 * over its trusted sideband, so the call can carry no authority to speak.
 */
/**
 * What a session is opened about. Every session is opened by a press, the
 * user action the WebRTC guide asks the microphone be requested from, so a
 * capture device rides every offer.
 */
export interface LiveVoiceCallOpening {
  /** The plan the call is about, which the host creates the session about. */
  planId: string;
}

export interface LiveVoiceCall {
  readonly status: LiveStatus;
  /** The session the host created for this call, once its offer was answered; what the host's word about a session is matched against. */
  readonly sessionId: string | undefined;
  /** Whether a session stands or is coming up, so a second press unmutes rather than opening again. */
  readonly standing: boolean;
  /**
   * Builds the peer, hands the offer to the host, and waits for the session
   * to start; the press's microphone track rides the offer disabled. Answers
   * whether a session stands at the end of it. Runs on the fiber the caller
   * already holds rather than one of its own.
   */
  open(opening: LiveVoiceCallOpening): Effect.Effect<boolean>;
  /** Opens the capture device if none stands and asks the session to hear it; the track enables on the acknowledgment. */
  unmute(): Effect.Effect<boolean>;
  /**
   * Asks the session to stop hearing the microphone, then releases the
   * capture device whatever the session answered: the key coming up is the
   * developer's decision and the device is theirs. The answer stays the
   * session's own word on the switch.
   */
  mute(): Effect.Effect<boolean>;
  /**
   * Silences Luke on this device at once, for the stop: the server-controls
   * guide leaves blocking the model's audio to the client, since muting the
   * input does not stop the output and an instruction cannot retract what
   * is already playing. Playback comes back once the utterance he was
   * silenced in has ended, so what he says next is heard from its start. A
   * call where he is not speaking has nothing to silence.
   */
  silenceOutput(): void;
  /** The graceful hang-up: `session.closed` registered, `session.close` sent, waited for under the guide's bound. */
  close(): Effect.Effect<void>;
}

/**
 * Who the session is carrying at this instant. GPT Live is full duplex, so
 * both stand together while the developer talks over Luke's answer, which is
 * exactly what one status cannot say: it names the louder claim and drops the
 * other.
 */
export interface LiveVoiceSpeakers {
  /** Whether the developer's microphone is being heard. */
  listening: boolean;
  /** Whether Luke is audible on the remote track. */
  lukeSpeaking: boolean;
}

/** What the call tells the policy as it moves, so the view can be reported. */
export interface LiveVoiceCallEvents {
  /**
   * The status and both speakers together, since a speaker can move without
   * the status moving: the microphone opening under Luke's own sentence
   * leaves the session speaking and starts the developer's meter.
   */
  onStatus(status: LiveStatus, speakers: LiveVoiceSpeakers): void;
  /**
   * The caption rows as the transcript ledger groups them, both speakers,
   * each row stable once opened and growing in place: Luke's rows while he
   * speaks are the captions.
   */
  onCaptions(rows: readonly LiveCaptionRow[]): void;
  /** The one failure a session can end in that the panel should say. */
  onError(message: string): void;
}

/** One caption row: whose it is, its words so far, and whether a fragment may still join it; the line the panel is handed, under the name the captions know it by. */
export type LiveCaptionRow = LiveConversationLine;
