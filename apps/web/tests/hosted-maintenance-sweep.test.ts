import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { MAINTENANCE_SWEEP_PATH } from "../server/hosted/maintenance-bounds";
import {
  handleMaintenanceSweep,
  type MaintenanceSweepOptions,
} from "../server/hosted/maintenance-sweep";
import type { SessionSandboxSweepOutcome } from "../server/hosted/session-sandboxes";
import type { VoiceOrphanSweepOutcome } from "../server/voice/orphan-sweep";
import { noDatabase } from "./support/no-database";

const CRON_SECRET = Redacted.make("cron-secret-1");
/** What the sweep over the detached voice sessions answers. */
const VOICED: VoiceOrphanSweepOutcome = { closed: 2, lost: 1, pending: 1, failed: 0 };
/** What the sweep over the queued sessions' sandboxes answers. */
const SANDBOXED: SessionSandboxSweepOutcome = { deleted: 4, pending: 1 };

/** The scheduler's call; `null` sends no bearer at all. */
function sweepRequest(
  authorization: string | null = `Bearer ${Redacted.value(CRON_SECRET)}`,
  method = "GET",
): Request {
  return new Request(`https://luke.test${MAINTENANCE_SWEEP_PATH}`, {
    method,
    headers: authorization === null ? {} : { authorization },
  });
}

/** The instant each sweep was handed, recorded for the test to read back. */
interface Recorded {
  purged: number[];
  purgedCalls: number[];
  abandoned: number[];
  voiced: number[];
  sandboxed: number[];
  automated: number[];
}

function sweepOptions(overrides: Partial<MaintenanceSweepOptions> = {}) {
  const recorded: Recorded = {
    purged: [],
    purgedCalls: [],
    abandoned: [],
    voiced: [],
    sandboxed: [],
    automated: [],
  };
  const options: MaintenanceSweepOptions = {
    request: sweepRequest(),
    cronSecret: CRON_SECRET,
    purgeCleared: (now) =>
      Effect.sync(() => {
        recorded.purged.push(now);
        return 2;
      }),
    purgeDeletedPlanCalls: (now) =>
      Effect.sync(() => {
        recorded.purgedCalls.push(now);
        return 3;
      }),
    sweepAbandonedTurns: (now) =>
      Effect.sync(() => {
        recorded.abandoned.push(now);
        return 1;
      }),
    sweepVoice: (now) =>
      Effect.sync(() => {
        recorded.voiced.push(now);
        return VOICED;
      }),
    sweepSandboxes: (now) =>
      Effect.sync(() => {
        recorded.sandboxed.push(now);
        return SANDBOXED;
      }),
    sweepAutomations: (now) =>
      Effect.sync(() => {
        recorded.automated.push(now);
        return { fired: 1, started: 1, skipped: 0, failed: 0 };
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
      purgedCalls: [],
      abandoned: [],
      voiced: [],
      sandboxed: [],
      automated: [],
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
      purgedCalls: [],
      abandoned: [],
      voiced: [],
      sandboxed: [],
      automated: [],
    });
    assert.deepEqual(missing.recorded, {
      purged: [],
      purgedCalls: [],
      abandoned: [],
      voiced: [],
      sandboxed: [],
      automated: [],
    });
  }),
);
