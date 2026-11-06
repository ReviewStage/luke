import { Schema as EffectSchema } from "effect";
import { PRODUCT_NAME } from "./product-name.js";
import { countedNumber } from "./service-wire.js";

export const GITHUB_TOKEN_STATUS = {
  VERIFIED: "verified",
  INVALID: "invalid",
  UNREADABLE: "unreadable",
} as const;

export type GitHubTokenStatus = (typeof GITHUB_TOKEN_STATUS)[keyof typeof GITHUB_TOKEN_STATUS];

export const GITHUB_TOKEN_CREATE_URL = `https://github.com/settings/tokens/new?scopes=repo,read:org,workflow,read:user&description=${PRODUCT_NAME}`;

export const GITHUB_TOKEN_REJECTION = {
  FINE_GRAINED: "fine_grained",
  INVALID: "invalid",
  NO_REPO_SCOPE: "no_repo_scope",
  UNREACHABLE: "unreachable",
  TOO_MANY_TRIES: "too_many_tries",
} as const;

export type GitHubTokenRejection =
  (typeof GITHUB_TOKEN_REJECTION)[keyof typeof GITHUB_TOKEN_REJECTION];

const GITHUB_TOKEN_BOUNDS = {
  MIN_TOKEN_CHARS: 20,
  MAX_TOKEN_CHARS: 255,
} as const;

const githubTokenSummarySchema = EffectSchema.Struct({
  login: EffectSchema.String,
  hint: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(GITHUB_TOKEN_STATUS)),
  statusAt: countedNumber,
  addedAt: countedNumber,
  expiresAt: EffectSchema.NullOr(countedNumber),
});

export type GitHubTokenSummary = typeof githubTokenSummarySchema.Type;

export const githubTokenAnswerSchema = EffectSchema.Struct({
  token: EffectSchema.NullOr(githubTokenSummarySchema),
  rejected: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(GITHUB_TOKEN_REJECTION))),
});

export type GitHubTokenAnswer = typeof githubTokenAnswerSchema.Type;

export const githubTokenSaveRequestSchema = EffectSchema.Struct({
  token: EffectSchema.Trim.check(
    EffectSchema.isMinLength(GITHUB_TOKEN_BOUNDS.MIN_TOKEN_CHARS),
    EffectSchema.isMaxLength(GITHUB_TOKEN_BOUNDS.MAX_TOKEN_CHARS),
    EffectSchema.isPattern(/^\S+$/u),
  ),
});
