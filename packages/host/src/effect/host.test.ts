import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { GATEWAY_METHOD, type GatewayMethod, type GatewayShutdownSteps } from "@sidecar/gateway";
import type { GatewayInProcessHost } from "@sidecar/gateway/server";
import { Cause, Chunk, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { HOST_CONCERN, HOST_START_ORDER } from "../compose-host.js";
import type { Composer } from "../composer.js";
import { mergedMethods } from "./composer.js";
import {
  type HostAssembly,
  HostAssemblyTag,
  HostTag,
  hostDrain,
  hostStandingLayer,
} from "./host.js";

// SAFETY: these tests hand the in-process host through the assembly and back; none of them reads a part of it.
const stubGateway = (): GatewayInProcessHost => ({}) as GatewayInProcessHost;

const STEP = {
  START: "start",
  STOP: "stop",
  ARM: "arm",
  DISARM: "disarm",
  DRAIN: "drain",
} as const;

type Step = (typeof STEP)[keyof typeof STEP];

interface Recorded {
  readonly step: Step;
  readonly concern?: string;
}

const stubComposer = (methods: readonly GatewayMethod[]): Composer => ({
  methods: Object.fromEntries(methods.map((method) => [method, () => Effect.succeed({})])),
  start: async () => undefined,
  stop: async () => undefined,
});

const recordingComposer = (
  log: Recorded[],
  concern: string,
  stop: () => Promise<void> = async () => undefined,
): Composer => ({
  methods: {},
  start: async () => {
    log.push({ step: STEP.START, concern });
  },
  stop: async () => {
    log.push({ step: STEP.STOP, concern });
    await stop();
  },
});

const recordingAssembly = (log: Recorded[], startOrder: readonly Composer[]): HostAssembly => ({
  gateway: stubGateway(),
  startOrder,
  armed: Effect.zipRight(
    Effect.sync(() => {
      log.push({ step: STEP.ARM });
    }),
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        log.push({ step: STEP.DISARM });
      }),
    ),
  ),
  drain: () =>
    Effect.sync(() => {
      log.push({ step: STEP.DRAIN });
      return { settled: true, cancelled: [], unresolved: 0, elapsedMs: 0 };
    }),
});

const buildStanding = (assembly: HostAssembly, scope: Scope.CloseableScope) =>
  Layer.buildWithScope(hostStandingLayer, scope).pipe(
    Effect.provide(Layer.succeed(HostAssemblyTag, assembly)),
  );

describe("the standing host", () => {
  it("keeps the start order the merge kept before the composers were layers", () => {
    assert.deepEqual(HOST_START_ORDER, [
      HOST_CONCERN.SETTINGS,
      HOST_CONCERN.ACCOUNT,
      HOST_CONCERN.DEVICES,
      HOST_CONCERN.CONVERSATION,
      HOST_CONCERN.BRAIN,
      HOST_CONCERN.CALENDARS,
      HOST_CONCERN.OBSERVATION,
      HOST_CONCERN.LIVE,
    ]);
    assert.deepEqual([...HOST_START_ORDER].sort(), Object.values(HOST_CONCERN).sort());
  });

  it.effect(
    "starts the concerns in the assembly's order, arms after the last, and the scope's close is the quit in reverse with the drain first",
    () =>
      Effect.gen(function* () {
        const log: Recorded[] = [];
        const concerns = ["first", "second", "third"];
        const assembly = recordingAssembly(
          log,
          concerns.map((concern) => recordingComposer(log, concern)),
        );
        const scope = yield* Scope.make();

        const context = yield* buildStanding(assembly, scope);
        const standing = Context.get(context, HostTag);
        assert.equal(standing.gateway, assembly.gateway);
        assert.deepEqual(log, [
          { step: STEP.START, concern: "first" },
          { step: STEP.START, concern: "second" },
          { step: STEP.START, concern: "third" },
          { step: STEP.ARM },
        ]);

        yield* Scope.close(scope, Exit.void);
        assert.deepEqual(log.slice(4), [
          { step: STEP.DRAIN },
          { step: STEP.DISARM },
          { step: STEP.STOP, concern: "third" },
          { step: STEP.STOP, concern: "second" },
          { step: STEP.STOP, concern: "first" },
        ]);
      }),
  );

  it.effect(
    "a concern that cannot stop strands none of its siblings, and the close carries its failure",
    () =>
      Effect.gen(function* () {
        const log: Recorded[] = [];
        const refused = new Error("the store was already closed");
        const assembly = recordingAssembly(log, [
          recordingComposer(log, "first"),
          recordingComposer(log, "second", async () => {
            throw refused;
          }),
          recordingComposer(log, "third"),
        ]);
        const scope = yield* Scope.make();
        yield* buildStanding(assembly, scope);

        const closed = yield* Effect.exit(Scope.close(scope, Exit.void));

        assert.deepEqual(
          log.filter((entry) => entry.step === STEP.STOP).map((entry) => entry.concern),
          ["third", "second", "first"],
        );
        assert.ok(Exit.isFailure(closed));
        assert.deepEqual(Chunk.toReadonlyArray(Cause.defects(closed.cause)), [refused]);
      }),
  );

  it.effect(
    "a concern that cannot start is stopped with the ones before it at once, in reverse, leaving nothing for the close",
    () =>
      Effect.gen(function* () {
        const log: Recorded[] = [];
        const refused = new Error("no store worker");
        const assembly = recordingAssembly(log, [
          recordingComposer(log, "first"),
          recordingComposer(log, "second"),
          {
            methods: {},
            start: async () => {
              throw refused;
            },
            stop: async () => {
              log.push({ step: STEP.STOP, concern: "third" });
            },
          },
        ]);
        const scope = yield* Scope.make();

        const built = yield* Effect.exit(buildStanding(assembly, scope));
        assert.ok(Exit.isFailure(built));
        assert.deepEqual(Chunk.toReadonlyArray(Cause.defects(built.cause)), [refused]);
        assert.deepEqual(log, [
          { step: STEP.START, concern: "first" },
          { step: STEP.START, concern: "second" },
          { step: STEP.STOP, concern: "third" },
          { step: STEP.STOP, concern: "second" },
          { step: STEP.STOP, concern: "first" },
        ]);

        yield* Scope.close(scope, Exit.void);
        assert.equal(log.length, 5);
      }),
  );
});

describe("a standup interrupted", () => {
  it.effect(
    "lets the composer mid-start finish, starts none after it, arms nothing, and releases what began",
    () =>
      Effect.gen(function* () {
        const log: Recorded[] = [];
        const began = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const assembly = recordingAssembly(log, [
          recordingComposer(log, "first"),
          {
            methods: {},
            start: () =>
              Effect.runPromise(
                Effect.zipRight(
                  Effect.zipRight(Deferred.succeed(began, undefined), Deferred.await(gate)),
                  Effect.sync(() => {
                    log.push({ step: STEP.START, concern: "second" });
                  }),
                ),
              ),
            stop: async () => {
              log.push({ step: STEP.STOP, concern: "second" });
            },
          },
          recordingComposer(log, "third"),
        ]);
        const scope = yield* Scope.make();

        const standup = yield* Effect.fork(buildStanding(assembly, scope));
        yield* Deferred.await(began);
        assert.deepEqual(log, [{ step: STEP.START, concern: "first" }]);

        const interrupting = yield* Effect.fork(Fiber.interrupt(standup));
        yield* Effect.yieldNow();
        assert.equal(log.length, 1);
        yield* Deferred.succeed(gate, undefined);
        const exit = yield* Fiber.join(interrupting);

        assert.ok(Exit.isInterrupted(exit));
        assert.deepEqual(log.slice(1), [
          { step: STEP.START, concern: "second" },
          { step: STEP.STOP, concern: "second" },
          { step: STEP.STOP, concern: "first" },
        ]);
        yield* Scope.close(scope, Exit.void);
        assert.equal(log.length, 4);
      }),
  );
});

describe("the method fold", () => {
  it.effect("a method two composers claim fails the build, naming the method", () =>
    Effect.gen(function* () {
      const built = yield* Effect.exit(
        Effect.scoped(
          Layer.build(
            Layer.effectDiscard(
              mergedMethods([
                stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
                stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
              ]),
            ),
          ),
        ),
      );
      assert.ok(Exit.isFailure(built));
      const refusal = Cause.failureOption(built.cause);
      assert.ok(Option.isSome(refusal));
      assert.equal(refusal.value._tag, "DuplicateGatewayMethod");
      assert.equal(refusal.value.method, GATEWAY_METHOD.SETTINGS_SNAPSHOT);
    }),
  );

  it.effect("disjoint tables fold into one", () =>
    Effect.gen(function* () {
      const methods = yield* mergedMethods([
        stubComposer([GATEWAY_METHOD.SETTINGS_SNAPSHOT]),
        stubComposer([GATEWAY_METHOD.ACCOUNT_SNAPSHOT]),
      ]);
      assert.deepEqual(
        Object.keys(methods).sort(),
        [GATEWAY_METHOD.ACCOUNT_SNAPSHOT, GATEWAY_METHOD.SETTINGS_SNAPSHOT].sort(),
      );
    }),
  );
});

describe("the drain", () => {
  interface Counted {
    admissionsClosed: number;
    persisted: number;
  }

  const hangingSteps = (counts: Counted): GatewayShutdownSteps => ({
    closeAdmissions: () => {
      counts.admissionsClosed += 1;
    },
    cancelActive: async () => ["run-1"],
    awaitSettled: () => new Promise<void>(() => undefined),
    persistUnresolved: async () => {
      counts.persisted += 1;
      return 3;
    },
  });

  // The drain runs on the clock of whoever asked for it, now that no promise
  // door detaches it onto the default runtime, and what these two measure is
  // the deadline itself rather than a schedule a test drives.
  it.live(
    "past its deadline counts what did not settle rather than waiting on it, and runs once for every ask",
    () =>
      Effect.gen(function* () {
        const counts: Counted = { admissionsClosed: 0, persisted: 0 };
        const reports: string[] = [];
        const drain = yield* hostDrain(hangingSteps(counts), (message) => reports.push(message));

        const first = yield* drain({ deadlineMs: 0 });
        assert.equal(first.settled, false);
        assert.deepEqual(first.cancelled, ["run-1"]);
        assert.equal(first.unresolved, 3);
        assert.deepEqual(counts, { admissionsClosed: 1, persisted: 1 });
        assert.equal(reports.length, 1);

        const again = yield* drain({ deadlineMs: 50 });
        assert.equal(again, first);
        assert.deepEqual(counts, { admissionsClosed: 1, persisted: 1 });
        assert.equal(reports.length, 1);
      }),
  );

  it.live("steps that fail are the named refusal, reported once and answered to every ask", () =>
    Effect.gen(function* () {
      const reports: string[] = [];
      const broken = new Error("the envelopes could not be read");
      const drain = yield* hostDrain(
        {
          closeAdmissions: () => undefined,
          cancelActive: async () => [],
          awaitSettled: async () => undefined,
          persistUnresolved: async () => {
            throw broken;
          },
        },
        (message) => reports.push(message),
      );

      const first = yield* Effect.exit(drain({ deadlineMs: 0 }));
      const again = yield* Effect.exit(drain({ deadlineMs: 0 }));
      for (const exit of [first, again]) {
        assert.ok(Exit.isFailure(exit));
        const refusal = Cause.failureOption(exit.cause);
        assert.ok(Option.isSome(refusal));
        assert.equal(refusal.value._tag, "HostDrainError");
        assert.equal(refusal.value.cause, broken);
      }
      assert.equal(reports.length, 1);
    }),
  );
});
