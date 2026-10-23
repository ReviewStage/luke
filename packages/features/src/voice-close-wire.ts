import { LIVE_CLOSE_REASON, type LiveCloseReason } from "@luke/live";

/**
 * voice-close-wire.ts -- why a voice session ended, as the Live API names it, the service stores it, and the admin pages draw it.
 */

/** Why a session ended, as the Live API's `session.closed` names it: `@luke/live`'s own set. */
export const VOICE_CLOSE_REASON = LIVE_CLOSE_REASON;

export type VoiceCloseReason = LiveCloseReason;
