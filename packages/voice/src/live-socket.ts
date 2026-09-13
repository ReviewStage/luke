import {
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEvent,
  parseLiveServerEvent,
} from "@sidecar/live";
import { Effect, Option, Stream } from "effect";
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
 * What the trusted side of one session heard: an event it reads, or the close
 * that ended the socket the session stood on.
 */
export type SidebandArrival = { readonly event: LiveServerEvent } | { readonly close: SocketClose };

/**
 * The trusted side's view of one running session: every event the session
 * emits, parsed, and the client events the trusted side may send. The host's
 * live session service is the one consumer; the renderer's data channel is
 * never a sideband.
 */
export interface LiveSideband {
  /**
   * Every event the session emitted and then the close that ended it, in
   * arrival order, ending with that close. One consumer runs it — the
   * session's own reader, on a fiber of the scope the session stands
   * for — because what it carries is held by the socket beneath it only until
   * the first consumer comes.
   */
  readonly arrivals: Stream.Stream<SidebandArrival>;
  send(event: LiveClientEvent): Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

const REFLECTED_AUDIO_TYPES: ReadonlySet<string> = new Set([
  LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
]);

/**
 * A sideband over an open socket: the socket's own arrivals read as the Live
 * grammar. Frames that are not events this build reads are discarded, and the
 * two reflected audio events are dropped by type before the consumer sees
 * them: the developer's voice is heard by the model over the media track and
 * is never kept or read here. Nothing is held or pumped at this layer,
 * because the socket holds its own arrivals until the consumer that runs
 * them comes (`holdSocket`): a session that spoke between its creation and
 * the host's attach is read by the first consumer all the same, and a socket
 * that died in that gap is seen dead.
 */
export function sidebandOverSocket(socket: LiveSocket): LiveSideband {
  return {
    arrivals: Stream.filterMap(socket.arrivals, (arrival): Option.Option<SidebandArrival> => {
      if ("close" in arrival) return Option.some({ close: arrival.close });
      const event = parseLiveServerEvent(arrival.frame);
      if (event === undefined || REFLECTED_AUDIO_TYPES.has(event.type)) return Option.none();
      return Option.some({ event });
    }),
    send: (event) => Effect.sync(() => socket.send(JSON.stringify(event))),
    close: Effect.sync(() => socket.close()),
  };
}
