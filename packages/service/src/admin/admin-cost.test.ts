import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { test } from "vitest";
import type { OfferedModel } from "../providers/model-catalog.js";
import {
  type AdminCostTokenRow,
  type AdminCostUsage,
  buildAdminCost,
  handleAdminCost,
  priceCostUsage,
} from "./admin-cost.js";
import {
  ADMIN_COST_TOP_ACCOUNTS_LIMIT,
  type AdminCostAccountInfo,
  COST_SOURCE,
} from "./admin-cost-wire.js";
import { ADMIN_ERROR, ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * admin-cost.test.ts -- the Cost screen's pricing and shaping: tokens are
 * priced at the catalog by the coding agent's own pricer, a refused fast
 * share at its base model, a model the catalog does not price is told as
 * unpriced tokens and never as dollars, seconds at their list price, and
 * every figure is folded from the same zero-filled days the chart draws.
 *
 * Synthetic models, prices, and accounts throughout.
 */

/** Noon on the window's last day. */
const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = "2026-10-17";
const YESTERDAY = "2026-10-16";
/** Inside the 7-day window before this one. */
const LAST_WEEK = "2026-10-08";
/** Before even that. */
const LONG_AGO = "2026-09-01";

const WEEK = ADMIN_METRICS_WINDOW.WEEK;

const MODEL = {
  BASE: "anthropic/model-test",
  FAST: "anthropic/model-test-fast",
  UNLISTED: "openai/unlisted-test",
  CHEAP: "openai/cheap-test",
} as const;

/** A dollar per million input tokens and two per million output, the fast version twice that. */
const OFFERED: readonly OfferedModel[] = [
  {
    id: MODEL.BASE,
    name: "Base",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000_001, outputUsd: 0.000_002 },
  },
  {
    id: MODEL.FAST,
    name: "Fast",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000_002, outputUsd: 0.000_004 },
  },
  {
    id: MODEL.CHEAP,
    name: "Cheap",
    provider: "openai",
    efforts: ["low"],
    pricing: { inputUsd: 0.000_000_4, outputUsd: 0.000_001 },
  },
];

const MILLION = 1_000_000;

function tokens(
  row: Pick<AdminCostTokenRow, "day" | "userId" | "model"> &
    Partial<Omit<AdminCostTokenRow, "day" | "userId" | "model">>,
): AdminCostTokenRow {
  return {
    source: COST_SOURCE.LUKE,
    fastRefused: false,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    cacheWriteTokens: 0,
    ...row,
  };
}

function account(id: string): AdminCostAccountInfo {
  return { id, name: id, email: `${id}@luke.test`, image: null, admin: false };
}

function built(usage: Partial<AdminCostUsage>, accounts: readonly string[] = []) {
  const whole: AdminCostUsage = { tokens: [], seconds: [], merged: [], ...usage };
  return buildAdminCost({
    priced: priceCostUsage(whole, OFFERED),
    merged: whole.merged,
    accounts: new Map(accounts.map((id) => [id, account(id)])),
    catalogAvailable: true,
    now: NOW,
    windowDays: WEEK,
  });
}

test("a refused fast share is priced at its base model, and an unlisted model's tokens stay unpriced", () => {
  const cost = built({
    tokens: [
      tokens({ day: TODAY, userId: "a", model: MODEL.FAST, inputTokens: MILLION }),
      tokens({
        day: TODAY,
        userId: "a",
        model: MODEL.FAST,
        inputTokens: MILLION,
        fastRefused: true,
      }),
      tokens({
        day: TODAY,
        userId: "a",
        model: MODEL.UNLISTED,
        inputTokens: 300,
        outputTokens: 200,
      }),
    ],
  });

  // Two dollars at the fast price, one at the base price the refused share ran at.
  assert.equal(cost.totals.spendUsd, 3);
  assert.equal(cost.totals.unpricedTokens, 500);
  assert.deepEqual(cost.byModel, [
    { model: MODEL.FAST, spendUsd: 3, pricedTokens: 2 * MILLION, unpricedTokens: 0 },
    { model: MODEL.UNLISTED, spendUsd: null, pricedTokens: 0, unpricedTokens: 500 },
  ]);
});

test("a catalog that could not be read leaves every model token unpriced, and seconds still priced", () => {
  const usage: AdminCostUsage = {
    tokens: [tokens({ day: TODAY, userId: "a", model: MODEL.BASE, inputTokens: MILLION })],
    seconds: [{ day: TODAY, source: COST_SOURCE.VOICE, userId: "a", model: null, seconds: 120 }],
    merged: [],
  };
  const cost = buildAdminCost({
    priced: priceCostUsage(usage, []),
    merged: [],
    accounts: new Map(),
    catalogAvailable: false,
    now: NOW,
    windowDays: WEEK,
  });

  assert.equal(cost.catalogAvailable, false);
  assert.equal(cost.totals.unpricedTokens, MILLION);
  // Two minutes of gpt-live-1 at five cents a minute.
  assert.equal(cost.totals.spendUsd, 0.1);
  assert.deepEqual(cost.voice, { minutes: 2, spendUsd: 0.1, unpricedMinutes: 0 });
});

test("a voice session on a Live model the list prices do not name stays unpriced", () => {
  const cost = built({
    seconds: [
      { day: TODAY, source: COST_SOURCE.VOICE, userId: "a", model: "gpt-live-1", seconds: 60 },
      { day: TODAY, source: COST_SOURCE.VOICE, userId: "a", model: "gpt-live-next", seconds: 120 },
    ],
  });

  assert.deepEqual(cost.voice, { minutes: 3, spendUsd: 0.05, unpricedMinutes: 2 });
  assert.equal(cost.totals.spendUsd, 0.05);
});

test("many groups too small to round to a millionth of a dollar still add up", () => {
  const cost = built({
    tokens: Array.from({ length: 1_000 }, (_, index) =>
      tokens({ day: TODAY, userId: `user-${index}`, model: MODEL.CHEAP, inputTokens: 1 }),
    ),
  });

  // A thousand single tokens at forty cents per million, each under a millionth of a dollar.
  assert.equal(cost.totals.spendUsd.toFixed(6), "0.000400");
});

test("the days are zero-filled and stacked by source, and the totals are folded from them", () => {
  const cost = built({
    tokens: [
      tokens({
        day: TODAY,
        userId: "a",
        model: MODEL.BASE,
        source: COST_SOURCE.CODING_AGENTS,
        inputTokens: MILLION,
      }),
      tokens({ day: YESTERDAY, userId: "a", model: MODEL.BASE, outputTokens: MILLION }),
      tokens({ day: LAST_WEEK, userId: "a", model: MODEL.BASE, inputTokens: 4 * MILLION }),
      tokens({ day: LONG_AGO, userId: "a", model: MODEL.BASE, inputTokens: 100 * MILLION }),
    ],
    seconds: [
      { day: TODAY, source: COST_SOURCE.DICTATION, userId: "a", model: null, seconds: 600 },
      { day: TODAY, source: COST_SOURCE.AVATAR, userId: "a", model: null, seconds: 300 },
    ],
  });

  assert.equal(cost.daily.length, WEEK);
  assert.equal(cost.daily.at(-1)?.day, TODAY);
  assert.deepEqual(cost.daily.at(-1), {
    day: TODAY,
    [COST_SOURCE.CODING_AGENTS]: 1,
    [COST_SOURCE.LUKE]: 0,
    [COST_SOURCE.VOICE]: 0,
    [COST_SOURCE.DICTATION]: 0.045,
    [COST_SOURCE.AVATAR]: 0.3,
  });
  assert.equal(cost.daily.at(-2)?.[COST_SOURCE.LUKE], 2);
  assert.ok(cost.daily.slice(0, -2).every((day) => day[COST_SOURCE.LUKE] === 0));
  assert.equal(cost.totals.spendUsd.toFixed(3), "3.345");
  // The prior window holds last week's day and not the one before it.
  assert.deepEqual(cost.totals.trend, { days: WEEK, recent: cost.totals.spendUsd, prior: 4 });
});

test("spend per account and per merged pull request read the window's own accounts and merges", () => {
  const cost = built({
    tokens: [
      tokens({ day: TODAY, userId: "a", model: MODEL.BASE, inputTokens: MILLION }),
      tokens({ day: TODAY, userId: "b", model: MODEL.BASE, inputTokens: 2 * MILLION }),
      tokens({ day: TODAY, userId: "c", model: MODEL.BASE, inputTokens: 9 * MILLION }),
      // Only unpriced tokens: an account with no dollars to take a mean of.
      tokens({ day: TODAY, userId: "d", model: MODEL.UNLISTED, inputTokens: 5 }),
    ],
    merged: [
      { day: TODAY, userId: "a", merged: 2 },
      { day: YESTERDAY, userId: "c", merged: 1 },
      { day: LAST_WEEK, userId: "c", merged: 7 },
    ],
  });

  assert.deepEqual(cost.perAccount, { accounts: 3, meanUsd: 4, medianUsd: 2 });
  assert.deepEqual(cost.perMergedPullRequest, { mergedPullRequests: 3, spendUsd: 4 });
});

test("no spend at all says so, rather than a mean or a per-PR figure of nothing", () => {
  const cost = built({});

  assert.deepEqual(cost.perAccount, { accounts: 0, meanUsd: null, medianUsd: null });
  assert.deepEqual(cost.perMergedPullRequest, { mergedPullRequests: 0, spendUsd: null });
  assert.deepEqual(cost.topAccounts, []);
});

test("the most expensive accounts come most first, cut at the bound, each with its merges", () => {
  const ids = Array.from(
    { length: ADMIN_COST_TOP_ACCOUNTS_LIMIT + 2 },
    (_, index) => `user-${index}`,
  );
  const cost = built(
    {
      tokens: ids.map((userId, index) =>
        tokens({ day: TODAY, userId, model: MODEL.BASE, inputTokens: (index + 1) * MILLION }),
      ),
      merged: [{ day: TODAY, userId: "user-11", merged: 4 }],
    },
    ids,
  );

  assert.equal(cost.topAccounts.length, ADMIN_COST_TOP_ACCOUNTS_LIMIT);
  assert.deepEqual(
    cost.topAccounts.slice(0, 2).map((row) => [row.id, row.spendUsd, row.mergedPullRequests]),
    [
      ["user-11", 12, 4],
      ["user-10", 11, 0],
    ],
  );
  assert.equal(cost.topAccounts[0]?.spendPerMergedPullRequestUsd, 3);
  assert.equal(cost.topAccounts[1]?.spendPerMergedPullRequestUsd, null);
});

it.effect("a window outside the set is refused before the read, and a failed read is a 503", () =>
  Effect.gen(function* () {
    const reads: string[] = [];
    const answer = (url: string, fail: boolean) =>
      handleAdminCost({
        request: new Request(url),
        readCost: (_now, scope, windowDays) => {
          reads.push(`${scope}:${windowDays}`);
          return fail ? Effect.fail(new Error("the database is down")) : Effect.succeed(built({}));
        },
      });

    const invalid = yield* answer("https://luke.test/api/admin/cost?window=12", false);
    assert.equal(invalid.status, 400);
    assert.equal((yield* Effect.promise(() => invalid.json())).error, ADMIN_ERROR.INVALID_WINDOW);
    assert.deepEqual(reads, []);

    const read = yield* answer("https://luke.test/api/admin/cost?window=7&scope=all", false);
    assert.equal(read.status, 200);
    assert.deepEqual(reads, ["all:7"]);

    const outage = yield* answer("https://luke.test/api/admin/cost", true);
    assert.equal(outage.status, 503);
    assert.equal((yield* Effect.promise(() => outage.json())).error, ADMIN_ERROR.UNAVAILABLE);
  }),
);
