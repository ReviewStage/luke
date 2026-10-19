import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * github-token-wire.ts -- a member's own classic GitHub personal access token, as Settings saves, reads, and removes it.
 *
 * `/api/github/token` holds at most one token for the signed-in member. A
 * token travels once, in the body of the `PUT` that saves it, and never
 * again: every answer is what the token is — the GitHub login it belongs
 * to, a hint of its last four characters, its status, when GitHub says it
 * expires — and never the token itself. A save is checked with GitHub before it is kept, so a token
 * GitHub refuses, one without `repo`, or one of another GitHub user than the
 * member's own is answered as rejected and nothing is written. `DELETE`
 * removes it. Every answer carries the token as it then stands, so the page
 * draws the service's word rather than its own guess.
 */

/** GitHub's page that makes a classic token with the scopes Luke asks for already ticked. */
export const GITHUB_TOKEN_CREATE_URL =
  "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow,read:user&description=Luke";

/** Where a stored token stands. */
export const GITHUB_TOKEN_STATUS = {
  /** GitHub accepted the token at its save, and has refused it at no use since. */
  VERIFIED: "verified",
  /** GitHub refused the token at a use: revoked, expired, or deleted. */
  INVALID: "invalid",
  /** The service cannot decrypt the token it holds, so it is used for nothing until it is replaced. */
  UNREADABLE: "unreadable",
} as const;

export type GitHubTokenStatus = (typeof GITHUB_TOKEN_STATUS)[keyof typeof GITHUB_TOKEN_STATUS];

/** Why a save kept nothing. */
export const GITHUB_TOKEN_REJECTION = {
  /** A fine-grained token (`github_pat_…`), which Luke does not take; nothing was sent to GitHub. */
  FINE_GRAINED: "fine_grained",
  /** GitHub refused the token. */
  INVALID: "invalid",
  /** GitHub accepted the token, but it lacks the `repo` scope. */
  NO_REPO_SCOPE: "no_repo_scope",
  /** The member has no GitHub account linked to Luke to match the token against; nothing was sent to GitHub. */
  NO_GITHUB_ACCOUNT: "no_github_account",
  /** The token belongs to another GitHub user than the one the member linked to Luke. */
  OTHER_USER: "other_user",
  /** GitHub could not be asked, or did not answer; the same token may be tried again. */
  UNREACHABLE: "unreachable",
  /** The member saved too many tokens in too short a time; nothing was sent to GitHub. */
  TOO_MANY_TRIES: "too_many_tries",
} as const;

export type GitHubTokenRejection =
  (typeof GITHUB_TOKEN_REJECTION)[keyof typeof GITHUB_TOKEN_REJECTION];

const GITHUB_TOKEN_BOUNDS = {
  /** A classic token is `ghp_` and 36 characters; a paste this short is no token. */
  MIN_TOKEN_CHARS: 20,
  /** No GitHub token is longer; a paste past it is no token. */
  MAX_TOKEN_CHARS: 255,
} as const;

/** What the member sees of their token: never the token, only what tells it apart. */
export const githubTokenSummarySchema = EffectSchema.Struct({
  /** The GitHub login the token belongs to, as GitHub answered it at the save. */
  login: EffectSchema.String,
  /** The token's prefix and its last four characters, as `ghp_…abcd`. */
  hint: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(GITHUB_TOKEN_STATUS)),
  /** When the status was last set, in epoch milliseconds. */
  statusAt: countedNumber,
  /** When this token was saved, in epoch milliseconds; a replaced token is added anew. */
  addedAt: countedNumber,
  /** When GitHub says the token expires, in epoch milliseconds; null for a token without an expiry. */
  expiresAt: EffectSchema.NullOr(countedNumber),
});

export type GitHubTokenSummary = typeof githubTokenSummarySchema.Type;

/** The member's token (GET, DELETE, and every PUT's answer), null where none is kept, with why a save kept nothing where it did. */
export const githubTokenAnswerSchema = EffectSchema.Struct({
  token: EffectSchema.NullOr(githubTokenSummarySchema),
  rejected: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(GITHUB_TOKEN_REJECTION))),
});

export type GitHubTokenAnswer = typeof githubTokenAnswerSchema.Type;

/** Saving a token (PUT), replacing the one kept. */
export const githubTokenSaveRequestSchema = EffectSchema.Struct({
  token: EffectSchema.Trim.check(
    EffectSchema.isMinLength(GITHUB_TOKEN_BOUNDS.MIN_TOKEN_CHARS),
    EffectSchema.isMaxLength(GITHUB_TOKEN_BOUNDS.MAX_TOKEN_CHARS),
    EffectSchema.isPattern(/^\S+$/u),
  ),
});
