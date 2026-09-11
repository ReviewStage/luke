import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { FUNCTION_MAX_DURATION_SECONDS } from "../server/function-durations";
import { APNS_REQUEST_TIMEOUT_MS } from "../server/hosted/apns";
import type { TurnOpeningOutcome } from "../server/hosted/brain-host/opener";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { OBSERVATION_TICK, OBSERVATION_TICK_PATH } from "../server/hosted/observation-bounds";
import {
  type AccountPassOutcome,
  handleObservationTick,
  type ObservationTickOptions,
} from "../server/hosted/observation-tick";
import { SPEECH_PUSH, type SpeechPushOutcome } from "../server/hosted/speech-push";
import type { SpeechSweepOutcome } from "../server/hosted/store";

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
/** What one account's opening answers unless a test says otherwise: nothing pending, nothing opened. */
const NOTHING_OPENED: TurnOpeningOutcome = { observation: 0, failed: 0 };

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
  outcome: (userId: string) => Promise<AccountPassOutcome> = async () => ({
    complete: true,
    changed: false,
  }),
  opening: (userId: string) => Promise<TurnOpeningOutcome> = async () => NOTHING_OPENED,
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
    listAccounts: async (limit, seenAfter) => {
      recorded.listed.push({ limit, seenAfter });
      return accounts.map((userId) => ({ userId }));
    },
    forgetIneligible: async (seenAfter) => {
      recorded.forgot.push(seenAfter);
    },
    purgeCleared: async (now) => {
      recorded.purged.push(now);
      return 2;
    },
    sweepSpeech: async (now) => {
      recorded.swept.push(now);
      return SWEPT;
    },
    pushSpeech: async (now) => {
      recorded.pushed.push(now);
      return PUSHED;
    },
    observe: async (userId) => {
      recorded.observed.push(userId);
      recorded.ran.push(`observe:${userId}`);
      return outcome(userId);
    },
    openTurns: async (userId) => {
      recorded.ran.push(`open:${userId}`);
      return opening(userId);
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
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
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
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    turns: NOTHING_OPENED,
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
  assert.equal(body.purged, 2);
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
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    turns: { observation: 0, failed: 1 },
  });
});

test("each account's opening runs after its own pass, inside the same share of the tick, and its counts are summed; a pass that throws is still followed by its opening", async () => {
  const openings = new Map<string, TurnOpeningOutcome>([
    ["user-a", { observation: 2, failed: 0 }],
    ["user-b", { observation: 1, failed: 1 }],
  ]);
  const { options, recorded } = tickOptions(
    {},
    ["user-a", "user-b"],
    async (userId) => {
      if (userId === "user-a") throw new Error("the adapter had a bug");
      return { complete: true, changed: true };
    },
    async (userId) => {
      const opened = openings.get(userId);
      assert.ok(opened);
      return opened;
    },
  );

  const response = await handleObservationTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 1,
    failed: 1,
    changed: 1,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    turns: { observation: 3, failed: 1 },
  });
  assert.deepEqual(recorded.ran, [
    "observe:user-a",
    "observe:user-b",
    "open:user-a",
    "open:user-b",
  ]);
});

test("an opening that throws is one failed opening and nothing else of the tick is lost", async () => {
  const { options } = tickOptions(
    {},
    ["user-a", "user-b"],
    async () => ({ complete: true, changed: false }),
    async (userId) => {
      if (userId === "user-a") throw new Error("eve went away");
      return { observation: 1, failed: 0 };
    },
  );

  const response = await handleObservationTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 2,
    observed: 2,
    failed: 0,
    changed: 0,
    exhausted: false,
    purged: 2,
    speech: SWEPT,
    push: PUSHED,
    turns: { observation: 1, failed: 1 },
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
