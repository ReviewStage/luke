import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { MacCommandsLiveAnswer } from "@luke/features/live-wire";
import type { MacCommand, MacCommandResult } from "@luke/features/mac-command-wire";
import { ConfigProvider, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { composeMacCommands, type MacCommandClient } from "./compose-mac-commands.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import type { LiveClient } from "./live-follow.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service, Realtime, and spawner: with the setting off,
 * or no account, the service is never read; where the service seals the
 * unclaimed commands they are followed over Realtime, each new one claimed
 * by its id and run, and the Mac says it listens on a slow timer; where it
 * seals nothing, the held read stands in as before.
 *
 * Synthetic commands and sealed statements throughout.
 */

const NOW = 1_800_000_000_000;

const COMMAND: MacCommand = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  command: "node --version",
  timeoutSeconds: 60,
};

const LATER: MacCommand = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  command: "git status",
  timeoutSeconds: 30,
};

const SEALED: MacCommandsLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    commands: {
      capability: "capability-commands",
      queryFingerprint: "fingerprint-commands",
      expiresAt: NOW + 600_000,
    },
  },
};

/** Let every fiber the step woke run to where it waits. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/**
 * A service as a script: the held read hands its first read the commands
 * and answers every read after it with none once its hold of twenty
 * seconds ends; the live read seals `sealed`, or nothing; a claim is granted
 * once per command, and refused for any in `takenElsewhere`. What the Mac
 * asked is kept in order, as the service would observe it.
 */
function scriptedService(options: {
  readonly held?: readonly MacCommand[];
  readonly sealed?: MacCommandsLiveAnswer;
  readonly takenElsewhere?: readonly string[];
}) {
  return Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    const asked: string[] = [];
    const settledResults: { readonly id: string; readonly result: MacCommandResult }[] = [];
    const claimed = new Set<string>(options.takenElsewhere ?? []);
    const all = [COMMAND, LATER];
    const client: MacCommandClient = {
      waiting: () =>
        Effect.flatMap(
          Ref.getAndUpdate(reads, (count) => count + 1),
          (count) => {
            asked.push("waiting");
            return count === 0
              ? Effect.succeed(options.held ?? [])
              : Effect.as(Effect.sleep("20 seconds"), []);
          },
        ),
      settle: (id, result) =>
        Effect.sync(() => {
          settledResults.push({ id, result });
          return true;
        }),
      live: () =>
        Effect.sync(() => {
          asked.push("live");
          return options.sealed;
        }),
      claim: (id) =>
        Effect.sync(() => {
          asked.push(`claim:${id}`);
          if (claimed.has(id)) return undefined;
          claimed.add(id);
          return all.find((command) => command.id === id);
        }),
      listening: () =>
        Effect.sync(() => {
          asked.push("listening");
          return true;
        }),
    };
    return { client, reads, asked, settledResults };
  });
}

/** Realtime as a script: each address opened and closed, and a way to deliver the unclaimed commands' rows. */
function fakeRealtime() {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const open = (url: string): LiveClient => {
    opened.push(url);
    return {
      subscribe: (query) => ({
        onChange: (listener) => {
          listeners.set(query.capability, listener);
          return () => listeners.delete(query.capability);
        },
        renew: () => Promise.resolve(),
        unsubscribe: () => void listeners.delete(query.capability),
      }),
      close: () => void closed.push(url),
    };
  };
  return {
    open,
    opened,
    closed,
    /** The unclaimed commands as Realtime delivers their rows, each with when it was queued. */
    deliver: (rows: readonly (MacCommand & { readonly queuedAt: number })[]) => {
      const listener = listeners.get(SEALED.queries.commands.capability);
      assert.ok(listener, "no subscription to the commands");
      listener({ status: "live", data: rows });
    },
  };
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

/** The concern composed over the scripted service and Realtime, the gate as `gate` holds it. */
const subject = (
  service: Effect.Success<ReturnType<typeof scriptedService>>,
  realtime: ReturnType<typeof fakeRealtime>,
  spawner: ReturnType<typeof scriptedSpawner>,
  gate: { enabled: boolean; signedIn: boolean },
) =>
  composeMacCommands({
    kernel: { runMode: { sendsNetwork: true }, now: () => NOW },
    account: { capabilitiesActive: () => gate.signedIn },
    enabled: Effect.sync(() => gate.enabled),
    client: service.client,
    openLive: realtime.open,
  }).pipe(Effect.provide(machine(spawner)));

it.effect("with the setting off, or no account signed in, the service is never read", () =>
  Effect.gen(function* () {
    for (const gate of [
      { enabled: false, signedIn: true },
      { enabled: true, signedIn: false },
    ]) {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = yield* scriptedService({ held: [COMMAND], sealed: SEALED });
      const composer = yield* subject(service, fakeRealtime(), spawner, gate);

      yield* Effect.scoped(Effect.andThen(composer.lifetime, TestClock.adjust("1 minute")));

      assert.deepEqual(service.asked, [], JSON.stringify(gate));
      assert.deepEqual(spawner.spawned, []);
    }
  }),
);

it.effect(
  "where the service seals the unclaimed commands they are followed over Realtime: each new one claimed by its id, the earliest queued first, and run, one another Mac took is not, and the held read is never asked",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0, stdout: "v22.0.0\n" }));
      const service = yield* scriptedService({ sealed: SEALED, takenElsewhere: [LATER.id] });
      const realtime = fakeRealtime();
      const composer = yield* subject(service, realtime, spawner, {
        enabled: true,
        signedIn: true,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.deepEqual(realtime.opened, [SEALED.url]);

          realtime.deliver([
            { ...LATER, queuedAt: NOW - 1_000 },
            { ...COMMAND, queuedAt: NOW - 2_000 },
          ]);
          yield* settled;
          // The rows that still wait, as the next change delivers them, are not claimed twice.
          realtime.deliver([{ ...LATER, queuedAt: NOW - 1_000 }]);
          yield* settled;

          assert.deepEqual(
            service.asked.filter((ask) => ask.startsWith("claim:")),
            [`claim:${COMMAND.id}`, `claim:${LATER.id}`],
          );
          assert.equal(spawner.spawned.length, 1, "only the command granted to this Mac runs");
          assert.deepEqual(
            service.settledResults.map(({ id, result }) => [id, result.exitCode, result.stdout]),
            [[COMMAND.id, 0, "v22.0.0\n"]],
          );
          assert.ok(!service.asked.includes("waiting"));
        }),
      );
    }),
);

it.effect(
  "a Mac following over Realtime says it listens every fifteen seconds, well inside the service's forty-five, and once the setting is switched off it stops, its subscription closed",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = yield* scriptedService({ sealed: SEALED });
      const realtime = fakeRealtime();
      const gate = { enabled: true, signedIn: true };
      const composer = yield* subject(service, realtime, spawner, gate);
      const beats = () => service.asked.filter((ask) => ask === "listening").length;

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.equal(beats(), 1, "said at once");
          yield* TestClock.adjust("45 seconds");
          yield* settled;
          assert.equal(beats(), 4);

          gate.enabled = false;
          yield* TestClock.adjust("15 seconds");
          yield* settled;
          assert.deepEqual(realtime.closed, [SEALED.url]);
          yield* TestClock.adjust("1 minute");
          yield* settled;
          assert.equal(beats(), 4, "a Mac switched off says nothing");
        }),
      );
    }),
);

it.effect(
  "where the service seals nothing, the held read stands in as before, and what it took is run",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = yield* scriptedService({ held: [COMMAND] });
      const realtime = fakeRealtime();
      const composer = yield* subject(service, realtime, spawner, {
        enabled: true,
        signedIn: true,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* TestClock.adjust("30 seconds");
          yield* settled;
        }),
      );

      assert.deepEqual(service.asked.slice(0, 2), ["live", "waiting"]);
      assert.ok((yield* Ref.get(service.reads)) >= 2, "one held read after another");
      assert.deepEqual(realtime.opened, []);
      assert.deepEqual(
        service.settledResults.map(({ id }) => id),
        [COMMAND.id],
      );
    }),
);
