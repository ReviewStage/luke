import type { AdminTrend } from "./admin-answer-wire.js";

export const COST_SOURCE = {
  AGENTS: "agents",
  APP: "app",
  DICTATION: "dictation",
} as const;

export type CostSource = (typeof COST_SOURCE)[keyof typeof COST_SOURCE];

export type TokenCostSource = typeof COST_SOURCE.AGENTS | typeof COST_SOURCE.APP;

export type SecondsCostSource = typeof COST_SOURCE.DICTATION;

export const SECONDS_LIST_PRICE = {
  [COST_SOURCE.DICTATION]: { model: "gpt-transcribe", usdPerMinute: 0.0045 },
} as const;

export const SECONDS_PER_MINUTE = 60;

export const ADMIN_COST_TOP_ACCOUNTS_LIMIT = 10;

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
  spendPerMergedPullRequestUsd: number | null;
}

export interface AdminCostDay {
  day: string;
  [COST_SOURCE.AGENTS]: number;
  [COST_SOURCE.APP]: number;
  [COST_SOURCE.DICTATION]: number;
}

export interface AdminCostModel {
  model: string | null;
  spendUsd: number | null;
  pricedTokens: number;
  unpricedTokens: number;
}

export interface AdminCost {
  generatedAt: number;
  windowDays: number;
  catalogAvailable: boolean;
  totals: {
    spendUsd: number;
    trend: AdminTrend;
    unpricedTokens: number;
  };
  perAccount: {
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
