import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandRead,
  type MacCommandResult,
  macCommandsAnswerSchema,
} from "@luke/features/mac-command-wire";
import { noNetwork } from "@luke/wire/testing";
import { ConfigProvider, Effect, Layer, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { composeMacCommands, type MacCommandClient } from "./compose-mac-commands.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service and spawner: with the setting off, or no
 * account, the service is never read; each read names the kinds this Mac
 * runs, and each command it takes is run or refused by its kind.
 */

/** Commands as this Mac reads them off the wire: a shell command, a browser command, and one of a kind a newer service queued. */
const [COMMAND, BROWSER, NEWER] = Schema.decodeUnknownSync(macCommandsAnswerSchema)({
  commands: [
    {
      id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
      kind: MAC_COMMAND_KIND.SHELL,
      command: "node --version",
      timeoutSeconds: 60,
    },
    {
      id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
      kind: MAC_COMMAND_KIND.BROWSER,
      params: { act: "open", address: "http://localhost:3000" },
      timeoutSeconds: 30,
    },
    { id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b", kind: "hologram", timeoutSeconds: 30 },
  ],
}).commands as readonly [MacCommandRead, MacCommandRead, MacCommandRead];

/**
 * A service that hands the first read its commands and answers every read
 * after it with none once its hold of twenty seconds ends, keeping the
 * kinds each read named and every result posted to it.
 */
function scriptedService(commands: readonly MacCommandRead[]) {
  return Effect.gen(function* () {
    const reads = yield* Ref.make<readonly (readonly MacCommandKind[])[]>([]);
    const settled = yield* Ref.make<ReadonlyMap<string, MacCommandResult>>(new Map());
    const client: MacCommandClient = {
      waiting: (kinds) =>
        Effect.flatMap(
          Ref.getAndUpdate(reads, (named) => [...named, kinds]),
          (named) =>
            named.length === 0
              ? Effect.succeed(commands)
              : Effect.as(Effect.sleep("20 seconds"), []),
        ),
      settle: (id, result) =>
        Effect.as(
          Ref.update(settled, (held) => new Map([...held, [id, result]])),
          true,
        ),
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
    noNetwork,
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

      assert.deepEqual(yield* Ref.get(service.reads), [], JSON.stringify(gate));
      assert.deepEqual(spawner.spawned, []);
    }
  }),
);

it.effect(
  "each read names shell alone, and a command of a kind this Mac cannot run is refused while the shell one runs",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.0.0\n", exitCode: 0 }));
      const service = yield* scriptedService([BROWSER, COMMAND, NEWER]);
      const composer = yield* composeMacCommands({
        kernel: { runMode: { sendsNetwork: true } },
        account: { capabilitiesActive: () => true },
        enabled: Effect.succeed(true),
        client: service.client,
      }).pipe(Effect.provide(machine(spawner)));

      yield* Effect.scoped(Effect.andThen(composer.lifetime, TestClock.adjust("30 seconds")));

      const reads = yield* Ref.get(service.reads);
      assert.ok(reads.length >= 2, "the reads go on after the refusals");
      for (const kinds of reads) assert.deepEqual(kinds, [MAC_COMMAND_KIND.SHELL]);
      const settled = yield* Ref.get(service.settled);
      assert.deepEqual(settled.get(COMMAND.id), {
        exitCode: 0,
        stdout: "v24.0.0\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      });
      for (const refused of [BROWSER, NEWER]) {
        const result = settled.get(refused.id);
        assert.ok(result !== undefined && "refused" in result, refused.kind);
      }
      assert.deepEqual(
        spawner.spawned.map((process) => process.args),
        [["-l", "-c", "node --version"]],
      );
    }),
);
