/**
 * admin-cost-wire.ts -- the Cost screen's answer as both sides of the read speak it.
 *
 * The page imports this module and no other of the cost read's, so the
 * vocabulary it draws with carries none of the pricer's or the queries'
 * imports into the browser's bundle.
 */

import type { AdminTrend } from "./admin-answer-wire.js";

/** Where a dollar went: the two kinds of model turns, and dictation's metered seconds. */
export const COST_SOURCE = {
  /** A coding agent's turns and its workers'. */
  AGENTS: "agents",
  /** Luke's own turns: every other conversation kind, the brain and its workers. */
  LUKE: "luke",
  DICTATION: "dictation",
} as const;

export type CostSource = (typeof COST_SOURCE)[keyof typeof COST_SOURCE];

export type TokenCostSource = typeof COST_SOURCE.AGENTS | typeof COST_SOURCE.LUKE;

export type SecondsCostSource = typeof COST_SOURCE.DICTATION;

/**
 * The list price of each metered second, per minute as the provider
 * publishes it, read on 2026-10-19. No table or module of the repository
 * held it before, and it is not in AI Gateway's catalog.
 *
 * - Dictation: OpenAI's `gpt-transcribe`, $0.0045 per minute of audio,
 *   https://developers.openai.com/api/docs/models/gpt-transcribe
 */
export const SECONDS_LIST_PRICE = {
  [COST_SOURCE.DICTATION]: { model: "gpt-transcribe", usdPerMinute: 0.0045 },
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
  [COST_SOURCE.AGENTS]: number;
  [COST_SOURCE.LUKE]: number;
  [COST_SOURCE.DICTATION]: number;
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
  daily: AdminCostDay[];
  byModel: AdminCostModel[];
  topAccounts: AdminCostAccount[];
  prices: typeof SECONDS_LIST_PRICE;
}
