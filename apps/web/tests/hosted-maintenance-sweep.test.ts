import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Duration, Effect, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import { FUNCTION_MAX_DURATION_SECONDS } from "../server/function-durations";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { MAINTENANCE_SWEEP, MAINTENANCE_SWEEP_PATH } from "../server/hosted/maintenance-bounds";
import {
  handleMaintenanceSweep,
  type MaintenanceSweepOptions,
} from "../server/hosted/maintenance-sweep";
import type { VoiceOrphanSweepOutcome } from "../server/voice/orphan-sweep";
import { noDatabase } from "./support/no-database";

const CRON_SECRET = Redacted.make("cron-secret-1");
const SWEEP_TIME = Date.parse("2026-08-12T02:45:00.000Z");
/** What the sweep over the detached voice sessions answers. */
const VOICED: VoiceOrphanSweepOutcome = { closed: 2, lost: 1, failed: 0 };

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
  abandoned: number[];
  voiced: number[];
}

function sweepOptions(overrides: Partial<MaintenanceSweepOptions> = {}) {
  const recorded: Recorded = { purged: [], abandoned: [], voiced: [] };
  const options: MaintenanceSweepOptions = {
    request: sweepRequest(),
    cronSecret: CRON_SECRET,
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
    sweepVoice: (now) =>
      Effect.sync(() => {
        recorded.voiced.push(now);
        return VOICED;
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

it.effect("a sweep refuses every method but GET, and runs nothing", () =>
  Effect.gen(function* () {
    const { options, recorded } = sweepOptions({ request: sweepRequest(undefined, "POST") });
    const answer = yield* sweep(options);

    assert.equal(answer.status, 405);
    assert.deepEqual(recorded, { purged: [], abandoned: [], voiced: [] });
  }),
);

it.effect("a deployment without CRON_SECRET answers unavailable and sweeps nothing", () =>
  Effect.gen(function* () {
    const { options, recorded } = sweepOptions({ cronSecret: undefined });
    const answer = yield* sweep(options);

    assert.equal(answer.status, 503);
    assert.equal(answer.body.error, HOSTED_API_ERROR.UNAVAILABLE);
    assert.deepEqual(recorded, { purged: [], abandoned: [], voiced: [] });
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
    assert.deepEqual(wrong.recorded, { purged: [], abandoned: [], voiced: [] });
    assert.deepEqual(missing.recorded, { purged: [], abandoned: [], voiced: [] });
  }),
);

it.effect(
  "the cron's own bearer runs each sweep at the clock's instant and answers their counts",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SWEEP_TIME);
      yield* TestClock.adjust(Duration.seconds(7));
      const { options, recorded } = sweepOptions();
      const answer = yield* sweep(options);

      const at = SWEEP_TIME + 7_000;
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body, { purged: 2, abandoned: 1, voice: VOICED });
      assert.deepEqual(recorded, { purged: [at], abandoned: [at], voiced: [at] });
    }),
);

test("the cron entry names the sweep, and the sweep's function declares the sweep's cap", () => {
  // SAFETY: the file is this repository's own vercel.json, read for the cron entry checked below.
  const vercel = JSON.parse(
    readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
  ) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons, [{ path: MAINTENANCE_SWEEP_PATH, schedule: "* * * * *" }]);
  assert.equal(
    FUNCTION_MAX_DURATION_SECONDS.get(MAINTENANCE_SWEEP_PATH),
    MAINTENANCE_SWEEP.MAX_DURATION_SECONDS,
  );
});
