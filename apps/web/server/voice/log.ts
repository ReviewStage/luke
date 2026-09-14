import type { DevicePlatform, HostedApiError } from "../core.js";
import type { VoiceSecondsOutcome } from "../hosted/quota.js";
import type { VoiceRoute } from "./frames.js";

/**
 * What the service writes down about itself: status codes, close codes,
 * outcome names, counts, and the platform of the device row a handshake
 * resolved. No line carries a session id, a bearer, an SDP, a transcript
 * fragment, or any frame's content, so a log this service kept for a year
 * would still say nothing about anyone's conversation.
 */
export const LOG_EVENT = {
  /** A handshake refused before any socket stood: the HTTP status says why. */
  UPGRADE_REFUSED: "upgrade-refused",
  /** A socket refused after standing: the reason frame the device was sent says why. */
  SESSION_REFUSED: "session-refused",
  SESSION_CREATED: "session-created",
  /** A fresh connection's sideband stands again on a session created earlier. */
  SESSION_ATTACHED: "session-attached",
  GREETING_SENT: "greeting-sent",
  /** The greeting's append was acknowledged by the id it was sent with. */
  GREETING_ACKNOWLEDGED: "greeting-acknowledged",
  /** An error named the greeting's append: its kind, never the sentence it came with. */
  GREETING_REFUSED: "greeting-refused",
  /** Neither acknowledgment nor error arrived inside the wait, so nothing followed the greeting. */
  GREETING_UNACKNOWLEDGED: "greeting-unacknowledged",
  /** The commentary that asks the model to begin, sent once the greeting stood. */
  GREETING_CUED: "greeting-cued",
  USAGE_RECORDED: "usage-recorded",
  /** The hosted exchange stands on the session: the record, the brain, and the briefings run here for it. */
  EXCHANGE_ATTACHED: "exchange-attached",
  /** The composition offered an exchange and it could not stand on the session; the session is refused rather than run with no one to answer. */
  EXCHANGE_FAILED: "exchange-failed",
  /** The standing exchange reported something of itself: which of its fixed sentences, and nothing of the detail behind it. */
  EXCHANGE_REPORTED: "exchange-reported",
  /** The device sent a frame its signed-in route does not admit; its socket was closed on it. */
  FRAME_REFUSED: "frame-refused",
  SESSION_ENDED: "session-ended",
  /** A session's own `voice_sessions` write failed; the route is all it says, as every other line is. */
  SESSION_FAILED: "session-failed",
} as const;

/** Whether `session.closed` was seen before the transports went, as the docs define finalization. */
export const FINALIZATION = {
  CONFIRMED: "confirmed",
  UNCONFIRMED: "unconfirmed",
} as const;

export type Finalization = (typeof FINALIZATION)[keyof typeof FINALIZATION];

export interface RelayCounts {
  framesToUpstream: number;
  bytesToUpstream: number;
  framesToDevice: number;
  bytesToDevice: number;
  /** Reflected audio frames dropped by type, never forwarded. */
  droppedAudio: number;
  /** Frames a route does not permit in that direction, dropped by type. */
  droppedUnpermitted: number;
  /** Reports in the service's own vocabulary the device sent after the handshake, read here and never forwarded. */
  reportsRead: number;
  /** Device frames a signed-in route refused, closing the socket; at most one, since the first ends the socket. */
  refusedUnpermitted: number;
}

/**
 * Which caller a line is about, where the handshake resolved one: the
 * platform of the `devices` row the account was shown to hold, so a failure
 * only one kind of caller sees is visible in these counts rather than in a
 * payload. It is read from that row and never from a header the caller chose,
 * and it is absent wherever no row was resolved — every upgrade refusal, a
 * handshake that named no device, a claim on a row the account does not
 * hold, the accountless introduction, and a re-attach, which proves the
 * session's owner rather than a device.
 */
type ClientPlatform = { platform: DevicePlatform | undefined };

export type LogEntry =
  | { event: typeof LOG_EVENT.UPGRADE_REFUSED; route: string; status: number }
  | ({
      event: typeof LOG_EVENT.SESSION_REFUSED;
      route: VoiceRoute;
      reason: HostedApiError;
    } & ClientPlatform)
  | { event: typeof LOG_EVENT.SESSION_CREATED; route: VoiceRoute }
  | { event: typeof LOG_EVENT.SESSION_ATTACHED; route: VoiceRoute }
  | { event: typeof LOG_EVENT.GREETING_SENT; route: VoiceRoute }
  | { event: typeof LOG_EVENT.GREETING_ACKNOWLEDGED; route: VoiceRoute }
  | {
      event: typeof LOG_EVENT.GREETING_REFUSED;
      route: VoiceRoute;
      errorType: string | undefined;
      errorCode: string | undefined;
    }
  | { event: typeof LOG_EVENT.GREETING_UNACKNOWLEDGED; route: VoiceRoute }
  | { event: typeof LOG_EVENT.GREETING_CUED; route: VoiceRoute }
  | {
      event: typeof LOG_EVENT.USAGE_RECORDED;
      route: VoiceRoute;
      seconds: number;
      outcome: VoiceSecondsOutcome;
    }
  | { event: typeof LOG_EVENT.EXCHANGE_ATTACHED; route: VoiceRoute }
  | ({ event: typeof LOG_EVENT.EXCHANGE_FAILED; route: VoiceRoute } & ClientPlatform)
  | ({
      event: typeof LOG_EVENT.EXCHANGE_REPORTED;
      route: VoiceRoute;
      reason: string;
    } & ClientPlatform)
  | ({
      event: typeof LOG_EVENT.FRAME_REFUSED;
      route: VoiceRoute;
      type: string | undefined;
    } & ClientPlatform)
  | ({
      event: typeof LOG_EVENT.SESSION_ENDED;
      route: VoiceRoute;
      finalization: Finalization;
      seconds: number | undefined;
    } & RelayCounts)
  | { event: typeof LOG_EVENT.SESSION_FAILED; route: VoiceRoute };

export type Log = (entry: LogEntry) => void;

/** One JSON line per entry on standard output, which is what the platform's function logs collect. */
export const standardOutputLog: Log = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};
