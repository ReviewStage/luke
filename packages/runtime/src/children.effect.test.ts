import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Chunk, Duration, Effect, Schedule } from "effect";
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
  dismissChildCompletion,
  makeChildRunService,
  retryChildDelivery,
  spawnChild,
} from "./children.effect.js";
import {
  CHILD_DEFAULTS,
  CHILD_SPAWN_REFUSAL,
  type ChildEnd,
  type ChildExecutor,
  type ChildSpawnRequest,
  type ChildStore,
  type CompletionDeliverer,
  deliveryBackoffMs,
} from "./children.js";
import { DEFAULT_AGENT_ID, MAIN_SESSION_KEY, type SessionKey } from "./identifiers.js";

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
