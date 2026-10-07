import type { HostedApiError } from "../core.js";
import type { VoiceSecondsOutcome } from "../hosted/quota.js";

/**
 * What the service writes down about itself: status codes, close codes,
 * outcome names, and counts. No line carries a session id, a bearer, an SDP, a transcript
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
  /** The hosted exchange stands on the session: the record and the brain run here for it. */
  EXCHANGE_ATTACHED: "exchange-attached",
  /** The composition offered an exchange and it could not stand on the session; the session is refused rather than run with no one to answer. */
  EXCHANGE_FAILED: "exchange-failed",
  /** The standing exchange reported something of itself: which of its fixed sentences, and nothing of the detail behind it. */
  EXCHANGE_REPORTED: "exchange-reported",
  /** The device sent a frame the service does not admit; its socket was closed on it. */
  FRAME_REFUSED: "frame-refused",
  SESSION_ENDED: "session-ended",
  /** A session's own `voice_sessions` write failed; the event is all it says. */
  SESSION_FAILED: "session-failed",
} as const;

/**
 * Whether `session.closed` was seen before the transports went, as the docs
 * define finalization, or whether the session was never ended here at all:
 * a device socket that went without a hang-up leaves the
 * WebRTC session standing for the device to attach to again, and the
 * connection that later reads its `session.closed` is the one that confirms it.
 */
export const FINALIZATION = {
  CONFIRMED: "confirmed",
  UNCONFIRMED: "unconfirmed",
  DETACHED: "detached",
} as const;

export type Finalization = (typeof FINALIZATION)[keyof typeof FINALIZATION];

export interface RelayCounts {
  framesToUpstream: number;
  bytesToUpstream: number;
  framesToDevice: number;
  bytesToDevice: number;
  /** Reflected audio frames dropped by type, never forwarded. */
  droppedAudio: number;
  /** Reports in the service's own vocabulary the device sent after the handshake, read here and never forwarded. */
  reportsRead: number;
  /** Device frames the service refused, closing the socket; at most one, since the first ends the socket. */
  refusedUnpermitted: number;
}

export type LogEntry =
  | { event: typeof LOG_EVENT.UPGRADE_REFUSED; route: string; status: number }
  | { event: typeof LOG_EVENT.SESSION_REFUSED; reason: HostedApiError }
  | { event: typeof LOG_EVENT.SESSION_CREATED }
  | { event: typeof LOG_EVENT.SESSION_ATTACHED }
  | { event: typeof LOG_EVENT.GREETING_SENT }
  | { event: typeof LOG_EVENT.GREETING_ACKNOWLEDGED }
  | {
      event: typeof LOG_EVENT.GREETING_REFUSED;
      errorType: string | undefined;
      errorCode: string | undefined;
    }
  | { event: typeof LOG_EVENT.GREETING_UNACKNOWLEDGED }
  | { event: typeof LOG_EVENT.GREETING_CUED }
  | { event: typeof LOG_EVENT.USAGE_RECORDED; seconds: number; outcome: VoiceSecondsOutcome }
  | { event: typeof LOG_EVENT.EXCHANGE_ATTACHED }
  | { event: typeof LOG_EVENT.EXCHANGE_FAILED }
  | { event: typeof LOG_EVENT.EXCHANGE_REPORTED; reason: string }
  | { event: typeof LOG_EVENT.FRAME_REFUSED; type: string | undefined }
  | ({
      event: typeof LOG_EVENT.SESSION_ENDED;
      finalization: Finalization;
      seconds: number | undefined;
    } & RelayCounts)
  | { event: typeof LOG_EVENT.SESSION_FAILED };

export type Log = (entry: LogEntry) => void;

/** One JSON line per entry on standard output, which is what the platform's function logs collect. */
export const standardOutputLog: Log = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};
