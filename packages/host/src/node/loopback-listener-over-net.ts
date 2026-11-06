import net from "node:net";
import { type Cause, Effect, Queue, Stream } from "effect";
import type { ListenOnLoopback, LoopbackConnection } from "../compose-port-forwards.js";

/**
 * loopback-listener-over-net.ts -- one forwarded port's listener on this Mac's `127.0.0.1`, over `node:net`: the seam the port-forward composer listens through.
 *
 * The server is the scope's: made, listened on, and closed with every
 * connection it accepted when the scope closes. It binds `127.0.0.1` alone,
 * never every interface, so the forward is the developer's and no other
 * machine's. A port another listener holds answers nothing rather than
 * failing, for the composer to try the next. What a connection receives is
 * handed on unbounded, since the tunnel it crosses has no backpressure; no
 * byte of it is read, logged, or kept here.
 */

const LOOPBACK = "127.0.0.1";

/** One accepted socket as a connection: its bytes read once its stream is run, and its end flushed before it closes. */
function connectionOf(socket: net.Socket): LoopbackConnection {
  return {
    received: Stream.callback<Uint8Array>((queue) =>
      Effect.sync(() => {
        socket.on("data", (data: Buffer) => Queue.offerUnsafe(queue, new Uint8Array(data)));
        socket.once("close", () => Queue.endUnsafe(queue));
        if (socket.destroyed) Queue.endUnsafe(queue);
      }),
    ),
    write: (bytes) =>
      Effect.sync(() => {
        if (socket.writable) socket.write(bytes);
      }),
    close: Effect.sync(() => {
      socket.end(() => socket.destroy());
    }),
  };
}

export const listenOnLoopbackOverNet: ListenOnLoopback = (port) =>
  Effect.gen(function* () {
    const accepted = yield* Queue.unbounded<LoopbackConnection, Cause.Done>();
    const sockets = new Set<net.Socket>();
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        net.createServer((socket) => {
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
          // A reset by the far side is told by the close that follows it.
          socket.on("error", () => undefined);
          Queue.offerUnsafe(accepted, connectionOf(socket));
        }),
      ),
      (server) =>
        Effect.sync(() => {
          server.close();
          for (const socket of sockets) socket.destroy();
          Queue.endUnsafe(accepted);
        }),
    );
    const listening = yield* Effect.callback<boolean>((resume) => {
      server.once("listening", () => resume(Effect.succeed(true)));
      server.once("error", () => resume(Effect.succeed(false)));
      server.listen({ host: LOOPBACK, port, exclusive: true });
    });
    return listening ? Stream.fromQueue(accepted) : undefined;
  });
