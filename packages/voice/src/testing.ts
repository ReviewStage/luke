import assert from "node:assert/strict";
import type { LiveServerEvent } from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { Duration, Effect, Schedule, type Scope, Stream } from "effect";
import { type HeldSocket, holdSocket, type SocketHold } from "./held-socket.js";
import type {
  LiveSideband,
  OpenSocket,
  SocketArrival,
  SocketClose,
  SocketOpening,
} from "./live-socket.js";

/** How long a wait on an announced arrival stands before it fails, on the clock the test keeps. */
const ARRIVAL_BOUND = Duration.seconds(2);

const POLL = {
  SPACING: Duration.millis(5),
  ATTEMPTS: 400,
} as const;

const changeListeners = new Set<() => void>();

/** Tells every waiter that a fake moved: a socket sent or was closed, a seam opened one, a reading heard one. */
function announceChange(): void {
  for (const listener of [...changeListeners]) listener();
}

/**
 * Hears every change of every fake in this module, so a wait on a condition
 * over them (`arrival(onFakeChange, ...)`) is woken by the change itself and
 * polls nothing.
 */
export function onFakeChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/**
 * Polls `ready` on a `Schedule` until it answers true, or fails naming what
 * it waited for: the wait for a condition nothing announces, such as a row a
 * real database has to land, on whatever clock the test keeps.
 */
export function polled(
  ready: () => boolean | Promise<boolean>,
  waitedFor: string | (() => string | Promise<string>),
): Effect.Effect<void> {
  return Effect.repeat(
    Effect.promise(async () => ready()),
    {
      schedule: Schedule.spaced(POLL.SPACING).pipe(Schedule.upTo({ times: POLL.ATTEMPTS })),
      until: (answered: boolean): boolean => answered,
    },
  ).pipe(
    Effect.flatMap((answered) =>
      Effect.promise(async () => {
        if (answered) return;
        const what = typeof waitedFor === "string" ? waitedFor : await waitedFor();
        assert.fail(`timed out waiting for ${what}`);
      }),
    ),
  );
}

/**
 * Waits for `ready` to hold, told by `subscribe` each time something arrives,
 * and polls nothing: a test that waited a fixed pause raced the event under
 * load and read before it arrived, and a poll on a timer is a wait on time
 * rather than on the event. Fails after the bound naming what it waited for.
 */
export function arrival(
  subscribe: (notify: () => void) => () => void,
  ready: () => boolean,
  waitedFor: string,
): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (ready()) {
      resume(Effect.void);
      return;
    }
    const unsubscribe = subscribe(() => {
      if (!ready()) return;
      unsubscribe();
      resume(Effect.void);
    });
    return Effect.sync(unsubscribe);
  }).pipe(
    Effect.timeoutOrElse({
      duration: ARRIVAL_BOUND,
      orElse: () => Effect.sync(() => assert.fail(`timed out waiting for ${waitedFor}`)),
    }),
  );
}

/**
 * A scripted socket for the sources' tests: what the source sent is kept,
 * and the test feeds frames and closes from the far side. It holds what it
 * hears exactly as a real socket does, so it is the held socket an opening
 * answers with rather than something a hold is put around.
 */
export class FakeLiveSocket implements HeldSocket {
  readonly sent: string[] = [];
  /** Every frame and close the far side delivered, in order, so a test can wait on a scripted answer's delivery. */
  readonly received: SocketArrival[] = [];
  closedByClient = false;
  readonly #sentListeners = new Set<(data: string) => void>();
  readonly #hold: SocketHold = holdSocket({
    send: (data) => {
      this.sent.push(data);
      for (const listener of [...this.#sentListeners]) listener(data);
      announceChange();
    },
    close: () => {
      this.closedByClient = true;
      announceChange();
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
    this.#hear({ frame: data });
  }

  closeFromServer(close: SocketClose = {}): void {
    this.#hear({ close });
  }

  #hear(heard: SocketArrival): void {
    this.received.push(heard);
    this.#hold.hear(heard);
    announceChange();
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
      const opening = answer(socket) ?? { socket };
      announceChange();
      return opening;
    });
  return { openSocket, opens, sockets };
}

/** What one reader of a sideband heard, in arrival order: the events it read, then the close that ended them. */
interface SidebandReading {
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
    Stream.runForEach(sideband.arrivals, (heard) =>
      Effect.sync(() => {
        if ("close" in heard) reading.closes.push(heard.close);
        else reading.events.push(heard.event);
        announceChange();
      }),
    ),
  );
  return reading;
});
