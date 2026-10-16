import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@luke/database/testing/no-database";
import { Effect, Redacted } from "effect";
import type { SessionSandboxSweepOutcome } from "../agents/session-sandboxes.js";
import { HOSTED_API_ERROR } from "../http/http.js";
import type { VoiceOrphanSweepOutcome } from "../voice/orphan-sweep.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import { handleMaintenanceSweep, type MaintenanceSweepOptions } from "./maintenance-sweep.js";
import type { TerminalLeaseSweepOutcome } from "./terminal-lease-sweep.js";

const CRON_SECRET = Redacted.make("cron-secret-1");
/** What the sweep over the detached voice sessions answers. */
const VOICED: VoiceOrphanSweepOutcome = { closed: 2, lost: 1, pending: 1, failed: 0 };
/** What the sweep over the queued sessions' sandboxes answers. */
const SANDBOXED: SessionSandboxSweepOutcome = { deleted: 4, pending: 1 };
/** What the sweep over the lapsed terminal leases answers. */
const TERMINALS: TerminalLeaseSweepOutcome = { stopped: 2, released: 1, pending: 0 };

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
  terminals: number[];
  automated: number[];
  pictures: number[];
}

function sweepOptions(overrides: Partial<MaintenanceSweepOptions> = {}) {
  const recorded: Recorded = {
    purged: [],
    purgedCalls: [],
    abandoned: [],
    voiced: [],
    sandboxed: [],
    terminals: [],
    automated: [],
    pictures: [],
  };
  const options: MaintenanceSweepOptions = {
    request: sweepRequest(),
    cronSecret: CRON_SECRET,
    purgeCleared: (now) =>
      Effect.sync(() => {
        recorded.purged.push(now);
        return 2;
      }),
    purgeDeletedTaskCalls: (now) =>
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
    sweepTerminalLeases: (now) =>
      Effect.sync(() => {
        recorded.terminals.push(now);
        return TERMINALS;
      }),
    sweepAutomations: (now) =>
      Effect.sync(() => {
        recorded.automated.push(now);
        return { fired: 1, started: 1, skipped: 0, failed: 0, archived: 0 };
      }),
    purgeUnsavedPictures: (now) =>
      Effect.sync(() => {
        recorded.pictures.push(now);
        return 4;
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
      terminals: [],
      automated: [],
      pictures: [],
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
      terminals: [],
      automated: [],
      pictures: [],
    });
    assert.deepEqual(missing.recorded, {
      purged: [],
      purgedCalls: [],
      abandoned: [],
      voiced: [],
      sandboxed: [],
      terminals: [],
      automated: [],
      pictures: [],
    });
  }),
);

it.effect(
  "an authorized sweep runs every sweep at one instant, the lapsed terminal leases and the unsaved pictures among them, and answers what each did",
  () =>
    Effect.gen(function* () {
      const { options, recorded } = sweepOptions();
      const answer = yield* sweep(options);

      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body.terminals, TERMINALS);
      assert.deepEqual(answer.body.sandboxes, SANDBOXED);
      assert.equal(answer.body.purgedPictures, 4);
      const [instant] = recorded.terminals;
      assert.ok(instant !== undefined);
      assert.deepEqual(recorded, {
        purged: [instant],
        purgedCalls: [instant],
        abandoned: [instant],
        voiced: [instant],
        sandboxed: [instant],
        terminals: [instant],
        automated: [instant],
        pictures: [instant],
      });
    }),
);
