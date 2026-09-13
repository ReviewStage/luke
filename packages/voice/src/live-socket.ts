import {
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEvent,
  parseLiveServerEvent,
} from "@sidecar/live";
import { Effect, type Scope, Stream } from "effect";
import type { HeldSocket } from "./held-socket.js";

/**
 * The socket seam a live session source opens its trusted connections
 * through: OpenAI's attach endpoint on the keyed tier, Luke's voice service on
 * the hosted one. The seam is injected so this package never reaches `ws`;
 * the host implements it over `ws`, and a test hands in a scripted socket.
 */

/** Why a socket never opened: the server answered the upgrade with a status, or nothing answered. */
export const SOCKET_OPEN_FAULT = {
  REFUSED: "refused",
  NETWORK: "network",
} as const;

export type SocketOpenFault = (typeof SOCKET_OPEN_FAULT)[keyof typeof SOCKET_OPEN_FAULT];

/** How a socket ended, as the transport reported it; the code is the close frame's where one arrived. */
export interface SocketClose {
  code?: number;
}

/** What the far side of a socket handed up: one text frame, or the close that ended it. */
export type SocketArrival = { readonly frame: string } | { readonly close: SocketClose };

/** The two verbs the trusted side has on a socket; what the socket says is the hold's to hand up. */
export interface SocketVerbs {
  send(data: string): void;
  close(): void;
}

/** An open socket: text frames out, and one stream of everything the far side said. */
export interface LiveSocket extends SocketVerbs {
  /**
   * Every frame the far side sent and then the close that ended it, in
   * arrival order, ending with that close. The stream is held from the
   * socket's own beginning (`holdSocket`), so what arrived before a consumer
   * came is replayed to the first one to arrive rather than emitted to
   * nobody, and one consumer runs it, in the scope its connection stands for.
   */
  readonly arrivals: Stream.Stream<SocketArrival>;
}

export type SocketOpenFailure =
  | { fault: typeof SOCKET_OPEN_FAULT.REFUSED; status: number }
  | {
      fault: typeof SOCKET_OPEN_FAULT.NETWORK;
      /** The kind of error the attempt ended with, never its words, which could carry a credential. */
      errorName?: string;
    };

export type SocketOpening = { socket: HeldSocket } | SocketOpenFailure;

export function socketOpened(opening: SocketOpening): opening is { socket: HeldSocket } {
  return "socket" in opening;
}

/**
 * Opens one WebSocket and answers once the handshake has: with the socket, or
 * with why the upgrade was refused. The headers are the handshake's alone, and
 * the one this package ever sets is the bearer the endpoint takes. The socket
 * answered with is held (`holdSocket`) from inside the transport's own open
 * handler, so a frame or a close in the handshake's own chunk waits for the
 * consumer that runs its stream afterwards; every implementation of this seam,
 * the host's over `ws` and the tests' scripted one, keeps that contract. The
 * open is an effect, so an attempt interrupted before the handshake settled
 * takes the socket it started with it rather than leaving one connecting
 * behind.
 */
export type OpenSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Effect.Effect<SocketOpening>;

/**
 * The trusted side's view of one running session: every event the session
 * emits, parsed, and the client events the trusted side may send. The host's
 * live session service is the one consumer; the renderer's data channel is
 * never a sideband.
 */
export interface LiveSideband {
  onEvent(listener: (event: LiveServerEvent) => void): () => void;
  onClose(listener: (close: SocketClose) => void): () => void;
  send(event: LiveClientEvent): Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

const REFLECTED_AUDIO_TYPES: ReadonlySet<string> = new Set([
  LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
]);

/**
 * A sideband over an open socket. The socket's arrivals are pumped by one
 * fiber of the scope this is yielded in — the scope the connection itself
 * stands for — so closing that scope ends the reading as it ends the session.
 * Frames that are not events this build reads are discarded, and the two
 * reflected audio events are dropped by type before any listener sees them:
 * the developer's voice is heard by the model over the media track and is
 * never kept or read here. Events and a close that arrive before anyone
 * listens are held and replayed to the first listener, so a session that
 * spoke between its creation and the host's attach loses nothing, and a
 * socket that died in that gap is seen dead.
 */
export function sidebandOverSocket(
  socket: LiveSocket,
): Effect.Effect<LiveSideband, never, Scope.Scope> {
  return Effect.gen(function* () {
    const eventListeners = new Set<(event: LiveServerEvent) => void>();
    const closeListeners = new Set<(close: SocketClose) => void>();
    let heldEvents: LiveServerEvent[] = [];
    let heldClose: SocketClose | undefined;

    const heard = (arrival: SocketArrival): void => {
      if ("close" in arrival) {
        if (closeListeners.size === 0) {
          heldClose = arrival.close;
          return;
        }
        for (const listener of [...closeListeners]) listener(arrival.close);
        return;
      }
      const event = parseLiveServerEvent(arrival.frame);
      if (event === undefined || REFLECTED_AUDIO_TYPES.has(event.type)) return;
      if (eventListeners.size === 0) {
        heldEvents.push(event);
        return;
      }
      for (const listener of [...eventListeners]) listener(event);
    };

    yield* Effect.forkScoped(
      Stream.runForEach(socket.arrivals, (arrival) => Effect.sync(() => heard(arrival))),
    );

    return {
      onEvent: (listener) => {
        eventListeners.add(listener);
        const replay = heldEvents;
        heldEvents = [];
        for (const event of replay) listener(event);
        return () => {
          eventListeners.delete(listener);
        };
      },
      onClose: (listener) => {
        closeListeners.add(listener);
        if (heldClose !== undefined) {
          const close = heldClose;
          heldClose = undefined;
          listener(close);
        }
        return () => {
          closeListeners.delete(listener);
        };
      },
      send: (event) => Effect.sync(() => socket.send(JSON.stringify(event))),
      close: Effect.sync(() => socket.close()),
    };
  });
}
