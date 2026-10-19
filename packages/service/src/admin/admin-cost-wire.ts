/**
 * admin-cost-wire.ts -- the Cost screen's answer as both sides of the read speak it.
 *
 * The page imports this module and no other of the cost read's, so the
 * vocabulary it draws with carries none of the pricer's or the queries'
 * imports into the browser's bundle.
 */

import type { AdminTrend } from "./admin-metrics.js";

/** Where a dollar went: the two kinds of model turns, and the three kinds of metered seconds. */
export const COST_SOURCE = {
  /** A coding agent's turns and its workers'. */
  CODING_AGENTS: "coding-agents",
  /** Luke's own turns: every other conversation kind, the brain and its workers. */
  LUKE: "luke",
  VOICE: "voice",
  DICTATION: "dictation",
  AVATAR: "avatar",
} as const;

export type CostSource = (typeof COST_SOURCE)[keyof typeof COST_SOURCE];

export type TokenCostSource = typeof COST_SOURCE.CODING_AGENTS | typeof COST_SOURCE.LUKE;

export type SecondsCostSource =
  | typeof COST_SOURCE.VOICE
  | typeof COST_SOURCE.DICTATION
  | typeof COST_SOURCE.AVATAR;

/**
 * The list price of each metered second, per minute as each provider
 * publishes it, read on 2026-10-19. No table or module of the repository
 * held these before, and none of the three is in AI Gateway's catalog.
 *
 * - Voice: OpenAI's `gpt-live-1`, "$0.05 per minute, billed per second",
 *   https://developers.openai.com/api/docs/models/gpt-live-1
 * - Dictation: OpenAI's `gpt-transcribe`, $0.0045 per minute of audio,
 *   https://developers.openai.com/api/docs/models/gpt-transcribe
 * - Avatar: Keyframe's extra minutes, "from $0.06 / min", on any paid plan,
 *   https://keyframelabs.com/pricing. Note that this prices every avatar
 *   minute at the overage rate, because a plan's included minutes and its
 *   monthly fee are a contract term the database does not hold.
 */
export const SECONDS_LIST_PRICE = {
  [COST_SOURCE.VOICE]: { model: "gpt-live-1", usdPerMinute: 0.05 },
  [COST_SOURCE.DICTATION]: { model: "gpt-transcribe", usdPerMinute: 0.0045 },
  [COST_SOURCE.AVATAR]: { model: "Keyframe avatar", usdPerMinute: 0.06 },
} as const;

export const SECONDS_PER_MINUTE = 60;

/** How many of the most expensive accounts the screen names. */
export const ADMIN_COST_TOP_ACCOUNTS_LIMIT = 10;

/** An account the screen names: the user-row fields every admin table names. */
export interface AdminCostAccountInfo {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
}

export interface AdminCostAccount extends AdminCostAccountInfo {
  spendUsd: number;
  unpricedTokens: number;
  mergedPullRequests: number;
  /** Null where the account merged nothing in the window. */
  spendPerMergedPullRequestUsd: number | null;
}

/** One UTC day's priced dollars by source; unpriced tokens are in none of them. */
export interface AdminCostDay {
  day: string;
  [COST_SOURCE.CODING_AGENTS]: number;
  [COST_SOURCE.LUKE]: number;
  [COST_SOURCE.VOICE]: number;
  [COST_SOURCE.DICTATION]: number;
  [COST_SOURCE.AVATAR]: number;
}

export interface AdminCostModel {
  /** The catalog id; null for turns that named no model. */
  model: string | null;
  /** The priced share's dollars; null where the catalog priced none of its tokens. */
  spendUsd: number | null;
  pricedTokens: number;
  /** Tokens the catalog does not price, never counted as dollars. */
  unpricedTokens: number;
}

export interface AdminCost {
  generatedAt: number;
  windowDays: number;
  /** False where the catalog could not be read, so every model token stands unpriced. */
  catalogAvailable: boolean;
  totals: {
    spendUsd: number;
    /** The window before this one, of the same length. */
    trend: AdminTrend;
    unpricedTokens: number;
  };
  perAccount: {
    /** Accounts with priced spend in the window. */
    accounts: number;
    meanUsd: number | null;
    medianUsd: number | null;
  };
  perMergedPullRequest: {
    mergedPullRequests: number;
    spendUsd: number | null;
  };
  voice: {
    minutes: number;
    /** The priced minutes' dollars. */
    spendUsd: number;
    /** Minutes on a Live model the list prices do not name, in no dollar figure. */
    unpricedMinutes: number;
  };
  daily: AdminCostDay[];
  byModel: AdminCostModel[];
  topAccounts: AdminCostAccount[];
  prices: typeof SECONDS_LIST_PRICE;
}
