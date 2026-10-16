import { Schema as EffectSchema } from "effect";
import { PULL_REQUEST_STATE } from "./coding-agent-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * github-repositories-wire.ts -- the repositories a signed-in developer reaches through the Luke GitHub App, as the desktop reads them.
 *
 * The service reads them from GitHub on the developer's own token the moment
 * they are asked for, and stores none of them: what travels is each
 * repository's names, its default branch, whether it is private, and when
 * GitHub last saw it change, with whether the developer has installed the
 * App anywhere at all and where to send them to install it. A repository is
 * named everywhere by its full name, `owner/name` as GitHub spells it, which
 * is the one form a plan stores and a coding agent checks out. One pull
 * request of such a repository is read the same way, by its number, and
 * travels as no more than a link to it draws: its number, title, page, and
 * where it stands.
 */

const GITHUB_REPOSITORY_BOUNDS = {
  /** GitHub's own bound on an owner's login. */
  MAX_OWNER_CHARS: 39,
  /** GitHub's own bound on a repository's name. */
  MAX_NAME_CHARS: 100,
} as const;

/**
 * `owner/name`: a login, which GitHub spells in letters, digits, and single
 * hyphens between them, one slash, and a name in letters, digits, dots,
 * underscores, and hyphens, which GitHub never lets be `.` or `..`. Nothing
 * else, so a path cannot ride in a repository's name.
 */
const FULL_NAME_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u;

/** A repository's full name as the wire takes it: trimmed, and held to GitHub's own shape and bounds. */
export const githubRepositoryFullNameSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(
    GITHUB_REPOSITORY_BOUNDS.MAX_OWNER_CHARS + 1 + GITHUB_REPOSITORY_BOUNDS.MAX_NAME_CHARS,
  ),
  EffectSchema.isPattern(FULL_NAME_PATTERN),
);

/** One repository the App reaches for the developer. */
export const githubRepositorySchema = EffectSchema.Struct({
  /** The user or organization that owns it. */
  owner: EffectSchema.String,
  name: EffectSchema.String,
  /** `owner/name` as GitHub spells it. */
  fullName: githubRepositoryFullNameSchema,
  defaultBranch: EffectSchema.String,
  private: EffectSchema.Boolean,
  /** Epoch milliseconds GitHub last saw the repository change. */
  updatedAt: countedNumber,
});

export type GitHubRepository = typeof githubRepositorySchema.Type;

/**
 * The queries a repositories read names: the workspace a listing is for,
 * since a workspace of a GitHub App installation lists only that
 * installation's repositories; for a read of one repository's tree, skills,
 * or pull request, the repository, `owner/name`; and for the pull request's,
 * its number.
 */
export const GITHUB_REPOSITORIES_QUERY = {
  WORKSPACE_ID: "workspaceId",
  REPOSITORY: "repository",
  NUMBER: "number",
} as const;

/** The repositories (GET): every one the App reaches for the developer, or for the workspace named, most recently updated first. */
export const githubRepositoriesAnswerSchema = EffectSchema.Struct({
  /** Whether the developer reaches any installation of the App at all; false is "Install Luke on GitHub". */
  installed: EffectSchema.Boolean,
  repositories: EffectSchema.Array(githubRepositorySchema),
  /** Where to send the developer to install the App, or to change which repositories it reaches. */
  installationUrl: EffectSchema.String,
});

export type GitHubRepositoriesAnswer = typeof githubRepositoriesAnswerSchema.Type;

/** A pull request's number as the wire takes it: GitHub numbers a repository's issues and pull requests from one. */
export const githubPullRequestNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
);

/**
 * One pull request of a repository as a link to it is drawn: its number,
 * its title, its own page on GitHub, and where it stands, merged before
 * closed and draft before open, as an agent's pill reads it.
 */
export const githubPullRequestSummarySchema = EffectSchema.Struct({
  number: githubPullRequestNumberSchema,
  title: EffectSchema.String,
  /** The pull request's own page on GitHub. */
  url: EffectSchema.String,
  state: EffectSchema.Literals(Object.values(PULL_REQUEST_STATE)),
});

export type GitHubPullRequestSummary = typeof githubPullRequestSummarySchema.Type;

/**
 * One pull request of a repository a workspace's installation reaches
 * (GET), by its number: null where the repository holds none of that
 * number, or where the installation does not reach the repository, which
 * the answer does not tell apart, since a link to either draws the same.
 */
export const githubRepositoryPullRequestAnswerSchema = EffectSchema.Struct({
  pullRequest: EffectSchema.NullOr(githubPullRequestSummarySchema),
});

export type GitHubRepositoryPullRequestAnswer = typeof githubRepositoryPullRequestAnswerSchema.Type;
