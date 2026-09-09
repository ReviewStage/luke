import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import {
  type AccountPassOutcome,
  handleObservationTick,
  OBSERVATION_TICK,
  OBSERVATION_TICK_PATH,
  type ObservationTickOptions,
} from "../server/hosted/observation-tick";

const CRON_SECRET = "cron-secret-1";
const ENCRYPTION_SECRET = "a".repeat(64);
const TICK_TIME = Date.parse("2026-08-12T02:45:00.000Z");

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
  listed: Array<{ limit: number; seenAfter: number }>;
  observed: string[];
}

function tickOptions(
  overrides: Partial<ObservationTickOptions> = {},
  accounts: string[] = ["user-a", "user-b"],
  outcome: (userId: string) => Promise<AccountPassOutcome> = async () => ({
    complete: true,
    changed: false,
  }),
) {
  const recorded: Recorded = { forgot: [], listed: [], observed: [] };
  const options: ObservationTickOptions = {
    request: tickRequest(),
    cronSecret: CRON_SECRET,
    encryptionSecret: ENCRYPTION_SECRET,
    listAccounts: async (limit, seenAfter) => {
      recorded.listed.push({ limit, seenAfter });
      return accounts.map((userId) => ({ userId }));
    },
    forgetIneligible: async (seenAfter) => {
      recorded.forgot.push(seenAfter);
    },
    observe: async (userId) => {
      recorded.observed.push(userId);
      return outcome(userId);
    },
    now: () => TICK_TIME,
    ...overrides,
  };
  return { options, recorded };
}

test("the tick is off without CRON_SECRET or the encryption secret, and refuses a wrong bearer", async () => {
  const wrongMethod = await handleObservationTick(
    tickOptions({
      request: new Request(`https://luke.test${OBSERVATION_TICK_PATH}`, { method: "POST" }),
    }).options,
  );
  assert.equal(wrongMethod.status, 405);

  const noCron = await handleObservationTick(tickOptions({ cronSecret: undefined }).options);
  assert.equal(noCron.status, 503);
  assert.equal((await noCron.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankCron = await handleObservationTick(tickOptions({ cronSecret: "  " }).options);
  assert.equal(blankCron.status, 503);

  const noEncryption = await handleObservationTick(
    tickOptions({ encryptionSecret: undefined }).options,
  );
  assert.equal(noEncryption.status, 503);

  const { options, recorded } = tickOptions({ request: tickRequest("Bearer other") });
  const wrongBearer = await handleObservationTick(options);
  assert.equal(wrongBearer.status, 401);
  assert.equal((await wrongBearer.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  const missing = await handleObservationTick(tickOptions({ request: tickRequest(null) }).options);
  assert.equal(missing.status, 401);
  assert.deepEqual(recorded.forgot, []);
  assert.deepEqual(recorded.observed, []);
});

test("a tick forgets the ineligible, lists accounts seen within the week, and observes each, counting outcomes", async () => {
  const outcomes = new Map<string, AccountPassOutcome>([
    ["user-a", { complete: true, changed: true }],
    ["user-b", { complete: false, changed: false }],
    ["user-c", { complete: true, changed: false }],
  ]);
  const { options, recorded } = tickOptions({}, [...outcomes.keys()], async (userId) => {
    const outcome = outcomes.get(userId);
    assert.ok(outcome);
    return outcome;
  });

  const response = await handleObservationTick(options);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accounts: 3,
    observed: 2,
    failed: 1,
    changed: 1,
    exhausted: false,
  });
  const seenAfter = TICK_TIME - OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS;
  assert.deepEqual(recorded.forgot, [seenAfter]);
  assert.deepEqual(recorded.listed, [{ limit: OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter }]);
  assert.deepEqual(recorded.observed, ["user-a", "user-b", "user-c"]);
});

test("a pass that throws is counted as failed and does not end the tick", async () => {
  const { options } = tickOptions({}, ["user-a", "user-b"], async (userId) => {
    if (userId === "user-a") throw new Error("the adapter had a bug");
    return { complete: true, changed: false };
  });

  const response = await handleObservationTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 1,
    failed: 1,
    changed: 0,
    exhausted: false,
  });
});

test("a tick starts a batch only while a whole pass deadline still fits its budget, and reports the accounts it could not reach", async () => {
  let now = TICK_TIME;
  const accounts = Array.from({ length: OBSERVATION_TICK.CONCURRENCY * 3 }, (_, i) => `user-${i}`);
  const { options, recorded } = tickOptions(
    { now: () => now, budgetMs: 10_000, passDeadlineMs: 1_000 },
    accounts,
    async () => {
      now += 3_000;
      return { complete: true, changed: false };
    },
  );

  const response = await handleObservationTick(options);

  const body = await response.json();
  assert.equal(body.exhausted, true);
  assert.equal(body.accounts, OBSERVATION_TICK.CONCURRENCY);
  assert.equal(recorded.observed.length, OBSERVATION_TICK.CONCURRENCY);
});

test("a pass that outruns its deadline is counted failed and the tick moves on", async () => {
  const { options } = tickOptions({ passDeadlineMs: 20 }, ["user-slow", "user-quick"], (userId) =>
    userId === "user-slow"
      ? new Promise(() => undefined)
      : Promise.resolve({ complete: true, changed: true }),
  );

  const response = await handleObservationTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 1,
    failed: 1,
    changed: 1,
    exhausted: false,
  });
});

test("the budget leaves headroom under the function cap, and the cron entry names the tick", () => {
  assert.ok(OBSERVATION_TICK.BUDGET_MS < OBSERVATION_TICK.MAX_DURATION_SECONDS * 1000);
  assert.ok(OBSERVATION_TICK.PASS_DEADLINE_MS < OBSERVATION_TICK.BUDGET_MS);
  // SAFETY: the file is this repository's own vercel.json, read for the two entries checked below.
  const vercel = JSON.parse(
    readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
  ) as {
    functions: Record<string, { maxDuration: number }>;
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(vercel.crons, [{ path: OBSERVATION_TICK_PATH, schedule: "* * * * *" }]);
  assert.equal(
    vercel.functions[`${OBSERVATION_TICK_PATH.slice(1)}.ts`]?.maxDuration,
    OBSERVATION_TICK.MAX_DURATION_SECONDS,
  );
});
