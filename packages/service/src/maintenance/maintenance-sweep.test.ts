import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@repo/database/testing/no-database";
import { Effect, Exit, Redacted } from "effect";
import type { SessionSandboxSweepOutcome } from "../agents/session-sandboxes.js";
import { HOSTED_API_ERROR } from "../http/http.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import {
  handleMaintenanceSweep,
  type MaintenanceSweepOptions,
  SWEEP_FAILED,
} from "./maintenance-sweep.js";
import type { NativeSandboxSweepOutcome } from "./native-sandbox-sweep.js";

const CRON_SECRET = Redacted.make("cron-secret-1");
/** What the sweep over the queued sessions' sandboxes answers. */
const SANDBOXED: SessionSandboxSweepOutcome = { deleted: 4, pending: 1 };
/** What the sweep over the running native sandboxes answers. */
const NATIVE: NativeSandboxSweepOutcome = { lost: 1 };

/** The scheduler's call; `null` sends no bearer at all. */
function sweepRequest(
  authorization: string | null = `Bearer ${Redacted.value(CRON_SECRET)}`,
  method = "GET",
): Request {
  return new Request(`https://app.test${MAINTENANCE_SWEEP_PATH}`, {
    method,
    headers: authorization === null ? {} : { authorization },
  });
}

/** The instant each sweep was handed, recorded for the test to read back. */
interface Recorded {
  purged: number[];
  abandoned: number[];
  deviceLeases: number[];
  deviceWarmRunners: number[];
  sandboxed: number[];
  native: number[];
  wakeups: number[];
  automated: number[];
  syncLog: number[];
}

function sweepOptions(overrides: Partial<MaintenanceSweepOptions> = {}) {
  const recorded: Recorded = {
    purged: [],
    abandoned: [],
    deviceLeases: [],
    deviceWarmRunners: [],
    sandboxed: [],
    native: [],
    wakeups: [],
    automated: [],
    syncLog: [],
  };
  const options: MaintenanceSweepOptions = {
    request: sweepRequest(),
    cronSecret: CRON_SECRET,
    monitor: { run: (sweep) => sweep },
    purgeCleared: (now) =>
      Effect.sync(() => {
        recorded.purged.push(now);
        return 2;
      }),
    sweepAbandonedTurns: (now) =>
      Effect.sync(() => {
        recorded.abandoned.push(now);
        return 1;
      }),
    sweepDeviceLeases: (now) =>
      Effect.sync(() => {
        recorded.deviceLeases.push(now);
        return { lapsed: 1, busy: 0, failed: 0 };
      }),
    sweepDeviceWarmRunners: (now) =>
      Effect.sync(() => {
        recorded.deviceWarmRunners.push(now);
        return { retired: 1, left: 0, busy: 0, failed: 0 };
      }),
    sweepSandboxes: (now) =>
      Effect.sync(() => {
        recorded.sandboxed.push(now);
        return SANDBOXED;
      }),
    sweepNativeSandboxes: (now) =>
      Effect.sync(() => {
        recorded.native.push(now);
        return NATIVE;
      }),
    sweepNativeWakeups: (now) =>
      Effect.sync(() => {
        recorded.wakeups.push(now);
        return { delivered: 1, failed: 0 };
      }),
    sweepAutomations: (now) =>
      Effect.sync(() => {
        recorded.automated.push(now);
        return { fired: 1, started: 1, skipped: 0, failed: 0 };
      }),
    sweepAgentQueues: () => Effect.succeed(0),
    pruneSyncLog: (now) =>
      Effect.sync(() => {
        recorded.syncLog.push(now);
        return 5;
      }),
    ...overrides,
  };
  return { options, recorded };
}

/** The sweep over a client that refuses every statement — the fakes above stand in for every query. */
function sweep(options: MaintenanceSweepOptions) {
  return Effect.flatMap(Effect.provide(handleMaintenanceSweep(options), noDatabase), (response) =>
    Effect.promise(async () => ({ status: response.status, body: await response.json() })),
  );
}

it.effect("a deployment without CRON_SECRET answers unavailable and sweeps nothing", () =>
  Effect.gen(function* () {
    const { options, recorded } = sweepOptions({ cronSecret: undefined });
    const answer = yield* sweep(options);

    assert.equal(answer.status, 503);
    assert.equal(answer.body.error, HOSTED_API_ERROR.UNAVAILABLE);
    assert.deepEqual(recorded, {
      purged: [],
      abandoned: [],
      deviceLeases: [],
      deviceWarmRunners: [],
      sandboxed: [],
      native: [],
      wakeups: [],
      automated: [],
      syncLog: [],
    });
  }),
);

it.effect("a wrong or missing bearer is refused and sweeps nothing", () =>
  Effect.gen(function* () {
    const wrong = sweepOptions({ request: sweepRequest("Bearer other") });
    const wrongAnswer = yield* sweep(wrong.options);
    const missing = sweepOptions({ request: sweepRequest(null) });
    const missingAnswer = yield* sweep(missing.options);

    assert.equal(wrongAnswer.status, 401);
    assert.equal(wrongAnswer.body.error, HOSTED_API_ERROR.INVALID_TOKEN);
    assert.equal(missingAnswer.status, 401);
    assert.deepEqual(wrong.recorded, {
      purged: [],
      abandoned: [],
      deviceLeases: [],
      deviceWarmRunners: [],
      sandboxed: [],
      native: [],
      wakeups: [],
      automated: [],
      syncLog: [],
    });
    assert.deepEqual(missing.recorded, {
      purged: [],
      abandoned: [],
      deviceLeases: [],
      deviceWarmRunners: [],
      sandboxed: [],
      native: [],
      wakeups: [],
      automated: [],
      syncLog: [],
    });
  }),
);

it.effect(
  "an authorized sweep runs every sweep at one instant, the sync log among them, and answers what each did",
  () =>
    Effect.gen(function* () {
      const { options, recorded } = sweepOptions();
      const answer = yield* sweep(options);

      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body.nativeSandboxes, NATIVE);
      assert.deepEqual(answer.body.nativeWakeups, { delivered: 1, failed: 0 });
      assert.deepEqual(answer.body.sandboxes, SANDBOXED);
      assert.equal(answer.body.syncLog, 5);
      const [instant] = recorded.purged;
      assert.ok(instant !== undefined);
      assert.deepEqual(recorded, {
        purged: [instant],
        abandoned: [instant],
        deviceLeases: [instant],
        deviceWarmRunners: [instant],
        sandboxed: [instant],
        native: [instant],
        wakeups: [instant],
        automated: [instant],
        syncLog: [instant],
      });
    }),
);

it.effect(
  "a sweep that fails, or dies, answers failed in its place, the sweeps after it still run, the sync log's last among them, and the run's cron check-in fails",
  () =>
    Effect.gen(function* () {
      const checkIns: string[] = [];
      const { options, recorded } = sweepOptions({
        sweepAbandonedTurns: () => Effect.fail(new Error("a turn's row could not be read")),
        sweepAutomations: () => Effect.die(new Error("an automation's row could not be read")),
        // The cron monitor as Sentry's check-in reads the run: failed where its effect failed.
        monitor: {
          run: (run) =>
            run.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => checkIns.push(Exit.isSuccess(exit) ? "ok" : "error")),
              ),
            ),
        },
      });
      const answer = yield* sweep(options);

      assert.equal(answer.status, 500);
      assert.deepEqual(checkIns, ["error"]);
      assert.deepEqual(answer.body.abandoned, SWEEP_FAILED);
      assert.deepEqual(answer.body.automations, SWEEP_FAILED);
      assert.deepEqual(answer.body.sandboxes, SANDBOXED);
      assert.equal(recorded.syncLog.length, 1);
    }),
);
