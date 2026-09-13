import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Chunk, Clock, Deferred, Duration, Effect, Schedule } from "effect";
import { TestClock } from "effect/testing";
import {
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  COMPLETION_DELIVERY_STATUS,
} from "./child-records.js";
import {
  CHILD_COMPLETION_REFUSAL,
  ChildCancellationIncomplete,
  ChildCompletionRefused,
  ChildSpawnRefused,
  cancelChild,
  cancelDescendantsOf,
  childDeliveryBackoffSchedule,
  childLines,
  childSeamsOnRuntime,
  dismissChildCompletion,
  type EffectChildExecutor,
  type EffectCompletionDeliverer,
  makeChildRunService,
  retryChildDelivery,
  spawnChild,
} from "./children.effect.js";
import {
  CHILD_DEFAULTS,
  CHILD_SPAWN_REFUSAL,
  type ChildEnd,
  type ChildExecutor,
  ChildRunService,
  type ChildSpawnRequest,
  type ChildStore,
  type CompletionDeliverer,
  deliveryBackoffMs,
} from "./children.js";
import {
  childSessionKey,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "./identifiers.js";

class MemoryStore implements ChildStore {
  readonly children = new Map<string, ChildRunRecord>();
  readonly completions = new Map<string, ChildCompletionRecord>();
  async listChildren() {
    return [...this.children.values()];
  }
  async putChild(record: ChildRunRecord) {
    this.children.set(record.childId, record);
    return true;
  }
  async deleteChild(childId: string) {
    return this.children.delete(childId);
  }
  async listCompletions() {
    return [...this.completions.values()];
  }
  async putCompletion(completion: ChildCompletionRecord) {
    this.completions.set(completion.completionId, completion);
    return true;
  }
  async deleteCompletion(completionId: string) {
    return this.completions.delete(completionId);
  }
}

interface Started {
  readonly record: ChildRunRecord;
  end: (end: ChildEnd) => void;
}

class FakeExecutor implements ChildExecutor {
  readonly started: Started[] = [];
  cancelLands = true;
  async start(record: ChildRunRecord) {
    let end!: (end: ChildEnd) => void;
    const done = new Promise<ChildEnd>((resolve) => {
      end = resolve;
    });
    this.started.push({ record, end });
    return { started: true as const, done };
  }
  async resume(record: ChildRunRecord) {
    return this.start(record);
  }
  async cancel(record: ChildRunRecord) {
    if (!this.cancelLands) return false;
    this.started
      .find((held) => held.record.childId === record.childId)
      ?.end({ status: CHILD_RUN_STATUS.CANCELLED });
    return true;
  }
  async archive() {
    return true;
  }
  async lines() {
    return ["reply: done"];
  }
}

class FakeDeliverer implements CompletionDeliverer {
  accept = true;
  async deliver() {
    return this.accept ? { delivered: true } : { delivered: false, reason: "busy" };
  }
}

const request = (
  requesterSessionKey: SessionKey = MAIN_SESSION_KEY,
  overrides: Partial<ChildSpawnRequest> = {},
): ChildSpawnRequest => ({
  agentId: DEFAULT_AGENT_ID,
  requesterSessionKey,
  requesterDepth: 0,
  task: "summarize the failing tests",
  policy: { allowed: ["read_transcript"], denied: ["announce"] },
  sameAgent: true,
  ...overrides,
});

const harness = (overrides: { deliverer?: FakeDeliverer } = {}) => {
  const store = new MemoryStore();
  const executor = new FakeExecutor();
  const deliverer = overrides.deliverer ?? new FakeDeliverer();
  let ids = 0;
  return {
    store,
    executor,
    deliverer,
    options: {
      store,
      executor,
      deliverer,
      createId: () => `id-${++ids}`,
    },
  };
};

const settle = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

describe("makeChildRunService", () => {
  it.effect("starts on acquire and stops its timers on release", () =>
    Effect.gen(function* () {
      const { options, executor } = harness();
      const receipt = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* makeChildRunService(options);
          return yield* spawnChild(service, request());
        }),
      );
      assert.equal(receipt.childId, "id-1");
      yield* settle;
      assert.equal(executor.started.length, 1);
    }),
  );
});

describe("spawnChild", () => {
  it.effect("answers the receipt for an accepted spawn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const receipt = yield* spawnChild(service, request());
        assert.equal(receipt.childId, "id-1");
        assert.equal(receipt.depth, 1);
      }),
    ),
  );

  it.effect("fails with the port's own refusal code for an empty task", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const refusal = yield* Effect.flip(
          spawnChild(service, request(MAIN_SESSION_KEY, { task: "  " })),
        );
        assert.ok(refusal instanceof ChildSpawnRefused);
        assert.equal(refusal.code, CHILD_SPAWN_REFUSAL.EMPTY_TASK);
      }),
    ),
  );

  it.effect("fails naming the depth cap once a requester's own depth reaches it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const refusal = yield* Effect.flip(
          spawnChild(
            service,
            request(MAIN_SESSION_KEY, { requesterDepth: CHILD_DEFAULTS.DEPTH_CAP }),
          ),
        );
        assert.equal(refusal.code, CHILD_SPAWN_REFUSAL.DEPTH_CAP);
      }),
    ),
  );
});

describe("cancelChild and cancelDescendantsOf", () => {
  it.effect("cancels a running child and answers void", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options, executor } = harness();
        const service = yield* makeChildRunService(options);
        const receipt = yield* spawnChild(service, request());
        yield* settle;
        assert.equal(executor.started.length, 1);
        yield* cancelChild(service, receipt.childId);
      }),
    ),
  );

  it.effect("fails naming what remains when a cancel does not land", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options, executor } = harness();
        const service = yield* makeChildRunService(options);
        const receipt = yield* spawnChild(service, request());
        yield* settle;
        executor.cancelLands = false;
        const refusal = yield* Effect.flip(cancelChild(service, receipt.childId));
        assert.ok(refusal instanceof ChildCancellationIncomplete);
        assert.deepEqual(refusal.remaining, [receipt.childId]);
      }),
    ),
  );

  it.effect(
    "cancelDescendantsOf fails naming every child a reset must not yet report settled",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { options, executor } = harness();
          const service = yield* makeChildRunService(options);
          const receipt = yield* spawnChild(service, request());
          yield* settle;
          executor.cancelLands = false;
          const refusal = yield* Effect.flip(cancelDescendantsOf(service, MAIN_SESSION_KEY));
          assert.deepEqual(refusal.remaining, [receipt.childId]);
        }),
      ),
  );
});

describe("retryChildDelivery and dismissChildCompletion", () => {
  it.effect("retryChildDelivery fails for a child with nothing waiting on a retry", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const refusal = yield* Effect.flip(retryChildDelivery(service, "nobody"));
        assert.ok(refusal instanceof ChildCompletionRefused);
        assert.equal(refusal.code, CHILD_COMPLETION_REFUSAL.NOT_RETRYABLE);
        assert.equal(refusal.childId, "nobody");
      }),
    ),
  );

  it.effect("retries a blocked delivery once the deliverer can accept it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const deliverer = new FakeDeliverer();
        deliverer.accept = false;
        const { options, executor } = harness({ deliverer });
        const service = yield* makeChildRunService(options);
        const receipt = yield* spawnChild(service, request());
        yield* settle;
        executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED, resultText: "done" });
        yield* settle;
        deliverer.accept = true;
        yield* retryChildDelivery(service, receipt.childId);
        yield* settle;
        assert.equal(
          service.completion(receipt.childId)?.delivery,
          COMPLETION_DELIVERY_STATUS.DELIVERED,
        );
      }),
    ),
  );

  it.effect("dismissChildCompletion fails for a completion that is not blocked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const refusal = yield* Effect.flip(dismissChildCompletion(service, "nobody"));
        assert.equal(refusal.code, CHILD_COMPLETION_REFUSAL.NOT_DISMISSIBLE);
      }),
    ),
  );
});

describe("childLines", () => {
  it.effect("answers the child's own lines through the executor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const receipt = yield* spawnChild(service, request());
        yield* settle;
        const lines = yield* childLines(service, receipt.childId, 10);
        assert.deepEqual(lines, ["reply: done"]);
      }),
    ),
  );

  it.effect("answers undefined for a child the service never held", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = harness();
        const service = yield* makeChildRunService(options);
        const lines = yield* childLines(service, "nobody", 10);
        assert.equal(lines, undefined);
      }),
    ),
  );
});

describe("childDeliveryBackoffSchedule", () => {
  it.effect("doubles the port's own initial delay to its own cap", () =>
    Effect.gen(function* () {
      const delays = yield* Schedule.run(
        childDeliveryBackoffSchedule(),
        0,
        Array.from({ length: 8 }, () => undefined),
      );
      const millis = Chunk.toReadonlyArray(delays).map(Duration.toMillis);
      assert.deepEqual(
        millis,
        Array.from({ length: 8 }, (_, index) => deliveryBackoffMs(index + 1)),
      );
    }),
  );
});

/**
 * The executor and deliverer as a host writes them now: every seam an
 * effect, each held open by a `Deferred` the test releases, so what the port
 * awaits is a run of this test's own runtime rather than a promise the host
 * carried to it.
 */
class EffectExecutor implements EffectChildExecutor {
  readonly started: {
    readonly record: ChildRunRecord;
    readonly end: Deferred.Deferred<ChildEnd>;
  }[] = [];
  readonly cancelled: string[] = [];
  /** What the `start` seam read of the clock it ran on, in the order the children were started. */
  readonly observed: number[] = [];
  start(record: ChildRunRecord) {
    return Effect.gen(this, function* () {
      this.observed.push(yield* Clock.currentTimeMillis);
      const end = yield* Deferred.make<ChildEnd>();
      this.started.push({ record, end });
      return { started: true, done: Deferred.await(end) } as const;
    });
  }
  resume(record: ChildRunRecord) {
    return this.start(record);
  }
  cancel(record: ChildRunRecord) {
    return Effect.gen(this, function* () {
      this.cancelled.push(record.childId);
      const held = this.started.find((one) => one.record.childId === record.childId);
      if (held) yield* Deferred.succeed(held.end, { status: CHILD_RUN_STATUS.CANCELLED });
      return true;
    });
  }
  archive() {
    return Effect.succeed(true);
  }
  lines() {
    return Effect.succeed(["reply: done"] as const);
  }
}

class EffectDeliverer implements EffectCompletionDeliverer {
  readonly delivered: string[] = [];
  deliver(completion: ChildCompletionRecord) {
    return Effect.sync(() => {
      this.delivered.push(completion.childId);
      return { delivered: true };
    });
  }
}

const effectHarness = () =>
  Effect.gen(function* () {
    const store = new MemoryStore();
    const executor = new EffectExecutor();
    const deliverer = new EffectDeliverer();
    let ids = 0;
    const service = new ChildRunService({
      store,
      createId: () => `id-${++ids}`,
      now: () => 0,
      ...childSeamsOnRuntime(yield* Effect.runtime<never>(), { executor, deliverer }),
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => service.stop()));
    return { service, store, executor, deliverer };
  });

describe("childSeamsOnRuntime", () => {
  it.effect("runs a start seam on the runtime it was handed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, executor } = yield* effectHarness();
        yield* spawnChild(service, request());
        yield* settle;
        assert.deepEqual(executor.observed, [0]);
        yield* TestClock.adjust(Duration.seconds(5));
        yield* spawnChild(service, request());
        yield* settle;
        assert.deepEqual(executor.observed, [0, 5_000]);
      }),
    ),
  );

  it.effect("holds one requester to five active children and the lane to eight", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, executor } = yield* effectHarness();
        for (let index = 0; index < 5; index += 1) yield* spawnChild(service, request());
        yield* settle;
        assert.equal(executor.started.length, 5);
        const refusal = yield* Effect.flip(spawnChild(service, request()));
        assert.equal(refusal.code, CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT);

        const other = (index: number) => childSessionKey(`other-${index}`);
        for (let index = 0; index < 3; index += 1) {
          yield* spawnChild(service, request(other(index), { requesterDepth: 1 }));
        }
        yield* settle;
        assert.equal(executor.started.length, 8);
        const lane = yield* Effect.flip(
          spawnChild(service, request(other(3), { requesterDepth: 1 })),
        );
        assert.equal(lane.code, CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT);
      }),
    ),
  );

  it.effect("hands a completion to the deliverer once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, executor, deliverer } = yield* effectHarness();
        const receipt = yield* spawnChild(service, request());
        yield* settle;
        const held = executor.started[0];
        assert.ok(held);
        yield* Deferred.succeed(held.end, {
          status: CHILD_RUN_STATUS.COMPLETED,
          resultText: "done",
        });
        yield* settle;
        assert.deepEqual(deliverer.delivered, [receipt.childId]);
        assert.equal(
          service.completion(receipt.childId)?.delivery,
          COMPLETION_DELIVERY_STATUS.DELIVERED,
        );
        const again = yield* Effect.flip(retryChildDelivery(service, receipt.childId));
        assert.equal(again.code, CHILD_COMPLETION_REFUSAL.NOT_RETRYABLE);
        yield* settle;
        assert.deepEqual(deliverer.delivered, [receipt.childId]);
      }),
    ),
  );

  it.effect("cascades an explicit cancel through a child's own descendants", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { service, executor } = yield* effectHarness();
        const parent = yield* spawnChild(service, request());
        yield* settle;
        const child = yield* spawnChild(
          service,
          request(childSessionKey(parent.childId), { requesterDepth: parent.depth }),
        );
        yield* settle;
        yield* cancelChild(service, parent.childId);
        yield* settle;
        assert.deepEqual(executor.cancelled, [child.childId, parent.childId]);
        assert.equal(service.child(parent.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
        assert.equal(service.child(child.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
      }),
    ),
  );
});
