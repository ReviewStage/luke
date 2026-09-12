import { setImmediate as immediate } from "node:timers/promises";
import type { WireRecord } from "@sidecar/wire";
import { holdSocket } from "./held-socket.js";
import type { ScheduledTimer } from "./live-session/append-channel.js";
import type { LiveSocket, OpenSocket, SocketClose, SocketOpening } from "./live-socket.js";

/**
 * Lets queued microtasks and immediates run. `ticks` is how many turns of
 * the immediate queue to allow, and a chain of N awaits needs N: a caller
 * states the length of the wait it is settling rather than guessing at a
 * round number.
 */
export async function drainMicrotasks(ticks = 30): Promise<void> {
  for (let turn = 0; turn < ticks; turn += 1) await immediate();
}

/**
 * A clock a test drives by hand: nothing is due until the test advances or
 * fires, so a deadline can be crossed without waiting out a real one.
 */
export class FakeClock {
  now: number;
  /** Every timer still armed, in the order it was scheduled. */
  readonly timers = new Map<
    ScheduledTimer,
    { callback: () => void; at: number; delayMs: number }
  >();
  /** Every delay ever asked for, in order, including timers since cancelled. */
  readonly delays: number[] = [];

  constructor(now = 1_800_000_000_000) {
    this.now = now;
  }

  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.delays.push(delayMs);
    this.timers.set(handle, { callback, at: this.now + delayMs, delayMs });
    return handle;
  };

  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };

  /** Runs every timer due at or before `untilMs`, in due order, draining between each. */
  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      await drainMicrotasks(20);
    }
    this.now = Math.max(this.now, untilMs);
  }

  /**
   * Runs every timer armed now, whatever its deadline, and only those: a
   * callback that arms another leaves it for the next fire.
   */
  fireAll(): void {
    for (const [handle, timer] of [...this.timers]) {
      this.timers.delete(handle);
      timer.callback();
    }
  }

  armed(): number {
    return this.timers.size;
  }
}

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

/** An `openSocket` seam that answers each open from a script and records what it was asked; the socket it answers with is held, as the seam's contract has it, and the script drives the raw socket beneath. */
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
    return answer(socket) ?? { socket: holdSocket(socket) };
  };
  return { openSocket, opens, sockets };
}
