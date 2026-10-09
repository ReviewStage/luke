import { Schema as EffectSchema } from "effect";
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
 * is the one form a plan stores and a coding agent checks out.
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

/** The repositories (GET): every one the App reaches for the developer, most recently updated first. */
export const githubRepositoriesAnswerSchema = EffectSchema.Struct({
  /** Whether the developer reaches any installation of the App at all; false is "Install Luke on GitHub". */
  installed: EffectSchema.Boolean,
  repositories: EffectSchema.Array(githubRepositorySchema),
  /** Where to send the developer to install the App, or to change which repositories it reaches. */
  installationUrl: EffectSchema.String,
});

export type GitHubRepositoriesAnswer = typeof githubRepositoriesAnswerSchema.Type;
