import type { LiveServerEvent } from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { Effect, type Scope, Stream } from "effect";
import { type HeldSocket, holdSocket, type SocketHold } from "./held-socket.js";
import type {
  LiveSideband,
  OpenSocket,
  SocketArrival,
  SocketClose,
  SocketOpening,
} from "./live-socket.js";

/**
 * A scripted socket for the sources' tests: what the source sent is kept,
 * and the test feeds frames and closes from the far side. It holds what it
 * hears exactly as a real socket does, so it is the held socket an opening
 * answers with rather than something a hold is put around.
 */
export class FakeLiveSocket implements HeldSocket {
  readonly sent: string[] = [];
  closedByClient = false;
  readonly #sentListeners = new Set<(data: string) => void>();
  readonly #hold: SocketHold = holdSocket({
    send: (data) => {
      this.sent.push(data);
      for (const listener of [...this.#sentListeners]) listener(data);
    },
    close: () => {
      this.closedByClient = true;
    },
  });

  send(data: string): void {
    this.#hold.socket.send(data);
  }

  /** Hears what the source sends, so a script can answer the frame it was sent. */
  onSent(listener: (data: string) => void): () => void {
    this.#sentListeners.add(listener);
    return () => {
      this.#sentListeners.delete(listener);
    };
  }

  close(): void {
    this.#hold.socket.close();
  }

  get arrivals(): Stream.Stream<SocketArrival> {
    return this.#hold.socket.arrivals;
  }

  get takeFirst(): Effect.Effect<SocketArrival> {
    return this.#hold.socket.takeFirst;
  }

  ignore(): void {
    this.#hold.socket.ignore();
  }

  /** Delivers one frame from the far side, encoded as the service would send it. */
  receive(frame: WireRecord): void {
    this.receiveText(JSON.stringify(frame));
  }

  /** Delivers raw text from the far side, for a frame that is not JSON at all. */
  receiveText(data: string): void {
    this.#hold.hear({ frame: data });
  }

  closeFromServer(close: SocketClose = {}): void {
    this.#hold.hear({ close });
  }
}

interface RecordedOpen {
  url: string;
  headers: Readonly<Record<string, string>>;
}

/** What one scripted open does: refuse, or take the fresh socket and answer with it. */
export type ScriptedOpening = (socket: FakeLiveSocket) => SocketOpening | undefined;

export interface ScriptedSocketSeam {
  openSocket: OpenSocket;
  opens: RecordedOpen[];
  sockets: FakeLiveSocket[];
}

/** An `openSocket` seam that answers each open from a script and records what it was asked; the socket it answers with holds what it hears, as the seam's contract has it, and the script drives it from the far side. */
export function scriptedOpenSocket(answers: ScriptedOpening[]): ScriptedSocketSeam {
  const opens: RecordedOpen[] = [];
  const sockets: FakeLiveSocket[] = [];
  let call = 0;
  const openSocket: OpenSocket = (url, headers) =>
    Effect.sync(() => {
      opens.push({ url, headers });
      const socket = new FakeLiveSocket();
      sockets.push(socket);
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      if (!answer) throw new Error("no scripted opening");
      return answer(socket) ?? { socket };
    });
  return { openSocket, opens, sockets };
}

/** What one reader of a sideband heard, in arrival order: the events it read, then the close that ended them. */
export interface SidebandReading {
  readonly events: LiveServerEvent[];
  readonly closes: SocketClose[];
}

/**
 * Reads a sideband the way the session's own reader does — one consumer, on a
 * fiber of the scope this is yielded in — and answers what it has heard so
 * far, which a test reads after giving that fiber its turns.
 */
export const readSideband = /* @__PURE__ */ Effect.fnUntraced(function* (
  sideband: LiveSideband,
): Effect.fn.Return<SidebandReading, never, Scope.Scope> {
  const reading: SidebandReading = { events: [], closes: [] };
  yield* Effect.forkScoped(
    Stream.runForEach(sideband.arrivals, (arrival) =>
      Effect.sync(() => {
        if ("close" in arrival) reading.closes.push(arrival.close);
        else reading.events.push(arrival.event);
      }),
    ),
  );
  return reading;
});
