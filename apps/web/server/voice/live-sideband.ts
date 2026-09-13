import { holdSocket, type LiveSideband, sidebandOverSocket } from "@sidecar/voice/live-session";
import { Effect, type Scope, Stream } from "effect";
import type { RawData, WebSocket } from "ws";
import type { LiveServerEvent } from "../live.js";
import { SOCKET_CLOSE_CODE } from "./socket.js";

/**
 * The service's half of the trusted sideband: the socket the upstream
 * attached to a session, read as the `LiveSideband` the live session service
 * consumes. `@sidecar/voice` names no socket library — its sources open
 * connections through an injected seam — so the `ws` binding lives here,
 * where the relay already reaches it, and the web reaches that package only
 * through its live-session door, never the barrel, so nothing the package
 * later adds behind the barrel can enter a function bundle from here. What
 * arrives is parsed with the Live grammar by the package's own
 * `sidebandOverSocket`, which drops the two reflected audio events by type
 * before the session's reader sees them; the hold beneath it is what keeps
 * what the session said before that reader came.
 *
 * The `ws` listeners are the acquire of the scope the sideband is yielded
 * in and are taken off at its close, so a session the exchange stopped
 * standing for leaves nothing listening on a socket the relay still pipes.
 * The socket is paused until every consumer stands, which is what makes
 * registering here rather than at the socket's own open lose nothing.
 */

export function upstreamSideband(
  socket: WebSocket,
): Effect.Effect<LiveSideband, never, Scope.Scope> {
  return Effect.gen(function* () {
    const hold = holdSocket({
      send: (data) => socket.send(data),
      close: () => socket.close(SOCKET_CLOSE_CODE.NORMAL),
    });
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const onMessage = (data: RawData, isBinary: boolean) => {
          if (isBinary) return;
          hold.hear({ frame: data.toString() });
        };
        const onClose = (code: number) => hold.hear({ close: { code } });
        socket.on("message", onMessage);
        socket.on("close", onClose);
        return { onMessage, onClose };
      }),
      ({ onMessage, onClose }) =>
        Effect.sync(() => {
          socket.off("message", onMessage);
          socket.off("close", onClose);
        }),
    );
    return sidebandOverSocket(hold.socket);
  });
}

/**
 * A sideband whose every event is observed once on its way past: the record's
 * writer sees the stream in the one order the session emitted it, because the
 * observation rides on the arrivals the session's one reader runs rather than
 * standing beside it, and the replay of what the session said before that
 * reader came is observed with the rest of it.
 */
export function observedSideband(
  sideband: LiveSideband,
  observe: (event: LiveServerEvent) => void,
): LiveSideband {
  return {
    ...sideband,
    arrivals: Stream.tap(sideband.arrivals, (arrival) =>
      "close" in arrival ? Effect.void : Effect.sync(() => observe(arrival.event)),
    ),
  };
}
