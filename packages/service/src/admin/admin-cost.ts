/**
 * admin-cost.ts -- what the hosted service spends, priced at read time from the usage its own tables keep.
 *
 * Every number here is list price: the tokens a turn recorded, priced at AI
 * Gateway's catalog by the coding agent's own pricer (`usageOfTurns`), and
 * the seconds of voice, dictation, and avatar time the service metered,
 * priced per second at the providers' published list prices below. No turn
 * records whose key paid for it — a coding agent's step on the account's own
 * key keeps the same usage row as one on Luke's — so the totals count every
 * model token whichever key paid, and say so. A model the catalog does not
 * price is never a zero: its tokens are told apart as unpriced, and every
 * dollar figure is the priced part alone.
 *
 * The answer names an account only in its most expensive accounts, by the
 * same user-row fields every admin table names, and carries counts and
 * dollars alone: nothing a turn said, no task, no repository.
 */

import { Clock, Effect } from "effect";
import { usageOfTurns } from "../agents/coder-host/usage.js";
import { DAY_MS } from "../core.js";
import type { OfferedModel } from "../providers/model-catalog.js";
import {
  ADMIN_COST_TOP_ACCOUNTS_LIMIT,
  type AdminCost,
  type AdminCostAccountInfo,
  type AdminCostDay,
  type AdminCostModel,
  COST_SOURCE,
  type CostSource,
  SECONDS_LIST_PRICE,
  SECONDS_PER_MINUTE,
  type SecondsCostSource,
  type TokenCostSource,
} from "./admin-cost-wire.js";
import { lastNDayKeys, sum } from "./admin-metrics.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  adminMetricsScope,
  adminMetricsWindow,
  errorResponse,
  jsonResponse,
} from "./http.js";
import { unavailableSeam } from "./seam.js";

/** One group of turns' summed counts: one UTC day, one account, one source, one model. */
export interface AdminCostTokenRow {
  day: string;
  source: TokenCostSource;
  userId: string;
  /** The catalog id the counts ran on; null for a turn that named none, which nothing prices. */
  model: string | null;
  /** Anthropic refused a fast step, so these ran, and are priced, at the base model's speed. */
  fastRefused: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens: number;
}

/** One account's metered seconds of one kind on one UTC day. */
export interface AdminCostSecondsRow {
  day: string;
  source: SecondsCostSource;
  userId: string;
  seconds: number;
}

/** Pull requests an account's coding agents merged on one UTC day. */
export interface AdminCostMergedRow {
  day: string;
  userId: string;
  merged: number;
}

/** What the queries read, over the window and the one before it. */
export interface AdminCostUsage {
  tokens: readonly AdminCostTokenRow[];
  seconds: readonly AdminCostSecondsRow[];
  merged: readonly AdminCostMergedRow[];
}

/**
 * One group's price: dollars where every token or second of it has one, and
 * nothing where the catalog does not price its model, whose tokens are then
 * told alone.
 */
export interface PricedCostRow {
  day: string;
  source: CostSource;
  userId: string;
  /** The catalog id for tokens, the list price's own name for seconds; null for a turn that named none. */
  model: string | null;
  usd: number | undefined;
  /** Input and output tokens, the cache's share and reasoning counted inside them. */
  tokens: number;
  seconds: number;
}

/** The window's day keys, oldest first, and the same number before them, which the trend compares against. */
interface CostWindowKeys {
  window: string[];
  prior: string[];
}

export function costWindowKeys(now: number, windowDays: AdminMetricsWindow): CostWindowKeys {
  return {
    window: lastNDayKeys(now, windowDays),
    prior: lastNDayKeys(now - windowDays * DAY_MS, windowDays),
  };
}

/** One token group's price by the coding agent's own pricer, which prices a refused fast share at its base model. */
function priceTokenRow(row: AdminCostTokenRow, offered: readonly OfferedModel[]): PricedCostRow {
  const priced = usageOfTurns(
    [
      {
        model: row.model,
        fastRefused: row.fastRefused,
        usage: {
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cachedInputTokens: row.cachedInputTokens,
          reasoningTokens: row.reasoningTokens,
          cacheWriteTokens: row.cacheWriteTokens,
        },
      },
    ],
    offered,
  );
  return {
    day: row.day,
    source: row.source,
    userId: row.userId,
    model: row.model,
    usd: priced?.costUsd,
    tokens: row.inputTokens + row.outputTokens,
    seconds: 0,
  };
}

function priceSecondsRow(row: AdminCostSecondsRow): PricedCostRow {
  const price = SECONDS_LIST_PRICE[row.source];
  return {
    day: row.day,
    source: row.source,
    userId: row.userId,
    model: price.model,
    usd: (row.seconds / SECONDS_PER_MINUTE) * price.usdPerMinute,
    tokens: 0,
    seconds: row.seconds,
  };
}

/**
 * Every group priced: tokens at the catalog as the instance holds it, an
 * empty one where it could not be read, and seconds at their list price.
 * Exported apart from the builder so a per-account read prices the same way.
 */
export function priceCostUsage(
  usage: AdminCostUsage,
  offered: readonly OfferedModel[],
): PricedCostRow[] {
  return [
    ...usage.tokens.map((row) => priceTokenRow(row, offered)),
    ...usage.seconds.map(priceSecondsRow),
  ];
}

/** Each account's priced dollars and unpriced tokens over the days named. */
function spendByAccount(
  priced: readonly PricedCostRow[],
  days: ReadonlySet<string>,
): Map<string, { usd: number; unpricedTokens: number }> {
  const byAccount = new Map<string, { usd: number; unpricedTokens: number }>();
  for (const row of priced) {
    if (!days.has(row.day)) continue;
    const spend = byAccount.get(row.userId) ?? { usd: 0, unpricedTokens: 0 };
    if (row.usd === undefined) spend.unpricedTokens += row.tokens;
    else spend.usd += row.usd;
    byAccount.set(row.userId, spend);
  }
  return byAccount;
}

/**
 * The accounts that spent most in the window, most first, cut at the
 * stated bound; the account id breaks a tie so a refresh keeps the order.
 * The read asks for these accounts' rows by it before the builder names them.
 */
export function topCostAccountIds(
  priced: readonly PricedCostRow[],
  now: number,
  windowDays: AdminMetricsWindow,
): string[] {
  const window = new Set(costWindowKeys(now, windowDays).window);
  return [...spendByAccount(priced, window)]
    .filter(([, spend]) => spend.usd > 0 || spend.unpricedTokens > 0)
    .sort(([leftId, left], [rightId, right]) =>
      right.usd === left.usd ? leftId.localeCompare(rightId) : right.usd - left.usd,
    )
    .slice(0, ADMIN_COST_TOP_ACCOUNTS_LIMIT)
    .map(([id]) => id);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function emptyDay(day: string): AdminCostDay {
  return {
    day,
    [COST_SOURCE.CODING_AGENTS]: 0,
    [COST_SOURCE.LUKE]: 0,
    [COST_SOURCE.VOICE]: 0,
    [COST_SOURCE.DICTATION]: 0,
    [COST_SOURCE.AVATAR]: 0,
  };
}

/** The window's days, oldest first and zero-filled, each source's priced dollars on it. */
function dailySpend(
  priced: readonly PricedCostRow[],
  windowKeys: readonly string[],
): AdminCostDay[] {
  const byDay = new Map(windowKeys.map((day) => [day, emptyDay(day)]));
  for (const row of priced) {
    const day = byDay.get(row.day);
    if (day === undefined || row.usd === undefined) continue;
    day[row.source] += row.usd;
  }
  return [...byDay.values()];
}

/** The window's model tokens by model, the most spent first and the unpriced after them. */
function spendByModel(
  priced: readonly PricedCostRow[],
  days: ReadonlySet<string>,
): AdminCostModel[] {
  const byModel = new Map<string | null, { usd: number; priced: number; unpriced: number }>();
  for (const row of priced) {
    if (!days.has(row.day) || row.tokens === 0) continue;
    const model = byModel.get(row.model) ?? { usd: 0, priced: 0, unpriced: 0 };
    if (row.usd === undefined) model.unpriced += row.tokens;
    else {
      model.usd += row.usd;
      model.priced += row.tokens;
    }
    byModel.set(row.model, model);
  }
  return [...byModel]
    .sort(([, left], [, right]) =>
      right.usd === left.usd ? right.unpriced - left.unpriced : right.usd - left.usd,
    )
    .map(([model, spend]) => ({
      model,
      spendUsd: spend.priced === 0 ? null : spend.usd,
      pricedTokens: spend.priced,
      unpricedTokens: spend.unpriced,
    }));
}

/** Merged pull requests per account over the days named. */
function mergedByAccount(
  merged: readonly AdminCostMergedRow[],
  days: ReadonlySet<string>,
): Map<string, number> {
  const byAccount = new Map<string, number>();
  for (const row of merged) {
    if (!days.has(row.day)) continue;
    byAccount.set(row.userId, (byAccount.get(row.userId) ?? 0) + row.merged);
  }
  return byAccount;
}

function pricedSum(rows: readonly PricedCostRow[], days: ReadonlySet<string>): number {
  return sum(rows.filter((row) => days.has(row.day)).map((row) => row.usd ?? 0));
}

/**
 * Shapes the priced groups into the screen's answer. Every figure is folded
 * from the same zero-filled days the chart draws, so a tile can never
 * disagree with the bars under it, and the prior window is folded the same
 * way from its own days.
 */
export function buildAdminCost(input: {
  priced: readonly PricedCostRow[];
  merged: readonly AdminCostMergedRow[];
  accounts: ReadonlyMap<string, AdminCostAccountInfo>;
  catalogAvailable: boolean;
  now: number;
  windowDays: AdminMetricsWindow;
}): AdminCost {
  const keys = costWindowKeys(input.now, input.windowDays);
  const window = new Set(keys.window);
  const prior = new Set(keys.prior);

  const spendUsd = pricedSum(input.priced, window);
  const accounts = spendByAccount(input.priced, window);
  const accountSpends = [...accounts.values()].filter((spend) => spend.usd > 0);
  const mergedInWindow = mergedByAccount(input.merged, window);
  const mergedPullRequests = sum([...mergedInWindow.values()]);
  const voiceRows = input.priced.filter(
    (row) => window.has(row.day) && row.source === COST_SOURCE.VOICE,
  );

  const topAccounts = topCostAccountIds(input.priced, input.now, input.windowDays).flatMap((id) => {
    const info = input.accounts.get(id);
    const spend = accounts.get(id);
    if (info === undefined || spend === undefined) return [];
    const merged = mergedInWindow.get(id) ?? 0;
    return [
      {
        ...info,
        spendUsd: spend.usd,
        unpricedTokens: spend.unpricedTokens,
        mergedPullRequests: merged,
        spendPerMergedPullRequestUsd: merged === 0 ? null : spend.usd / merged,
      },
    ];
  });

  return {
    generatedAt: input.now,
    windowDays: input.windowDays,
    catalogAvailable: input.catalogAvailable,
    totals: {
      spendUsd,
      trend: {
        days: input.windowDays,
        recent: spendUsd,
        prior: pricedSum(input.priced, prior),
      },
      unpricedTokens: sum([...accounts.values()].map((spend) => spend.unpricedTokens)),
    },
    perAccount: {
      accounts: accountSpends.length,
      meanUsd: accountSpends.length === 0 ? null : spendUsd / accountSpends.length,
      medianUsd: median(accountSpends.map((spend) => spend.usd)),
    },
    perMergedPullRequest: {
      mergedPullRequests,
      spendUsd: mergedPullRequests === 0 ? null : spendUsd / mergedPullRequests,
    },
    voice: {
      minutes: sum(voiceRows.map((row) => row.seconds)) / SECONDS_PER_MINUTE,
      spendUsd: sum(voiceRows.map((row) => row.usd ?? 0)),
    },
    daily: dailySpend(input.priced, keys.window),
    byModel: spendByModel(input.priced, window),
    topAccounts,
    prices: SECONDS_LIST_PRICE,
  };
}

export interface AdminCostOptions<R> {
  request: Request;
  readCost: (
    now: number,
    scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ) => Effect.Effect<AdminCost, unknown, R>;
}

/**
 * Answers the cost read behind the dashboard's gate: a window outside the
 * fixed set is a 400 before any seam is touched, and a seam that fails is
 * the same 503 every admin read answers.
 */
export function handleAdminCost<R>(
  options: AdminCostOptions<R>,
): Effect.Effect<Response, never, R> {
  const { request } = options;

  const windowDays = adminMetricsWindow(request.url);
  if (windowDays === undefined) {
    return Effect.succeed(errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_WINDOW));
  }

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options.readCost(now, adminMetricsScope(request.url), windowDays).pipe(
      Effect.map((cost) => jsonResponse(ADMIN_HTTP_STATUS.OK, cost)),
      Effect.catchCause((cause) => unavailableSeam("admin cost read failed", cause)),
    ),
  );
}
