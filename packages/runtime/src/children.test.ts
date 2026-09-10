import assert from "node:assert/strict";
import test from "node:test";
import {
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  COMPLETION_DELIVERY_STATUS,
} from "./child-records.js";
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
  threadSessionKey,
} from "./identifiers.js";
import type { ScheduledTimer } from "./timers.js";

/**
 * The child service over a synthetic executor and deliverer: the limits, the
 * receipt, the fork cap, the completion persisted before delivery, the
 * backoff and the blocked retention, the cascade, the reset refusal, and the
 * recovery budget, each against OpenClaw `b7528507`'s defaults.
 */

const NOW = 1_800_000_000_000;

class FakeClock {
  now = NOW;
  readonly timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();
  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };
  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };
  /** Advances to `at`, firing every timer due on the way, in order. */
  async advanceTo(at: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= at)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [handle, timer] = due;
      this.timers.delete(handle);
      this.now = Math.max(this.now, timer.at);
      timer.callback();
      await settle();
    }
    this.now = Math.max(this.now, at);
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 40) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

class MemoryChildStore implements ChildStore {
  readonly children = new Map<string, ChildRunRecord>();
  readonly completions = new Map<string, ChildCompletionRecord>();
  refuse = false;
  async listChildren() {
    return [...this.children.values()];
  }
  async putChild(record: ChildRunRecord) {
    if (this.refuse) return false;
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
    if (this.refuse) return false;
    this.completions.set(completion.completionId, completion);
    return true;
  }
  async deleteCompletion(completionId: string) {
    return this.completions.delete(completionId);
  }
}

interface Started {
  record: ChildRunRecord;
  fork: readonly unknown[] | undefined;
  end: (end: ChildEnd) => void;
}

/** An executor whose children end when the test says so. */
class FakeExecutor implements ChildExecutor {
  readonly started: Started[] = [];
  readonly resumed: ChildRunRecord[] = [];
  readonly cancelled: string[] = [];
  readonly archived: string[] = [];
  refuseStart: string | undefined;
  refuseResume: string | undefined;
  cancelLands = true;
  /** Holds every start until released, so a cancel can land while the backend is still starting. */
  holdStart: Promise<void> | undefined;
  async start(record: ChildRunRecord, fork: readonly unknown[] | undefined) {
    if (this.holdStart) await this.holdStart;
    if (this.refuseStart) return { started: false as const, reason: this.refuseStart };
    let end!: (end: ChildEnd) => void;
    const done = new Promise<ChildEnd>((resolve) => {
      end = resolve;
    });
    this.started.push({ record, fork, end });
    return { started: true as const, done };
  }
  async resume(record: ChildRunRecord) {
    this.resumed.push(record);
    if (this.refuseResume) return { started: false as const, reason: this.refuseResume };
    return {
      started: true as const,
      done: Promise.resolve({
        status: CHILD_RUN_STATUS.UNKNOWN,
        failureDetail: "interrupted",
      } satisfies ChildEnd),
    };
  }
  async cancel(record: ChildRunRecord) {
    this.cancelled.push(record.childId);
    if (!this.cancelLands) return false;
    this.started
      .find((held) => held.record.childId === record.childId)
      ?.end({
        status: CHILD_RUN_STATUS.CANCELLED,
      });
    return true;
  }
  async archive(record: ChildRunRecord) {
    this.archived.push(record.childId);
    return true;
  }
  async lines() {
    return ["reply: done"];
  }
}

class FakeDeliverer implements CompletionDeliverer {
  readonly delivered: { completionId: string; destination: SessionKey }[] = [];
  accept = true;
  async deliver(completion: ChildCompletionRecord) {
    this.delivered.push({
      completionId: completion.completionId,
      destination: completion.destination,
    });
    return this.accept ? { delivered: true } : { delivered: false, reason: "busy" };
  }
}

function harness(overrides: Partial<ConstructorParameters<typeof ChildRunService>[0]> = {}) {
  const clock = new FakeClock();
  const store = new MemoryChildStore();
  const executor = new FakeExecutor();
  const deliverer = new FakeDeliverer();
  const reports: string[] = [];
  let ids = 0;
  const service = new ChildRunService({
    store,
    executor,
    deliverer,
    createId: () => `id-${++ids}`,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    report: (message) => reports.push(message),
    ...overrides,
  });
  return { clock, store, executor, deliverer, service, reports };
}

function request(
  requesterSessionKey: SessionKey = MAIN_SESSION_KEY,
  overrides: Partial<ChildSpawnRequest> = {},
): ChildSpawnRequest {
  return {
    agentId: DEFAULT_AGENT_ID,
    requesterSessionKey,
    requesterRunId: "run-1",
    requesterDepth: 0,
    task: "summarize the failing tests",
    policy: { allowed: ["read_transcript"], denied: ["announce"] },
    sameAgent: true,
    ...overrides,
  };
}

test("a spawn is recorded before its receipt and started after it, and the receipt says accepted, not done", async () => {
  const { service, store, executor, clock } = harness();
  const outcome = await service.spawn(request());
  assert.ok(outcome.accepted);
  assert.equal(outcome.receipt.childId, "id-1");
  assert.equal(outcome.receipt.childSessionKey, childSessionKey("id-1"));
  assert.equal(outcome.receipt.context, CHILD_CONTEXT_MODE.ISOLATED);
  assert.equal(outcome.receipt.depth, 1);
  const stored = store.children.get("id-1");
  assert.ok(stored);
  assert.equal(stored.completionDestination, MAIN_SESSION_KEY);
  assert.equal(stored.timeoutMs, CHILD_DEFAULTS.TIMEOUT_MS);
  await settle();
  assert.equal(executor.started.length, 1);
  assert.equal(store.children.get("id-1")?.status, CHILD_RUN_STATUS.RUNNING);
  assert.equal(store.children.get("id-1")?.startedAt, clock.now);
});

test("a spawn the store refuses starts nothing", async () => {
  const { service, store, executor } = harness();
  store.refuse = true;
  const outcome = await service.spawn(request());
  assert.deepEqual(outcome, { accepted: false, reason: CHILD_SPAWN_REFUSAL.PERSISTENCE });
  await settle();
  assert.equal(executor.started.length, 0);
});

test("children start isolated by default, thread-bound forks inherit, and a fork over the cap starts isolated and says so", async () => {
  const { service, executor } = harness();
  const items = [{ type: "message", role: "user", content: "earlier" }];
  const isolated = await service.spawn(request());
  const forked = await service.spawn(
    request(MAIN_SESSION_KEY, {
      thread: true,
      fork: () => ({ items, estimatedTokens: 10 }),
    }),
  );
  const capped = await service.spawn(
    request(MAIN_SESSION_KEY, {
      context: CHILD_CONTEXT_MODE.FORK,
      fork: () => ({ items, estimatedTokens: CHILD_DEFAULTS.FORK_CAP_TOKENS + 1 }),
    }),
  );
  const empty = await service.spawn(
    request(MAIN_SESSION_KEY, { context: CHILD_CONTEXT_MODE.FORK, fork: () => undefined }),
  );
  assert.ok(isolated.accepted && forked.accepted && capped.accepted && empty.accepted);
  assert.equal(isolated.receipt.context, CHILD_CONTEXT_MODE.ISOLATED);
  assert.equal(forked.receipt.context, CHILD_CONTEXT_MODE.FORK);
  assert.equal(capped.receipt.context, CHILD_CONTEXT_MODE.ISOLATED);
  assert.equal(empty.receipt.context, CHILD_CONTEXT_MODE.ISOLATED);
  await settle();
  assert.deepEqual(executor.started[1]?.fork, items);
  assert.equal(executor.started[2]?.fork, undefined);
  const other = await service.spawn(
    request(MAIN_SESSION_KEY, { context: CHILD_CONTEXT_MODE.FORK, sameAgent: false }),
  );
  assert.deepEqual(other, { accepted: false, reason: CHILD_SPAWN_REFUSAL.FORK_OTHER_AGENT });
});

test("five active children per requester, eight overall, and five levels of depth are the limits", async () => {
  const { service } = harness();
  for (let index = 0; index < CHILD_DEFAULTS.MAXIMUM_ACTIVE_PER_REQUESTER; index += 1) {
    assert.ok((await service.spawn(request())).accepted);
  }
  const sixth = await service.spawn(request());
  assert.equal(sixth.accepted, false);
  if (!sixth.accepted) assert.equal(sixth.reason, CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT);
  const thread = threadSessionKey("t1");
  for (let index = 0; index < CHILD_DEFAULTS.MAXIMUM_ACTIVE_GLOBAL - 5; index += 1) {
    assert.ok((await service.spawn(request(thread))).accepted);
  }
  const ninth = await service.spawn(request(threadSessionKey("t2")));
  assert.equal(ninth.accepted, false);
  if (!ninth.accepted) assert.equal(ninth.reason, CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT);
  const deep = await service.spawn(
    request(threadSessionKey("t3"), { requesterDepth: CHILD_DEFAULTS.DEPTH_CAP }),
  );
  assert.equal(deep.accepted, false);
  if (!deep.accepted) assert.equal(deep.reason, CHILD_SPAWN_REFUSAL.DEPTH_CAP);
});

test("a completion is persisted before delivery, delivered to the requesting conversation, and the child archived after an hour", async () => {
  const { service, store, executor, deliverer, clock } = harness();
  const thread = threadSessionKey("private");
  const outcome = await service.spawn(request(thread));
  assert.ok(outcome.accepted);
  await settle();
  deliverer.accept = false;
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED, resultText: "all green" });
  await settle();
  const completion = store.completions.get("completion:id-1");
  assert.ok(completion);
  assert.equal(completion.destination, thread);
  assert.equal(completion.resultText, "all green");
  assert.equal(completion.delivery, COMPLETION_DELIVERY_STATUS.PENDING);
  assert.equal(completion.attempts, 1);
  assert.equal(completion.nextAttemptAt, clock.now + CHILD_DEFAULTS.DELIVERY_INITIAL_BACKOFF_MS);
  assert.equal(store.children.get("id-1")?.status, CHILD_RUN_STATUS.COMPLETED);
  deliverer.accept = true;
  await clock.advanceTo(clock.now + CHILD_DEFAULTS.DELIVERY_INITIAL_BACKOFF_MS);
  assert.equal(
    store.completions.get("completion:id-1")?.delivery,
    COMPLETION_DELIVERY_STATUS.DELIVERED,
  );
  assert.deepEqual(
    deliverer.delivered.map((delivery) => delivery.destination),
    [thread, thread],
  );
  assert.deepEqual(executor.archived, []);
  await clock.advanceTo(NOW + CHILD_DEFAULTS.ARCHIVE_AFTER_MS + 1);
  assert.deepEqual(executor.archived, ["id-1"]);
  assert.ok(store.children.get("id-1")?.archivedAt);
});

test("blocked delivery backs off from 15 seconds to five minutes, blocks after 30 minutes, warns at 25, and refuses spawns at 50", async () => {
  assert.equal(deliveryBackoffMs(1), 15_000);
  assert.equal(deliveryBackoffMs(2), 30_000);
  assert.equal(deliveryBackoffMs(6), 300_000);
  assert.equal(deliveryBackoffMs(12), 300_000);
  const { service, store, executor, deliverer, clock } = harness({
    limits: { maximumActivePerRequester: 100, maximumActiveGlobal: 100 },
  });
  deliverer.accept = false;
  for (let index = 0; index < CHILD_DEFAULTS.BLOCKED_REFUSAL; index += 1) {
    assert.ok((await service.spawn(request())).accepted);
  }
  await settle();
  for (const started of executor.started) started.end({ status: CHILD_RUN_STATUS.COMPLETED });
  await settle();
  await clock.advanceTo(NOW + CHILD_DEFAULTS.DELIVERY_WINDOW_MS + 1);
  const blocked = [...store.completions.values()].filter(
    (completion) => completion.delivery === COMPLETION_DELIVERY_STATUS.BLOCKED,
  );
  assert.equal(blocked.length, CHILD_DEFAULTS.BLOCKED_REFUSAL);
  const refused = await service.spawn(request());
  assert.equal(refused.accepted, false);
  if (!refused.accepted) assert.equal(refused.reason, CHILD_SPAWN_REFUSAL.BLOCKED_COMPLETIONS);
  // A blocked result is retained seven days and then let go of at the next load.
  const reloaded = harness({ store });
  reloaded.clock.now = clock.now + CHILD_DEFAULTS.BLOCKED_RETENTION_MS + 1;
  await reloaded.service.start();
  assert.equal(reloaded.service.completions().length, 0);
});

test("the same completion is delivered once however often the deliverer is asked, and a manual retry reopens a blocked one", async () => {
  const { service, store, executor, deliverer, clock } = harness();
  deliverer.accept = false;
  assert.ok((await service.spawn(request())).accepted);
  await settle();
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED, resultText: "x" });
  await settle();
  await clock.advanceTo(NOW + CHILD_DEFAULTS.DELIVERY_WINDOW_MS + 1);
  assert.equal(
    store.completions.get("completion:id-1")?.delivery,
    COMPLETION_DELIVERY_STATUS.BLOCKED,
  );
  const attemptsBlocked = deliverer.delivered.length;
  deliverer.accept = true;
  assert.equal(await service.retryDelivery("id-1"), true);
  await settle();
  assert.equal(
    store.completions.get("completion:id-1")?.delivery,
    COMPLETION_DELIVERY_STATUS.DELIVERED,
  );
  assert.equal(deliverer.delivered.length, attemptsBlocked + 1);
  assert.equal(await service.retryDelivery("id-1"), false);
  assert.ok(deliverer.delivered.every((delivery) => delivery.completionId === "completion:id-1"));
});

test("a parent's completion never ends its child, but an explicit cancellation cascades through descendants deepest first", async () => {
  const { service, executor, store } = harness();
  const parent = await service.spawn(request());
  assert.ok(parent.accepted);
  await settle();
  const child = await service.spawn(request(parent.receipt.childSessionKey, { requesterDepth: 1 }));
  assert.ok(child.accepted);
  await settle();
  const grandchild = await service.spawn(
    request(child.receipt.childSessionKey, { requesterDepth: 2 }),
  );
  assert.ok(grandchild.accepted);
  await settle();
  assert.equal(grandchild.receipt.depth, 3);
  // The parent ends; its children keep running.
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED });
  await settle();
  assert.equal(store.children.get(child.receipt.childId)?.status, CHILD_RUN_STATUS.RUNNING);
  assert.equal(store.children.get(grandchild.receipt.childId)?.status, CHILD_RUN_STATUS.RUNNING);
  const cancelled = await service.cancel(child.receipt.childId);
  assert.deepEqual(cancelled, { ok: true, remaining: [] });
  assert.deepEqual(executor.cancelled, [grandchild.receipt.childId, child.receipt.childId]);
  assert.equal(store.children.get(child.receipt.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
  assert.equal(store.children.get(grandchild.receipt.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
});

test("a reset's descendant cancellation reports honestly when a cancel does not land", async () => {
  const { service, executor, store } = harness();
  const first = await service.spawn(request());
  const second = await service.spawn(request());
  assert.ok(first.accepted && second.accepted);
  await settle();
  executor.cancelLands = false;
  const outcome = await service.cancelDescendantsOf(MAIN_SESSION_KEY);
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    [...outcome.remaining].sort(),
    [first.receipt.childId, second.receipt.childId].sort(),
  );
  assert.equal(store.children.get(first.receipt.childId)?.status, CHILD_RUN_STATUS.RUNNING);
  executor.cancelLands = true;
  assert.deepEqual(await service.cancelDescendantsOf(MAIN_SESSION_KEY), {
    ok: true,
    remaining: [],
  });
});

test("a cancel racing the child's own end leaves one terminal status and one completion", async () => {
  const { service, executor, store } = harness();
  const spawned = await service.spawn(request());
  assert.ok(spawned.accepted);
  await settle();
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED, resultText: "finished" });
  const cancelled = service.cancel(spawned.receipt.childId);
  await settle();
  await cancelled;
  const record = store.children.get(spawned.receipt.childId);
  const terminal: readonly string[] = [CHILD_RUN_STATUS.COMPLETED, CHILD_RUN_STATUS.CANCELLED];
  assert.ok(record && terminal.includes(record.status));
  assert.equal(store.completions.size, 1);
  assert.equal(store.completions.get("completion:id-1")?.status, record.status);
});

test("a relaunch adopts unfinished children through the executor's recovery and keeps a bounded budget of start failures", async () => {
  const { service, store, executor } = harness();
  for (let index = 0; index < 5; index += 1) assert.ok((await service.spawn(request())).accepted);
  await settle();
  assert.equal(executor.started.length, 5);
  // Relaunch: the same store, a new service minting ids of its own; the backend refuses every resume.
  let later = 0;
  const relaunch = harness({ store, createId: () => `later-${++later}` });
  relaunch.executor.refuseResume = "no model";
  await relaunch.service.start();
  await settle();
  assert.equal(relaunch.executor.resumed.length, CHILD_DEFAULTS.RECOVERY_FAILURE_BUDGET);
  assert.equal(relaunch.service.recoveryFailures(), CHILD_DEFAULTS.RECOVERY_FAILURE_BUDGET);
  for (const record of relaunch.service.children()) {
    assert.equal(record.status, CHILD_RUN_STATUS.UNKNOWN);
  }
  assert.equal(relaunch.service.completions().length, 5);
  for (const completion of relaunch.service.completions()) {
    assert.equal(completion.status, CHILD_RUN_STATUS.UNKNOWN);
    assert.equal(completion.delivery, COMPLETION_DELIVERY_STATUS.DELIVERED);
  }
  // A backend that actually starts resets the budget.
  const spawned = await relaunch.service.spawn(request(threadSessionKey("later")));
  assert.ok(spawned.accepted);
  await settle();
  assert.equal(relaunch.service.recoveryFailures(), 0);
});

test("a relaunch that recovers a child preserves the unknown outcome the runtime reports rather than replaying it", async () => {
  const { service, store, executor } = harness();
  assert.ok((await service.spawn(request())).accepted);
  await settle();
  assert.equal(executor.started.length, 1);
  const relaunch = harness({ store });
  await relaunch.service.start();
  await settle();
  assert.equal(relaunch.executor.resumed.length, 1);
  assert.equal(relaunch.executor.started.length, 0);
  const record = relaunch.service.child("id-1");
  assert.equal(record?.status, CHILD_RUN_STATUS.UNKNOWN);
  assert.equal(record?.failureDetail, "interrupted");
  assert.equal(relaunch.deliverer.delivered.length, 1);
});

test("a fire-and-forget child records its delivery as not required, and delete cleanup archives at once", async () => {
  const { service, store, executor, deliverer } = harness();
  const spawned = await service.spawn(
    request(MAIN_SESSION_KEY, { expectsCompletion: false, cleanup: "delete" }),
  );
  assert.ok(spawned.accepted);
  await settle();
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED });
  await settle();
  assert.equal(
    store.completions.get("completion:id-1")?.delivery,
    COMPLETION_DELIVERY_STATUS.NOT_REQUIRED,
  );
  assert.equal(deliverer.delivered.length, 0);
  assert.deepEqual(executor.archived, ["id-1"]);
});

test("a cancel that lands while the child is still starting stops the run that then begins, and the terminal row is never overwritten", async () => {
  const { service, store, executor } = harness();
  let release: (() => void) | undefined;
  executor.holdStart = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spawned = await service.spawn(request());
  assert.ok(spawned.accepted);
  await settle();
  assert.equal(executor.started.length, 0);
  // The cancel finds no run yet; the record settles cancelled on its word.
  const cancelled = await service.cancel(spawned.receipt.childId);
  assert.deepEqual(cancelled, { ok: true, remaining: [] });
  assert.equal(store.children.get("id-1")?.status, CHILD_RUN_STATUS.CANCELLED);
  assert.deepEqual(executor.cancelled, ["id-1"]);
  // The backend then starts the run anyway: it is stopped, and the row stays cancelled, never running.
  release?.();
  await settle();
  assert.equal(executor.started.length, 1);
  assert.deepEqual(executor.cancelled, ["id-1", "id-1"]);
  const record = store.children.get("id-1");
  assert.equal(record?.status, CHILD_RUN_STATUS.CANCELLED);
  assert.equal(record?.startedAt, undefined);
  executor.started[0]?.end({ status: CHILD_RUN_STATUS.COMPLETED, resultText: "too late" });
  await settle();
  assert.equal(store.children.get("id-1")?.status, CHILD_RUN_STATUS.CANCELLED);
  assert.equal(store.completions.size, 1);
  assert.equal(store.completions.get("completion:id-1")?.status, CHILD_RUN_STATUS.CANCELLED);
});
