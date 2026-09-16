import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import { FUNCTION_MAX_DURATION_SECONDS } from "../server/function-durations";
import { APNS_REQUEST_TIMEOUT_MS } from "../server/hosted/apns";
import type { ChildCompletionSweepOutcome } from "../server/hosted/brain-host/child-completion";
import type { TurnOpeningOutcome } from "../server/hosted/brain-host/opener";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { OBSERVATION_TICK, OBSERVATION_TICK_PATH } from "../server/hosted/observation-bounds";
import {
  handleObservationTick,
  type ObservationTickOptions,
} from "../server/hosted/observation-tick";
import { SPEECH_PUSH, type SpeechPushOutcome } from "../server/hosted/speech-push";
import type { SpeechSweepOutcome } from "../server/hosted/store";
import { noDatabase, runWithoutDatabase } from "./support/no-database";

const CRON_SECRET = "cron-secret-1";
const ENCRYPTION_SECRET = "a".repeat(64);
const TICK_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const SWEPT: SpeechSweepOutcome = { held: 1, released: 0, expired: 3, turns: 0 };
const PUSHED: SpeechPushOutcome = {
  pushed: 1,
  undelivered: 0,
  unaddressed: 2,
  unreadable: 0,
  waiting: 1,
};
/** What one account's completion sweep answers unless a test says otherwise; the tick sums one per account reached. */
const COMPLETED: ChildCompletionSweepOutcome = { delivered: 1, undelivered: 0, withheld: 2 };
const completedFor = (accounts: number): ChildCompletionSweepOutcome => ({
  delivered: COMPLETED.delivered * accounts,
  undelivered: 0,
  withheld: COMPLETED.withheld * accounts,
});
/** What one account's opening answers unless a test says otherwise: nothing pending, nothing opened. */
const NOTHING_OPENED: TurnOpeningOutcome = {
  observation: 0,
  holdRelease: 0,
  failed: 0,
  reseeded: 0,
};

/** The scheduler's call; `null` sends no bearer at all. */
function tickRequest(authorization: string | null = `Bearer ${CRON_SECRET}`): Request {
  return new Request(`https://luke.test${OBSERVATION_TICK_PATH}`, {
    method: "GET",
    headers: authorization === null ? {} : { authorization },
  });
}

/** What one tick was asked to do, recorded for the test to read back. */
interface Recorded {
  forgot: number[];
  purged: number[];
  swept: number[];
  pushed: number[];
  listed: Array<{ limit: number; seenAfter: number }>;
  observed: string[];
  /** Each account's pass and opening in the order the tick ran them, as one list, so the order between them is what a test reads. */
  ran: string[];
}

function tickOptions(
  overrides: Partial<ObservationTickOptions> = {},
  accounts: string[] = ["user-a", "user-b"],
  outcome: ObservationTickOptions["observe"] = () =>
    Effect.succeed({ complete: true, changed: false }),
  opening: (userId: string) => Effect.Effect<TurnOpeningOutcome> = () =>
    Effect.succeed(NOTHING_OPENED),
) {
  const recorded: Recorded = {
    forgot: [],
    purged: [],
    swept: [],
    pushed: [],
    listed: [],
    observed: [],
    ran: [],
  };
  const options: ObservationTickOptions = {
    request: tickRequest(),
    cronSecret: CRON_SECRET,
    encryptionSecret: ENCRYPTION_SECRET,
    listAccounts: (limit, seenAfter) =>
      Effect.sync(() => {
        recorded.listed.push({ limit, seenAfter });
        return accounts.map((userId) => ({ userId }));
      }),
    forgetIneligible: (seenAfter) =>
      Effect.sync(() => {
        recorded.forgot.push(seenAfter);
      }),
    purgeCleared: (now) =>
      Effect.sync(() => {
        recorded.purged.push(now);
        return 2;
      }),
    sweepSpeech: (now) =>
      Effect.sync(() => {
        recorded.swept.push(now);
        return SWEPT;
      }),
    pushSpeech: (now) =>
      Effect.sync(() => {
        recorded.pushed.push(now);
        return PUSHED;
      }),
    observe: (userId) =>
      Effect.gen(function* () {
        recorded.observed.push(userId);
        recorded.ran.push(`observe:${userId}`);
        // A concurrent batch's passes interleave before any opens it, exactly
        // as a real pass's own await would; the yield stands in for that.
        yield* Effect.yieldNow;
        return yield* outcome(userId);
      }),
    openTurns: (userId) =>
      Effect.gen(function* () {
        recorded.ran.push(`open:${userId}`);
        return yield* opening(userId);
      }),
    sweepChildCompletions: (userId) =>
      Effect.sync(() => {
        recorded.ran.push(`children:${userId}`);
        return COMPLETED;
      }),
    now: () => TICK_TIME,
    ...overrides,
  };
  return { options, recorded };
}

/** The tick, run over a client that refuses every statement — nothing here ever reaches one. */
function runTick(options: ObservationTickOptions): Promise<Response> {
  return runWithoutDatabase(handleObservationTick(options));
}

test("the tick is off without CRON_SECRET or the encryption secret, and refuses a wrong bearer", async () => {
  const wrongMethod = await runTick(
    tickOptions({
      request: new Request(`https://luke.test${OBSERVATION_TICK_PATH}`, { method: "POST" }),
    }).options,
  );
  assert.equal(wrongMethod.status, 405);

  const noCron = await runTick(tickOptions({ cronSecret: undefined }).options);
  assert.equal(noCron.status, 503);
  assert.equal((await noCron.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankCron = await runTick(tickOptions({ cronSecret: "  " }).options);
  assert.equal(blankCron.status, 503);

  const noEncryption = await runTick(tickOptions({ encryptionSecret: undefined }).options);
  assert.equal(noEncryption.status, 503);

  const { options, recorded } = tickOptions({ request: tickRequest("Bearer other") });
  const wrongBearer = await runTick(options);
  assert.equal(wrongBearer.status, 401);
  assert.equal((await wrongBearer.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  const missing = await runTick(tickOptions({ request: tickRequest(null) }).options);
  assert.equal(missing.status, 401);
  assert.deepEqual(recorded.forgot, []);
  assert.deepEqual(recorded.observed, []);
});

test("a tick forgets the ineligible, lists accounts seen within the week, and observes each, counting outcomes", async () => {
  const outcomes = new Map([
    ["user-a", { complete: true, changed: true }],
    ["user-b", { complete: false, changed: false }],
    ["user-c", { complete: true, changed: false }],
  ]);
  const { options, recorded } = tickOptions({}, [...outcomes.keys()], (userId) =>
    Effect.sync(() => {
      const outcome = outcomes.get(userId);
      assert.ok(outcome);
      return outcome;
    }),
  );

  const response = await runTick(options);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accounts: 3,
    observed: 2,
    failed: 1,
    changed: 1,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    children: completedFor(3),
    turns: NOTHING_OPENED,
  });
  const seenAfter = TICK_TIME - OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS;
  assert.deepEqual(recorded.forgot, [seenAfter]);
  assert.deepEqual(recorded.purged, [TICK_TIME]);
  assert.deepEqual(recorded.swept, [TICK_TIME]);
  assert.deepEqual(recorded.pushed, [TICK_TIME]);
  assert.deepEqual(recorded.listed, [{ limit: OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter }]);
  assert.deepEqual(recorded.observed, ["user-a", "user-b", "user-c"]);
});

test("a pass that throws is counted as failed and does not end the tick", async () => {
  const { options } = tickOptions({}, ["user-a", "user-b"], (userId) =>
    Effect.sync(() => {
      if (userId === "user-a") throw new Error("the adapter had a bug");
      return { complete: true, changed: false };
    }),
  );

  const response = await runTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 1,
    failed: 1,
    changed: 0,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    children: completedFor(2),
    turns: NOTHING_OPENED,
  });
});

test("a tick starts a batch only while a whole pass deadline still fits its budget, and reports the accounts it could not reach", async () => {
  let now = TICK_TIME;
  const accounts = Array.from({ length: OBSERVATION_TICK.CONCURRENCY * 3 }, (_, i) => `user-${i}`);
  const { options, recorded } = tickOptions(
    { now: () => now, budgetMs: 10_000, passDeadlineMs: 1_000 },
    accounts,
    () =>
      Effect.sync(() => {
        now += 3_000;
        return { complete: true, changed: false };
      }),
  );

  const response = await runTick(options);

  const body = await response.json();
  assert.equal(body.exhausted, true);
  assert.equal(body.purged, 2);
  assert.equal(body.accounts, OBSERVATION_TICK.CONCURRENCY);
  assert.equal(recorded.observed.length, OBSERVATION_TICK.CONCURRENCY);
});

it.effect("a pass that outruns its deadline is counted failed and the tick moves on", () =>
  Effect.gen(function* () {
    const { options } = tickOptions(
      { passDeadlineMs: 20 },
      ["user-slow", "user-quick"],
      (userId) =>
        userId === "user-slow" ? Effect.never : Effect.succeed({ complete: true, changed: true }),
    );

    const fiber = yield* Effect.forkChild(
      Effect.provide(handleObservationTick(options), noDatabase),
    );
    yield* TestClock.adjust(Duration.millis(20));
    const response = yield* Fiber.join(fiber);
    const body = yield* Effect.promise(() => response.json());

    assert.deepEqual(body, {
      accounts: 2,
      observed: 1,
      failed: 1,
      changed: 1,
      exhausted: false,
      purged: 2,
      speech: SWEPT,
      push: PUSHED,
      children: completedFor(1),
      turns: { observation: 0, holdRelease: 0, failed: 1, reseeded: 0 },
    });
  }),
);

test("each account's opening runs after its own pass, inside the same share of the tick, and its counts are summed; a pass that throws is still followed by its opening", async () => {
  const openings = new Map<string, TurnOpeningOutcome>([
    ["user-a", { observation: 2, holdRelease: 0, failed: 0, reseeded: 0 }],
    ["user-b", { observation: 0, holdRelease: 1, failed: 1, reseeded: 1 }],
  ]);
  const { options, recorded } = tickOptions(
    {},
    ["user-a", "user-b"],
    (userId) =>
      Effect.sync(() => {
        if (userId === "user-a") throw new Error("the adapter had a bug");
        return { complete: true, changed: true };
      }),
    (userId) =>
      Effect.sync(() => {
        const opened = openings.get(userId);
        assert.ok(opened);
        return opened;
      }),
  );

  const response = await runTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 1,
    failed: 1,
    changed: 1,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    children: completedFor(2),
    turns: { observation: 2, holdRelease: 1, failed: 1, reseeded: 1 },
  });
  assert.deepEqual(recorded.ran, [
    "observe:user-a",
    "observe:user-b",
    "open:user-a",
    "children:user-a",
    "open:user-b",
    "children:user-b",
  ]);
});

test("an opening that throws is one failed opening and nothing else of the tick is lost", async () => {
  const { options } = tickOptions(
    {},
    ["user-a", "user-b"],
    () => Effect.succeed({ complete: true, changed: false }),
    (userId) =>
      Effect.sync(() => {
        if (userId === "user-a") throw new Error("eve went away");
        return { observation: 1, holdRelease: 0, failed: 0, reseeded: 0 };
      }),
  );

  const response = await runTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 2,
    failed: 0,
    changed: 0,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    children: completedFor(2),
    turns: { observation: 1, holdRelease: 0, failed: 1, reseeded: 0 },
  });
});

test("the budget leaves headroom under the function cap, the push pass with one send still waiting leaves room for a first observation batch, and the cron entry names the tick", () => {
  assert.ok(OBSERVATION_TICK.BUDGET_MS < OBSERVATION_TICK.MAX_DURATION_SECONDS * 1000);
  assert.ok(OBSERVATION_TICK.PASS_DEADLINE_MS < OBSERVATION_TICK.BUDGET_MS);
  assert.ok(
    SPEECH_PUSH.BUDGET_MS + APNS_REQUEST_TIMEOUT_MS <
      OBSERVATION_TICK.BUDGET_MS - OBSERVATION_TICK.PASS_DEADLINE_MS,
  );
  // SAFETY: the file is this repository's own vercel.json, read for the cron entry checked below.
  const vercel = JSON.parse(
    readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
  ) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons, [{ path: OBSERVATION_TICK_PATH, schedule: "* * * * *" }]);
  assert.equal(
    FUNCTION_MAX_DURATION_SECONDS.get(OBSERVATION_TICK_PATH),
    OBSERVATION_TICK.MAX_DURATION_SECONDS,
  );
});
