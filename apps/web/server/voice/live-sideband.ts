import { holdSocket, type LiveSideband, sidebandOverSocket } from "@sidecar/voice/live-session";
import { Effect, type Scope } from "effect";
import type { RawData, WebSocket } from "ws";
import type { LiveServerEvent } from "../live.js";
import { SOCKET_CLOSE_CODE } from "./relay.js";

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
 * before any listener sees them and holds what the session says before anyone
 * reads it.
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
    return yield* sidebandOverSocket(hold.socket);
  });
}

/**
 * A sideband whose every event is observed once before any listener reads
 * it: the record's writer sees the stream in the one order the session
 * emitted it, however many listeners the service and its graceful close
 * register, and the replay of what the session said before anyone listened
 * is kept, because the inner sideband is subscribed only when the first
 * listener arrives. A listener that leaves stops hearing; the observation
 * stands for the session.
 */
export function observedSideband(
  sideband: LiveSideband,
  observe: (event: LiveServerEvent) => void,
): LiveSideband {
  const listeners = new Set<(event: LiveServerEvent) => void>();
  let subscribed = false;
  return {
    onEvent: (listener) => {
      listeners.add(listener);
      if (!subscribed) {
        subscribed = true;
        sideband.onEvent((event) => {
          observe(event);
          for (const standing of [...listeners]) standing(event);
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    onClose: (listener) => sideband.onClose(listener),
    send: (event) => sideband.send(event),
    close: sideband.close,
  };
}
