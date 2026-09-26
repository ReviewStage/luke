import { Schema as EffectSchema } from "effect";
import { PLAN_BOUNDS } from "./plan-wire.js";

/**
 * github-wire.ts -- what the planning window reads of the account's GitHub connection: the repositories it can read, and why a GitHub read failed.
 *
 * The connection's token never travels here: the service holds it, reads
 * GitHub under it, and answers only repository names and the reason a read
 * could not be made. A failure is one of a fixed set of reasons, so the
 * window can say what to do about it (connect GitHub, reconnect it, pick
 * another repository, try again) without reading GitHub's own words.
 */

/** Why a read of GitHub under the account's connection answered nothing. */
export const GITHUB_FAILURE = {
  /** The account holds no GitHub connection. */
  NOT_CONNECTED: "not-connected",
  /** GitHub refused the connection's credential: revoked, expired, or uninstalled. */
  ACCESS_DENIED: "access-denied",
  /** The repository, or the path in it, does not exist or the connection cannot read it. */
  NOT_FOUND: "not-found",
  /** The repository has no commit on its default branch to plan against. */
  EMPTY_REPOSITORY: "empty-repository",
  /** GitHub is rate limiting the connection; nothing was read. */
  RATE_LIMITED: "rate-limited",
  /** GitHub or the network failed, or answered in a shape the service does not read. */
  FAILED: "failed",
} as const;

export type GitHubFailure = (typeof GITHUB_FAILURE)[keyof typeof GITHUB_FAILURE];

/** The error slug every GitHub failure answers under, beside its reason. */
export const GITHUB_UNAVAILABLE_ERROR = "github-unavailable";

export const githubFailureAnswerSchema = EffectSchema.Struct({
  error: EffectSchema.Literal(GITHUB_UNAVAILABLE_ERROR),
  reason: EffectSchema.Literals(Object.values(GITHUB_FAILURE)),
});

export type GitHubFailureAnswer = typeof githubFailureAnswerSchema.Type;

/** One repository the connection can read. */
export const githubRepositorySchema = EffectSchema.Struct({
  owner: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_REPOSITORY_OWNER_CHARS),
  ),
  name: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(PLAN_BOUNDS.MAX_REPOSITORY_NAME_CHARS),
  ),
  private: EffectSchema.Boolean,
});

export type GitHubRepository = typeof githubRepositorySchema.Type;

/**
 * The repository list (GET), most recently pushed first. `truncated` says
 * the connection can read more repositories than the list carries, so a
 * picker that did not find one knows the list was not the whole of them.
 */
export const githubRepositoryListAnswerSchema = EffectSchema.Struct({
  repositories: EffectSchema.Array(githubRepositorySchema),
  truncated: EffectSchema.Boolean,
});

export type GitHubRepositoryListAnswer = typeof githubRepositoryListAnswerSchema.Type;
