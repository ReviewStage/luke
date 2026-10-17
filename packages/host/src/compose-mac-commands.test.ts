import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { MacCommand } from "@luke/features/mac-command-wire";
import { ConfigProvider, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { composeMacCommands, type MacCommandClient } from "./compose-mac-commands.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import { noNetworkHttpClient } from "./testing/no-network.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service and spawner: with the setting off, or no
 * account, the service is never read.
 */

const COMMAND: MacCommand = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  command: "node --version",
  timeoutSeconds: 60,
};

/** A service that hands the first read its commands and answers every read after it with none once its hold of twenty seconds ends, counting its reads. */
function scriptedService(commands: readonly MacCommand[]) {
  return Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const client: MacCommandClient = {
      waiting: () =>
        Effect.flatMap(
          Ref.getAndUpdate(reads, (count) => count + 1),
          (count) =>
            count === 0 ? Effect.succeed(commands) : Effect.as(Effect.sleep("20 seconds"), []),
        ),
      settle: () => Effect.succeed(true),
    };
    return { client, reads };
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
    noNetworkHttpClient,
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
