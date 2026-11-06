import { once } from "node:events";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ephemeralCluster } from "./cluster.ts";

function accepts(port: number) {
  return Effect.promise(async () => {
    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      return true;
    } catch {
      return false;
    } finally {
      socket.destroy();
    }
  });
}

describe("ephemeralCluster", () => {
  it.effect("stops its server and deletes its folder when its scope closes", () =>
    Effect.gen(function* () {
      const cluster = yield* Effect.scoped(
        Effect.tap(ephemeralCluster, (running) =>
          Effect.gen(function* () {
            expect(existsSync(running.folder)).toBe(true);
            expect(yield* accepts(running.port)).toBe(true);
          }),
        ),
      );
      expect(existsSync(cluster.folder)).toBe(false);
      expect(yield* accepts(cluster.port)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
