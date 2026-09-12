import type { LiveSocket, SocketClose } from "./live-socket.js";

/**
 * The hold's two numbers. A held socket is one nobody listens to yet, and on
 * the voice path frames arrive at audio rate, so a hold with no ceiling is a
 * fast leak the first time a socket is opened and forgotten. The sites that
 * hold release within one tick to a few milliseconds, so 256 frames is orders
 * of magnitude above any of them while capping a forgotten socket near a
 * megabyte; a hold that reaches it gives up its frames, closes the socket, and
 * the close it delivers carries the overflow code, so a consumer arriving late
 * learns why the session ended rather than finding it quietly gone.
 */
export const HELD_SOCKET = {
  FRAME_LIMIT: 256,
  OVERFLOW_CLOSE_CODE: 4001,
} as const;

/** The first thing the far side did on a held socket: a frame, or a close before any frame. */
export type HeldArrival = { readonly frame: string } | { readonly close: SocketClose };

/**
 * A socket whose frames and close are held from the instant it was wrapped
 * until a consumer listens, and whose first frame a handshake can take
 * without releasing the hold.
 */
export interface HeldSocket extends LiveSocket {
  /**
   * The first frame held, or the close that came before any frame, for a
   * handshake that reads one answer and hands everything after it on. The
   * hold stands throughout: the frames behind the answer wait for the first
   * `onMessage` listener, which is what closes the gap between a handshake
   * that settled and a consumer that subscribes in the continuation.
   */
  takeFirst(): Promise<HeldArrival>;
  /**
   * Withdraws a `takeFirst` still waiting, for a handshake that gave up on its
   * deadline: what arrives afterwards is held for the consumer like any other
   * frame rather than handed to a waiter nobody will read.
   */
  cancelFirst(): void;
}

/**
 * Holds a socket's frames and its close from the moment it is wrapped, which
 * must be the moment the frames could start: inside the transport's own open
 * handler, or before the handshake frame is sent. `ws` flushes the bytes that
 * followed the handshake response on the next tick, ahead of any promise
 * continuation, and a listener removed and re-registered across an `await`
 * opens the same gap one layer up; in both a frame emitted to no listener is
 * gone without a trace. Here nothing is emitted to no listener.
 *
 * Release is per channel. Frames release at the first `onMessage` listener,
 * which is replayed what was held in order, once, and every listener then
 * hears frames as they arrive. The one held close waits for the first
 * `onClose` listener however late it comes: it is a single value, so keeping
 * it costs nothing, and a consumer that never asks for closes is one that was
 * told of none before this hold existed either.
 */
export function holdSocket(socket: LiveSocket): HeldSocket {
  const messageListeners = new Set<(data: string) => void>();
  const closeListeners = new Set<(close: SocketClose) => void>();
  let heldFrames: string[] | undefined = [];
  let heldClose: SocketClose | undefined;
  let closeReleased = false;
  let overflowed = false;
  let waiting: ((arrival: HeldArrival) => void) | undefined;

  const arrive = (arrival: HeldArrival) => {
    const waiter = waiting;
    waiting = undefined;
    waiter?.(arrival);
  };

  socket.onMessage((data) => {
    if (heldFrames === undefined) {
      for (const listener of [...messageListeners]) listener(data);
      return;
    }
    if (waiting !== undefined) {
      arrive({ frame: data });
      return;
    }
    if (overflowed) return;
    if (heldFrames.length >= HELD_SOCKET.FRAME_LIMIT) {
      overflowed = true;
      heldFrames = [];
      heldClose ??= { code: HELD_SOCKET.OVERFLOW_CLOSE_CODE };
      socket.close();
      return;
    }
    heldFrames.push(data);
  });
  socket.onClose((close) => {
    if (closeReleased) {
      for (const listener of [...closeListeners]) listener(close);
      return;
    }
    heldClose ??= close;
    arrive({ close: heldClose });
  });

  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (listener) => {
      messageListeners.add(listener);
      if (heldFrames !== undefined) {
        const replay = heldFrames;
        heldFrames = undefined;
        for (const data of replay) listener(data);
      }
      return () => {
        messageListeners.delete(listener);
      };
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      if (!closeReleased) {
        closeReleased = true;
        if (heldClose !== undefined) listener(heldClose);
      }
      return () => {
        closeListeners.delete(listener);
      };
    },
    takeFirst: () =>
      new Promise<HeldArrival>((resolve) => {
        const first = heldFrames?.shift();
        if (first !== undefined) {
          resolve({ frame: first });
          return;
        }
        if (heldClose !== undefined) {
          resolve({ close: heldClose });
          return;
        }
        waiting = resolve;
      }),
    cancelFirst: () => {
      waiting = undefined;
    },
  };
}
