import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAC_COMMAND_NOT_CLAIMED } from "@luke/features";
import {
  LIVE_POLL_URL,
  LIVE_SIGNED_OUT,
  type MacCommandsLiveAnswer,
} from "@luke/features/live-wire";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
} from "@luke/gateway";
import { MAC_COMMAND_MODE, type MacCommandMode } from "@luke/settings";
import { isRecord, type WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { composeMacCommands, type MacCommandClient } from "./compose-mac-commands.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import { MAC_COMMAND_DECISION, type MacCommandDecision } from "./mac-command-ask.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service and spawner, with Realtime off, as the
 * deployment runs without `LUKE_REALTIME`: the live read answered polled and
 * held until the rows move. With the setting on Never, or no account, the
 * service is never read; otherwise every read names the account and the
 * kinds this Mac runs, each command waiting is claimed by its id, the
 * earliest first, and run or refused by its kind, one queued later is heard
 * within the poll's hold, and the Mac says it listens every fifteen
 * seconds until the setting is switched to Never. Under Always allow a
 * command runs as claimed; under Ask every time it is told as an ask and
 * runs only once the developer allows it, Always allow writing the setting
 * too, while Deny, or no answer before the command's own timeout, answers
 * the call as not run, and one ask holds up neither the follow nor another.
 *
 * Synthetic commands and accounts throughout.
 */

/** The account signed in, which every live read names. */
const ACCOUNT = "user-mac";

const NOW = 1_800_000_000_000;

const COMMAND: MacCommand = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "node --version",
  timeoutSeconds: 60,
};

const SECOND: MacCommand = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "pnpm --version",
  timeoutSeconds: 30,
};

const LATER: MacCommand = {
  id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git status",
  timeoutSeconds: 30,
};

/** How often the scripted service looks again while it holds a poll, as the service does. */
const HOLD_LOOK = Duration.seconds(1);

/** Let every fiber the step woke run to where it waits. */
const settled = Effect.repeat(Effect.yieldNow, { times: 200 });

/**
 * The service with Realtime off, as a script: the commands still waiting,
 * each with when it was queued, answered polled, and a poll past where they
 * stood held until they move; a claim granted once per command; and every
 * read, presence, and result the Mac sent, as the service would observe it.
 */
function scriptedService(
  options: {
    readonly signedOut?: boolean;
    readonly unansweredClaims?: number;
    /** What happens as a claim is made, before the service grants it, such as the setting being switched off. */
    readonly duringClaim?: Effect.Effect<void>;
  } = {},
) {
  let unanswered = options.unansweredClaims ?? 0;
  const waiting: (MacCommand & { readonly queuedAt: number })[] = [];
  let version = 0;
  const reads: { readonly userId: string; readonly kinds: readonly MacCommandKind[] }[] = [];
  const claims: string[] = [];
  const beats: (readonly MacCommandKind[])[] = [];
  const settledResults = new Map<string, MacCommandResult>();
  const answer = (rows: boolean): MacCommandsLiveAnswer => ({
    url: LIVE_POLL_URL,
    queries: {
      commands: {
        capability: "",
        queryFingerprint: "",
        expiresAt: NOW + 3_600_000,
        digest: String(version),
        ...(rows ? { rows: [...waiting] } : undefined),
      },
    },
  });
  const client: MacCommandClient = {
    live: (kinds, userId, _poll, after) =>
      Effect.gen(function* () {
        reads.push({ userId, kinds });
        if (options.signedOut === true) return LIVE_SIGNED_OUT;
        for (let held = 0; after === String(version) && held < 25; held += 1) {
          yield* Effect.sleep(HOLD_LOOK);
        }
        return answer(after !== String(version));
      }),
    claim: (id) =>
      Effect.andThen(
        options.duringClaim ?? Effect.void,
        Effect.sync((): MacCommand | typeof MAC_COMMAND_NOT_CLAIMED | undefined => {
          claims.push(id);
          // A claim lost on its way, as a network fault loses one, reaches nothing.
          if (unanswered > 0) {
            unanswered -= 1;
            return undefined;
          }
          const at = waiting.findIndex((command) => command.id === id);
          if (at < 0) return MAC_COMMAND_NOT_CLAIMED;
          const [claimed] = waiting.splice(at, 1);
          version += 1;
          if (claimed === undefined) return MAC_COMMAND_NOT_CLAIMED;
          const { queuedAt: _queuedAt, ...command } = claimed;
          return command;
        }),
      ),
    listening: (kinds) =>
      Effect.sync(() => {
        beats.push(kinds);
        return true;
      }),
    settle: (id, result) =>
      Effect.sync(() => {
        settledResults.set(id, result);
        return true;
      }),
  };
  return {
    client,
    reads,
    claims,
    beats,
    settledResults,
    /** A command queued for the account, as an agent's call queues it. */
    queue: (command: MacCommand, queuedAt: number) => {
      waiting.push({ ...command, queuedAt });
      version += 1;
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
    noNetwork,
  );

/** The operator a test answers an ask as. */
const CONTEXT = { client: { clientId: "panel", role: GATEWAY_CLIENT_ROLE.OPERATOR } } as const;

/** The gate as a test holds it: the setting, whether an account is signed in, and which. */
interface Gate {
  mode: MacCommandMode;
  signedIn: boolean;
  account?: string;
}

/**
 * The concern composed over the scripted service, the gate as `gate` holds
 * it, with the asks it tells, as the panel would hear them, the modes the
 * prompt's Always allow wrote, and one ask answered as the panel answers it.
 */
const subject = (
  service: ReturnType<typeof scriptedService>,
  spawner: ReturnType<typeof scriptedSpawner>,
  gate: Gate,
) => {
  const told: { readonly id: string; readonly command: string }[][] = [];
  const written: MacCommandMode[] = [];
  const emit = (kind: GatewayEventKind, payload: WireValue) => {
    if (kind !== GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED || !isRecord(payload)) return;
    const asks = Array.isArray(payload.asks) ? payload.asks : [];
    told.push(
      asks.flatMap((ask) =>
        isRecord(ask) && typeof ask.id === "string" && typeof ask.command === "string"
          ? [{ id: ask.id, command: ask.command }]
          : [],
      ),
    );
  };
  return Effect.map(
    composeMacCommands({
      kernel: { runMode: { sendsNetwork: true }, now: () => NOW, emit },
      account: { capabilitiesActive: () => gate.signedIn },
      accountId: () => gate.account ?? ACCOUNT,
      mode: Effect.sync(() => gate.mode),
      allowAlways: Effect.sync(() => {
        written.push(MAC_COMMAND_MODE.ALWAYS);
        gate.mode = MAC_COMMAND_MODE.ALWAYS;
      }),
      client: service.client,
    }).pipe(Effect.provide(machine(spawner))),
    (composer) => ({
      composer,
      told,
      written,
      /** The asks waiting as last told. */
      asks: () => told.at(-1) ?? [],
      answer: (id: string, decision: MacCommandDecision) =>
        Effect.gen(function* () {
          const method = composer.methods[GATEWAY_METHOD.MAC_COMMAND_ANSWER];
          assert.ok(method);
          return yield* method({ id, decision }, CONTEXT);
        }),
    }),
  );
};

it.effect("with the setting on Never, or no account signed in, the service is never read", () =>
  Effect.gen(function* () {
    for (const gate of [
      { mode: MAC_COMMAND_MODE.NEVER, signedIn: true },
      { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: false },
    ]) {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      service.queue(COMMAND, NOW);
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(Effect.andThen(composer.lifetime, TestClock.adjust("1 minute")));

      assert.deepEqual(service.reads, [], JSON.stringify(gate));
      assert.deepEqual(service.beats, [], JSON.stringify(gate));
      assert.deepEqual(spawner.spawned, []);
    }
  }),
);

it.effect(
  "over the held poll, each waiting command is claimed by its id, the earliest first, and run, one queued later is heard within a second or so, and every read names the account and shell alone",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.0.0\n", exitCode: 0 }));
      const service = scriptedService();
      service.queue(SECOND, NOW - 1_000);
      service.queue(COMMAND, NOW - 2_000);
      const { composer } = yield* subject(service, spawner, {
        mode: MAC_COMMAND_MODE.ALWAYS,
        signedIn: true,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.deepEqual(service.claims, [COMMAND.id, SECOND.id]);

          service.queue(LATER, NOW);
          yield* TestClock.adjust("2 seconds");
          yield* settled;
          assert.deepEqual(service.claims, [COMMAND.id, SECOND.id, LATER.id]);
        }),
      );

      assert.ok(service.reads.length > 0);
      for (const read of service.reads) {
        assert.deepEqual(read, { userId: ACCOUNT, kinds: [MAC_COMMAND_KIND.SHELL] });
      }
      assert.deepEqual(service.settledResults.get(COMMAND.id), {
        exitCode: 0,
        stdout: "v24.0.0\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      });
      assert.ok(service.settledResults.has(SECOND.id), "the second command ran");
      assert.ok(service.settledResults.has(LATER.id), "the later command ran");
    }),
);

it.effect(
  "the Mac says it listens for shell at once and every fifteen seconds, well inside the service's forty-five, and once the setting is switched to Never it stops",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true };
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.equal(service.beats.length, 1, "said at once");
          yield* TestClock.adjust("45 seconds");
          yield* settled;
          assert.equal(service.beats.length, 4);
          for (const kinds of service.beats) assert.deepEqual(kinds, [MAC_COMMAND_KIND.SHELL]);

          gate.mode = MAC_COMMAND_MODE.NEVER;
          yield* TestClock.adjust("15 seconds");
          yield* settled;
          const reads = service.reads.length;
          yield* TestClock.adjust("1 minute");
          yield* settled;
          assert.equal(service.beats.length, 4, "a Mac switched off says nothing");
          assert.equal(service.reads.length, reads, "nor reads");
        }),
      );
    }),
);

it.effect("a read the service signs out follows nothing, and is asked again after a pause", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService({ signedOut: true });
    service.queue(COMMAND, NOW);
    const { composer } = yield* subject(service, spawner, {
      mode: MAC_COMMAND_MODE.ALWAYS,
      signedIn: true,
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* composer.lifetime;
        yield* settled;
        assert.equal(service.reads.length, 1);
        yield* TestClock.adjust("5 seconds");
        yield* settled;
        assert.equal(service.reads.length, 2);
      }),
    );

    assert.deepEqual(service.claims, []);
    assert.deepEqual(service.beats, []);
  }),
);

it.effect("a claim the service never heard is asked again, and the command runs", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService({ unansweredClaims: 2 });
    service.queue(COMMAND, NOW);
    const { composer } = yield* subject(service, spawner, {
      mode: MAC_COMMAND_MODE.ALWAYS,
      signedIn: true,
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* composer.lifetime;
        yield* settled;
        yield* TestClock.adjust("3 seconds");
        yield* settled;
      }),
    );

    assert.deepEqual(service.claims, [COMMAND.id, COMMAND.id, COMMAND.id]);
    assert.ok(service.settledResults.has(COMMAND.id), "it ran once the claim got through");
  }),
);

it.effect(
  "a command granted as the setting is switched to Never is answered as not run, though the follow ends mid-claim",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true };
      const service = scriptedService({
        // The setting goes off as the claim leaves, and the service is slow to grant it, so a beat sees the gate shut first.
        duringClaim: Effect.andThen(
          Effect.sync(() => {
            gate.mode = MAC_COMMAND_MODE.NEVER;
          }),
          Effect.sleep("20 seconds"),
        ),
      });
      service.queue(COMMAND, NOW);
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          yield* TestClock.adjust("30 seconds");
          yield* settled;
        }),
      );

      const answered = service.settledResults.get(COMMAND.id);
      assert.ok(answered !== undefined && "stderr" in answered, "the call hears it was not run");
      assert.match(answered.stderr, /switched off/u);
      assert.deepEqual(spawner.spawned, []);
    }),
);

it.effect(
  "an account switched between beats ends the follow, and the next names the new account",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true, account: ACCOUNT };
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          gate.account = "user-other";
          yield* TestClock.adjust("15 seconds");
          yield* settled;
          yield* TestClock.adjust("5 seconds");
          yield* settled;
        }),
      );

      assert.equal(service.reads[0]?.userId, ACCOUNT);
      assert.ok(service.reads.some((read) => read.userId === "user-other"));
    }),
);

/** The ask a claimed command is told as, under Ask every time, once the follow has claimed it. */
const askedFor = (
  service: ReturnType<typeof scriptedService>,
  spawner: ReturnType<typeof scriptedSpawner>,
  commands: readonly MacCommand[],
) =>
  Effect.gen(function* () {
    for (const command of commands) service.queue(command, NOW);
    const built = yield* subject(service, spawner, { mode: MAC_COMMAND_MODE.ASK, signedIn: true });
    yield* built.composer.lifetime;
    yield* settled;
    return built;
  });

it.effect(
  "under Ask every time, a claimed command is told as an ask and runs only once the developer allows it once",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.0.0\n", exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND]);
          assert.deepEqual(built.asks(), [{ id: COMMAND.id, command: COMMAND.command }]);
          assert.deepEqual(spawner.spawned, [], "nothing runs before the answer");
          yield* TestClock.adjust("30 seconds");
          yield* settled;
          assert.deepEqual(spawner.spawned, [], "nor while the ask waits inside the timeout");

          assert.deepEqual(yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE), {
            answered: true,
          });
          yield* settled;
          assert.deepEqual(built.asks(), [], "the ask goes as it is answered");
          assert.deepEqual(built.written, [], "allowing once writes no setting");
          assert.equal(spawner.spawned.length, 1);
          assert.deepEqual(service.settledResults.get(COMMAND.id), {
            exitCode: 0,
            stdout: "v24.0.0\n",
            stderr: "",
            truncated: false,
            timedOut: false,
          });
        }),
      );
    }),
);

it.effect("Always allow writes the setting, runs the command, and the next runs unasked", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* askedFor(service, spawner, [COMMAND]);
        yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ALWAYS);
        yield* settled;
        assert.deepEqual(built.written, [MAC_COMMAND_MODE.ALWAYS]);
        assert.ok(service.settledResults.has(COMMAND.id), "the command asked for ran");

        service.queue(SECOND, NOW);
        yield* TestClock.adjust("2 seconds");
        yield* settled;
        assert.ok(service.settledResults.has(SECOND.id), "the next ran");
        assert.equal(built.told.length, 2, "nothing was asked for it");
        assert.equal(spawner.spawned.length, 2);
      }),
    );
  }),
);

it.effect("Deny answers the call as not run, declined, and runs nothing", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* askedFor(service, spawner, [COMMAND]);
        yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.DENY);
        yield* settled;
        assert.deepEqual(built.asks(), []);
        assert.deepEqual(yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE), {
          answered: false,
        });
      }),
    );
    const answered = service.settledResults.get(COMMAND.id);
    assert.ok(answered !== undefined && "refused" in answered, "the call hears it was not run");
    assert.match(answered.refused, /declined/u);
    assert.deepEqual(spawner.spawned, []);
  }),
);

it.effect(
  "no answer by the command's own timeout answers the call as not run, and the ask goes",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [SECOND]);
          yield* TestClock.adjust(Duration.seconds(SECOND.timeoutSeconds - 1));
          yield* settled;
          assert.deepEqual(built.asks(), [{ id: SECOND.id, command: SECOND.command }]);
          yield* TestClock.adjust("1 second");
          yield* settled;
          assert.deepEqual(built.asks(), []);
        }),
      );
      const answered = service.settledResults.get(SECOND.id);
      assert.ok(answered !== undefined && "refused" in answered, "the call hears it was not run");
      assert.match(answered.refused, /did not answer/u);
      assert.deepEqual(spawner.spawned, []);
    }),
);

it.effect(
  "an ask waiting holds up neither another ask nor the follow, and each is answered on its own",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND, SECOND]);
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, SECOND.id],
          );

          service.queue(LATER, NOW);
          yield* TestClock.adjust("2 seconds");
          yield* settled;
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, SECOND.id, LATER.id],
            "a command queued later is claimed and asked for while the first still waits",
          );

          yield* built.answer(SECOND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
          yield* settled;
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, LATER.id],
          );
          assert.ok(service.settledResults.has(SECOND.id), "the one allowed ran");
          assert.equal(service.settledResults.has(COMMAND.id), false, "the first still waits");
        }),
      );
    }),
);
