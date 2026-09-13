import {
  closeEvent,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  type LiveSessionClosed,
} from "@sidecar/live";
import { Deferred, Duration, Effect, Exit } from "effect";
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
  timeoutMs?: number;
}

/**
 * Closes a session the way the guide says to: the `session.closed` listener
 * is registered first, then `session.close` is sent, and the sideband is held
 * open until the final event, the socket's own end, or the timeout. The
 * listeners and the transport are a scope of this close's own, released in
 * that order and only after one of those three; a socket closed first would
 * leave the final usage unconfirmed by the caller's own hand. The wait is the
 * ambient `Clock`'s, so whoever runs this close runs its timeout too: a test
 * on a `TestClock` gives up when it says so, and the fiber that gave up
 * closes the scope on its way out exactly as the timeout does.
 */
export function closeGracefully(
  sideband: LiveSideband,
  options: GracefulCloseOptions,
): Effect.Effect<SidebandCloseResult> {
  return Effect.scoped(
    Effect.gen(function* () {
      const settled = yield* Deferred.make<SidebandCloseResult>();
      const finish = (result: SidebandCloseResult) => {
        Deferred.unsafeDone(settled, Exit.succeed(result));
      };
      yield* Effect.addFinalizer(() => sideband.close);
      yield* Effect.acquireRelease(
        Effect.sync(() => ({
          stopEvents: sideband.onEvent((event: LiveServerEvent) => {
            if (event.type === LIVE_SERVER_EVENT.SESSION_CLOSED) {
              finish({ outcome: SIDEBAND_CLOSE_OUTCOME.CLOSED, closed: event });
            }
          }),
          stopClose: sideband.onClose((close) =>
            finish({ outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST, close }),
          ),
        })),
        ({ stopEvents, stopClose }) =>
          Effect.sync(() => {
            stopEvents();
            stopClose();
          }),
      );
      yield* sideband.send(closeEvent(options.eventId));
      return yield* Effect.timeoutTo(Deferred.await(settled), {
        duration: Duration.millis(options.timeoutMs ?? SIDEBAND_CLOSE_TIMEOUT_MS),
        onSuccess: (result: SidebandCloseResult) => result,
        onTimeout: (): SidebandCloseResult => ({ outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT }),
      });
    }),
  );
}
