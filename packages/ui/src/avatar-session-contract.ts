/**
 * avatar-session-contract.ts -- what the panel and the avatar session's bundle say to each other: the grant, the slice of Keyframe's session the window drives, and nothing that pulls LiveKit into the renderer.
 *
 * Keyframe's SDK rides on LiveKit's client, which is too large for the
 * bundle every window parses and is needed only by a call with its video
 * on, so it ships as a bundle of its own (`avatar-session.js`, built from
 * `apps/desktop/src/renderer/avatar-session/index.ts`) that the panel
 * loads the first time an avatar is shown
 * (`apps/desktop/src/renderer/bundle-loader.ts`), as the whiteboard and a plan's
 * editor are. That bundle's entry exports one module, `avatarSession`, and
 * this file is the whole of what the two share. Nothing here imports a
 * value, so the renderer carries none of the SDK, and the bundle carries
 * none of Effect: the effect over the session (`./avatar-session.ts`) is the
 * renderer's, written against the slice below, so a test stands a fake in
 * for Keyframe's session without a browser or a room.
 *
 * The grant's token can view the avatar and send it audio for one call. It
 * reaches this window and the session it opens, and nothing here logs it.
 */

/** What the voice service minted for one call's avatar (`POST /v1/sessions`), as the panel is handed it. */
export interface AvatarGrant {
  readonly serverUrl: string;
  readonly participantToken: string;
  readonly agentIdentity: string;
}

/** Why Keyframe's session said it closed, as its SDK names it. */
export type PersonaCloseReason =
  | "client_initiated"
  | "room_deleted"
  | "server_shutdown"
  | "participant_removed"
  | "unknown";

/** The avatar's playback, as the GPU worker reports it over its two RPCs. */
type PersonaPlayback = "listening" | "speaking";

/** The callbacks the window hands Keyframe's session as it creates one: the narrowest slice of `PersonaSessionOptions`. */
export interface PersonaSessionOptions extends AvatarGrant {
  readonly onVideoTrack: (track: MediaStreamTrack) => void;
  readonly onAudioTrack: (track: MediaStreamTrack) => void;
  readonly onAgentStateChange: (state: PersonaPlayback) => void;
  readonly onClose: (reason: PersonaCloseReason) => void;
}

/** The narrowest slice of Keyframe's `PersonaSession` the window drives. */
export interface PersonaSessionSlice {
  connect(): Promise<void>;
  /** PCM16LE, 24 kHz, mono. */
  sendAudio(pcm: Uint8Array): void;
  endAudioTurn(): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

/** What the avatar session's bundle exports, which the panel imports the first time an avatar is shown. */
export interface AvatarSessionModule {
  readonly createSession: (options: PersonaSessionOptions) => PersonaSessionSlice;
}
