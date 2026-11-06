import net from "node:net";
import { type Cause, Effect, Queue, Stream } from "effect";
import type { ListenOnLoopback, LoopbackConnection } from "../compose-port-forwards.js";

const LOOPBACK = "127.0.0.1";

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
