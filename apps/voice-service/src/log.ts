import type { HostedApiError } from "@sidecar/hosted";
import type { VoiceRoute } from "./frames.js";

/**
 * What the service writes down about itself: status codes, close codes,
 * outcome names, and counts. No line carries a session id, a bearer, an SDP,
 * a transcript fragment, or any frame's content, so a log this service kept
 * for a year would still say nothing about anyone's conversation.
 */
export const LOG_EVENT = {
  LISTENING: "listening",
  /** A handshake refused before any socket stood: the HTTP status says why. */
  UPGRADE_REFUSED: "upgrade-refused",
  /** A socket refused after standing: the reason frame the desktop was sent says why. */
  SESSION_REFUSED: "session-refused",
  SESSION_CREATED: "session-created",
  GREETING_SENT: "greeting-sent",
  USAGE_REPORTED: "usage-reported",
  SESSION_ENDED: "session-ended",
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
  framesToDesktop: number;
  bytesToDesktop: number;
  /** Reflected audio frames dropped by type, never forwarded. */
  droppedAudio: number;
  /** Frames a route does not permit in that direction, dropped by type. */
  droppedUnpermitted: number;
}

export type LogEntry =
  | { event: typeof LOG_EVENT.LISTENING; host: string; port: number }
  | { event: typeof LOG_EVENT.UPGRADE_REFUSED; route: string; status: number }
  | { event: typeof LOG_EVENT.SESSION_REFUSED; route: VoiceRoute; reason: HostedApiError }
  | { event: typeof LOG_EVENT.SESSION_CREATED; route: VoiceRoute }
  | { event: typeof LOG_EVENT.GREETING_SENT; route: VoiceRoute }
  | {
      event: typeof LOG_EVENT.USAGE_REPORTED;
      route: VoiceRoute;
      seconds: number;
      /** The account service's status, or nothing when the report never reached it. */
      status: number | undefined;
    }
  | ({
      event: typeof LOG_EVENT.SESSION_ENDED;
      route: VoiceRoute;
      finalization: Finalization;
      seconds: number | undefined;
    } & RelayCounts);

export type Log = (entry: LogEntry) => void;

/** One JSON line per entry on standard output, which is what a container platform collects. */
export const standardOutputLog: Log = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};
