import { Effect, Queue, Stream } from "effect";
import type { LiveSocket, SocketArrival, SocketClose, SocketVerbs } from "./live-socket.js";

/**
 * The hold's two numbers. A held socket is one nobody reads yet, and on the
 * voice path frames arrive at audio rate, so a hold with no ceiling is a fast
 * leak the first time a socket is opened and forgotten. The sites that hold
 * release within one tick to a few milliseconds, so 256 frames is orders of
 * magnitude above any of them while capping a forgotten socket near a
 * megabyte; a hold that reaches it gives up its frames, closes the socket, and
 * the close it delivers carries the overflow code, so a consumer arriving late
 * learns why the session ended rather than finding it quietly gone.
 */
export const HELD_SOCKET = {
  FRAME_LIMIT: 256,
  OVERFLOW_CLOSE_CODE: 4001,
} as const;

/**
 * A socket whose frames and close are held from the instant it was made
 * until a consumer runs its stream, and whose first frame a handshake can
 * take without releasing the hold.
 */
export interface HeldSocket extends LiveSocket {
  /**
   * The first arrival held, or the close that came before any frame. The hold
   * stands throughout: the frames behind the answer wait for the consumer
   * that runs `arrivals`, which is what closes the gap between a handshake
   * that settled and a consumer that comes after it. Interrupting the
   * wait — a deadline above it, or a hang-up — withdraws it, so it hands
   * nothing to anyone and what arrives afterwards is held for the consumer
   * like any other frame rather than delivered to a waiter nobody will read.
   */
  readonly takeFirst: Effect.Effect<SocketArrival>;
  /**
   * Releases the hold to nobody: what is held and what arrives afterwards is
   * dropped rather than kept, for the one socket kept open and never
   * read — the introduction's, whose close is the hang-up the voice service
   * waits for — so its hold cannot fill toward the bound and close it. A
   * socket a consumer will run is never ignored.
   */
  ignore(): void;
}

/** A socket's hold, and the one hand that fills it from where the transport hears the far side. */
export interface SocketHold {
  readonly socket: HeldSocket;
  /**
   * What the far side said, offered from inside the transport's own handler,
   * where no fiber runs. A socket closes once: the first close is the state,
   * and what follows it is dropped.
   */
  hear(arrival: SocketArrival): void;
}

/**
 * Holds a socket's frames and its close from the moment it is made, which
 * must be the moment the frames could start: inside the transport's own open
 * handler, or before the handshake frame is sent. `ws` flushes the bytes that
 * followed the handshake response on the next tick, ahead of any fiber the
 * caller forks, and a stream subscribed and re-subscribed across a step opens
 * the same gap one layer up; in both a frame emitted to no consumer is gone
 * without a trace. Here nothing is emitted to no consumer, which is why the
 * hold is a plain hand the transport calls rather than a stream of its own:
 * it stands before any fiber does.
 *
 * Release is per channel, and the two channels differ in kind. Frames are a
 * stream: they release to the first consumer of `arrivals`, which is replayed
 * what was held in order, once, and every consumer then hears frames as they
 * arrive. A close is a state: once the socket has closed, every consumer that
 * runs `arrivals` afterwards is handed that close and nothing more, however
 * late it comes and however many there are, because a socket that ended in
 * the gap is still ended for the sideband that comes after the flag that came
 * first.
 */
export function holdSocket(verbs: SocketVerbs): SocketHold {
  const consumers = new Set<(arrival: SocketArrival) => void>();
  let heldFrames: string[] | undefined = [];
  let closed: SocketClose | undefined;
  let overflowed = false;
  let waiting: ((arrival: SocketArrival) => void) | undefined;

  const arrive = (arrival: SocketArrival) => {
    const waiter = waiting;
    waiting = undefined;
    waiter?.(arrival);
  };

  /** The arrival a wait would settle with at once: the frame at the head of the hold, or the close that ended it. */
  const held = (): SocketArrival | undefined => {
    const first = heldFrames?.shift();
    if (first !== undefined) return { frame: first };
    if (closed !== undefined) return { close: closed };
    return undefined;
  };

  const tell = (arrival: SocketArrival) => {
    for (const consumer of [...consumers]) consumer(arrival);
  };

  const hearFrame = (arrival: { readonly frame: string }) => {
    if (heldFrames === undefined) {
      tell(arrival);
      return;
    }
    if (waiting !== undefined) {
      arrive(arrival);
      return;
    }
    if (overflowed) return;
    if (heldFrames.length >= HELD_SOCKET.FRAME_LIMIT) {
      overflowed = true;
      heldFrames = [];
      closed = { code: HELD_SOCKET.OVERFLOW_CLOSE_CODE };
      tell({ close: closed });
      verbs.close();
      return;
    }
    heldFrames.push(arrival.frame);
  };

  const hear = (arrival: SocketArrival) => {
    if (!("close" in arrival)) {
      hearFrame(arrival);
      return;
    }
    // A socket closes once; the first close is the state, and the close an overflow chose stands
    // over the transport's own that follows it.
    if (closed !== undefined) return;
    closed = arrival.close;
    tell(arrival);
    arrive(arrival);
  };

  /**
   * One consumer's reading of the hold: what was held first and in order,
   * then what arrives while it reads, and the close as the last of it.
   */
  // No `bufferSize`, so the queue behind the callback is unbounded: the replay
  // of a full hold is offered in one synchronous burst and must not drop.
  const arrivals = Stream.callback<SocketArrival>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const consumer = (arrival: SocketArrival) => {
          Queue.offerUnsafe(queue, arrival);
          if ("close" in arrival) Queue.endUnsafe(queue);
        };
        consumers.add(consumer);
        const replay = heldFrames ?? [];
        heldFrames = undefined;
        for (const frame of replay) Queue.offerUnsafe(queue, { frame });
        if (closed !== undefined) {
          Queue.offerUnsafe(queue, { close: closed });
          Queue.endUnsafe(queue);
        }
        return consumer;
      }),
      (consumer) =>
        Effect.sync(() => {
          consumers.delete(consumer);
        }),
    ),
  );

  return {
    socket: {
      send: (data) => verbs.send(data),
      close: () => verbs.close(),
      arrivals,
      takeFirst: Effect.callback<SocketArrival>((resume) => {
        const arrival = held();
        if (arrival !== undefined) {
          resume(Effect.succeed(arrival));
          return Effect.void;
        }
        const waiter = (waited: SocketArrival) => resume(Effect.succeed(waited));
        waiting = waiter;
        return Effect.sync(() => {
          if (waiting === waiter) waiting = undefined;
        });
      }),
      ignore: () => {
        heldFrames = undefined;
      },
    },
    hear,
  };
}
