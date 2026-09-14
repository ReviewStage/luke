import { closeEvent, type LiveSessionClosed } from "@sidecar/live";
import { Duration, Effect } from "effect";
import type { LiveSideband, SocketClose } from "../live-socket.js";

/**
 * The graceful close the conversations guide prescribes, over the sideband
 * seam alone: whoever holds the trusted side of a session ends it the same
 * way, so the desktop's host and the hosted voice service share this one
 * reading of `session.closed`.
 */

/** How long a graceful close waits for `session.closed` before finalization is reported incomplete. */
export const SIDEBAND_CLOSE_TIMEOUT_MS = 15_000;

export const SIDEBAND_CLOSE_OUTCOME = {
  /** `session.closed` arrived; its usage is final. */
  CLOSED: "closed",
  /** The socket ended before `session.closed`; final usage stays unconfirmed. */
  CONNECTION_LOST: "connection_lost",
  /** Nothing arrived inside the timeout; finalization is incomplete and the transport is released. */
  TIMED_OUT: "timed_out",
} as const;

export type SidebandCloseResult =
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.CLOSED; closed: LiveSessionClosed }
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST; close: SocketClose }
  | { outcome: typeof SIDEBAND_CLOSE_OUTCOME.TIMED_OUT };

export interface GracefulCloseOptions {
  eventId: string;
  /**
   * The session's last word as its own reader hands it up: the
   * `session.closed` it read, or the close that ended the arrivals before
   * one came. A sideband has one consumer, so the close asks the reader
   * that already stands rather than listening beside it, which is what
   * makes the final event impossible to miss between the send and a
   * listener registered after it.
   */
  settled: Effect.Effect<SidebandCloseResult>;
  timeoutMs?: number;
}

/**
 * Closes a session the way the guide says to: `session.close` is sent and the
 * sideband is held open until the reader's last word, or the timeout. The
 * transport is released only after one of the two; a socket closed first
 * would leave the final usage unconfirmed by the caller's own hand, so the
 * release is this close's own finalizer and runs on an interruption as well.
 * The wait is the ambient `Clock`'s, so whoever runs this close runs its
 * timeout too: a test on a `TestClock` gives up when it says so.
 */
export function closeGracefully(
  sideband: LiveSideband,
  options: GracefulCloseOptions,
): Effect.Effect<SidebandCloseResult> {
  return Effect.ensuring(
    Effect.andThen(
      sideband.send(closeEvent(options.eventId)),
      Effect.timeoutOrElse(options.settled, {
        duration: Duration.millis(options.timeoutMs ?? SIDEBAND_CLOSE_TIMEOUT_MS),
        orElse: (): Effect.Effect<SidebandCloseResult> =>
          Effect.succeed({ outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT }),
      }),
    ),
    sideband.close,
  );
}
