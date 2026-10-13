import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { MacCommand, MacCommandResult } from "@sidecar/hosted/mac-command-wire";
import { ConfigProvider, Deferred, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { composeMacCommands, type MacCommandClient } from "./compose-mac-commands.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service and spawner: a command the read takes runs in
 * the developer's login shell from their home folder and its result goes
 * back, and with the setting off, or no account, the service is never read.
 */

const COMMAND: MacCommand = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  command: "node --version",
  timeoutSeconds: 60,
};

/** A service that hands one read its commands and holds every read after it, keeping what it is told. */
function scriptedService(commands: readonly MacCommand[]) {
  return Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const settled = yield* Deferred.make<{
      readonly id: string;
      readonly result: MacCommandResult;
    }>();
    const client: MacCommandClient = {
      waiting: () =>
        Effect.flatMap(
          Ref.getAndUpdate(reads, (count) => count + 1),
          (count) => (count === 0 ? Effect.succeed(commands) : Effect.never),
        ),
      settle: (id, result) => Effect.as(Deferred.succeed(settled, { id, result }), true),
    };
    return { client, reads, settled };
  });
}

const machine = (spawner: ReturnType<typeof scriptedSpawner>) =>
  Layer.mergeAll(
    Layer.succeed(
      Environment,
      ConfigProvider.fromEnvRecord({ HOME: "/Users/developer", SHELL: "/bin/bash" }),
    ),
    reporterLayer(() => undefined),
    spawner.layer,
  );

it.effect(
  "a command the read takes runs in the login shell from home, and its result goes back",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.1.0\n", exitCode: 0 }));
      const service = yield* scriptedService([COMMAND]);
      const composer = yield* composeMacCommands({
        kernel: { runMode: { sendsNetwork: true } },
        account: { capabilitiesActive: () => true },
        enabled: Effect.succeed(true),
        client: service.client,
      }).pipe(Effect.provide(machine(spawner)));

      const settled = yield* Effect.scoped(
        Effect.andThen(composer.lifetime, Deferred.await(service.settled)),
      );

      assert.deepEqual(settled, {
        id: COMMAND.id,
        result: { exitCode: 0, stdout: "v24.1.0\n", stderr: "", truncated: false, timedOut: false },
      });
      assert.equal(spawner.spawned[0]?.program, "/bin/bash");
      assert.deepEqual(spawner.spawned[0]?.args, ["-l", "-c", "node --version"]);
      assert.equal(spawner.spawned[0]?.cwd, "/Users/developer");
    }),
);

it.effect("with the setting off, or no account signed in, the service is never read", () =>
  Effect.gen(function* () {
    for (const gate of [
      { enabled: false, signedIn: true },
      { enabled: true, signedIn: false },
    ]) {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = yield* scriptedService([COMMAND]);
      const composer = yield* composeMacCommands({
        kernel: { runMode: { sendsNetwork: true } },
        account: { capabilitiesActive: () => gate.signedIn },
        enabled: Effect.succeed(gate.enabled),
        client: service.client,
      }).pipe(Effect.provide(machine(spawner)));

      yield* Effect.scoped(Effect.andThen(composer.lifetime, TestClock.adjust("1 minute")));

      assert.equal(yield* Ref.get(service.reads), 0, JSON.stringify(gate));
      assert.deepEqual(spawner.spawned, []);
    }
  }),
);
