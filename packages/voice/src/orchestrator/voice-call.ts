import {
  BRIEFING_SPEECH_KIND,
  type ProactiveSpeechTurn,
  type RealtimeStatus,
} from "@sidecar/realtime";

/**
 * Whose words the caption is showing: a briefing the brain decided to give,
 * or a reply to the developer. Conversation records the two differently.
 */
export const REPLY_KIND = {
  BRIEFING: BRIEFING_SPEECH_KIND,
  REPLY: "reply",
} as const;

export type ReplyKind = (typeof REPLY_KIND)[keyof typeof REPLY_KIND];

/**
 * The slice of a call the policy above it drives, and it is a speak-only
 * call's: everything reachable through this type is a member of one, so the
 * call Luke opens for himself carries no microphone and no tools by
 * construction rather than by a flag somebody remembered to pass. The
 * transport itself — the peer connection, the capture device, the audio
 * element — is the surface's, and none of it appears here.
 */
export interface SpeakOnlyVoiceCall {
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly status: RealtimeStatus;
  /**
   * Whether the call that is up — or coming up — is one the developer can
   * take a turn on. Always false on a call Luke opened for himself, which has
   * no device to offer; on the developer's own it is the live question, since
   * a call whose device is resting between turns can still take the next one.
   */
  readonly microphoneCall: boolean;
  connect(): Promise<boolean>;
  close(): Promise<void>;
  speak(turn: ProactiveSpeechTurn): boolean;
  stopSpeaking(): boolean;
  reportRemoteAudioLevel(active: boolean): void;
}

/** What the developer's own call adds: the turn a press opens, and the reply a typed ask is answered with. */
export interface ConversationVoiceCall extends SpeakOnlyVoiceCall {
  readonly turnPending: boolean;
  beginTurn(): void;
  endTurn(commit: boolean): void;
  dropPendingTurn(): void;
  stopListening(commit: boolean): void;
  speakReply(words: string, runId: string): boolean;
}
