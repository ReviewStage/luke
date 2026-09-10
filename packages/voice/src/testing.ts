import type { WireRecord } from "@sidecar/wire";
import type { LiveSocket, OpenSocket, SocketClose, SocketOpening } from "./live-socket.js";

/**
 * A scripted socket for the sources' tests: what the source sent is kept,
 * and the test feeds frames and closes from the far side.
 */
export class FakeLiveSocket implements LiveSocket {
  readonly sent: string[] = [];
  closedByClient = false;
  readonly #sentListeners = new Set<(data: string) => void>();
  readonly #messageListeners = new Set<(data: string) => void>();
  readonly #closeListeners = new Set<(close: SocketClose) => void>();

  send(data: string): void {
    this.sent.push(data);
    for (const listener of [...this.#sentListeners]) listener(data);
  }

  /** Hears what the source sends, so a script can answer the frame it was sent. */
  onSent(listener: (data: string) => void): () => void {
    this.#sentListeners.add(listener);
    return () => {
      this.#sentListeners.delete(listener);
    };
  }

  close(): void {
    this.closedByClient = true;
  }

  onMessage(listener: (data: string) => void): () => void {
    this.#messageListeners.add(listener);
    return () => {
      this.#messageListeners.delete(listener);
    };
  }

  onClose(listener: (close: SocketClose) => void): () => void {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  /** Delivers one frame from the far side, encoded as the service would send it. */
  receive(frame: WireRecord): void {
    this.receiveText(JSON.stringify(frame));
  }

  /** Delivers raw text from the far side, for a frame that is not JSON at all. */
  receiveText(data: string): void {
    for (const listener of [...this.#messageListeners]) listener(data);
  }

  closeFromServer(close: SocketClose = {}): void {
    for (const listener of [...this.#closeListeners]) listener(close);
  }

  get listenerCounts(): ListenerCounts {
    return { messages: this.#messageListeners.size, closes: this.#closeListeners.size };
  }
}

/** How many listeners still stand on a socket, so a test can see a settled wait let go of it. */
export interface ListenerCounts {
  messages: number;
  closes: number;
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

/** An `openSocket` seam that answers each open from a script and records what it was asked. */
export function scriptedOpenSocket(answers: ScriptedOpening[]): ScriptedSocketSeam {
  const opens: RecordedOpen[] = [];
  const sockets: FakeLiveSocket[] = [];
  let call = 0;
  const openSocket: OpenSocket = async (url, headers) => {
    opens.push({ url, headers });
    const socket = new FakeLiveSocket();
    sockets.push(socket);
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted opening");
    return answer(socket) ?? { socket };
  };
  return { openSocket, opens, sockets };
}
