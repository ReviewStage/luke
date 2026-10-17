import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * repository-reach-wire.ts -- why a task's repository is out of the workspace's reach, as a refusal carries it.
 *
 * A task's repository is reached through the one GitHub App installation
 * connected to the task's workspace, and a `repository-not-reachable`
 * refusal says which part of that failed, so the desktop can say so and
 * offer the one thing that mends it rather than a Retry that cannot: no
 * installation connected, one GitHub no longer runs, one on another account
 * than the repository's owner, one on the owner that was never given the
 * repository, one that sees all of the owner's repositories and still not
 * this one, or the owner's installation connected to another workspace the
 * account is in. The reason travels beside the refusal's `error`, so a
 * build that reads `error` alone reads the refusal as it always did.
 */

/** Why the workspace's GitHub installation does not reach the repository. */
export const REPOSITORY_UNREACHED = {
  /** The workspace has no GitHub installation connected. */
  NOT_CONNECTED: "not-connected",
  /** The workspace's installation was uninstalled or suspended on GitHub. */
  CONNECTION_LAPSED: "connection-lapsed",
  /** The workspace's installation is on another GitHub account than the repository's owner. */
  OTHER_OWNER: "other-owner",
  /** The installation is on the owner but was not given the repository. */
  NOT_SELECTED: "not-selected",
  /** The installation sees every repository of the owner and not this one: renamed, transferred, or deleted. */
  GONE: "gone",
  /** The owner's installation is connected to another workspace the account is in, which the task can move to. */
  OTHER_WORKSPACE: "other-workspace",
} as const;

/** Where GitHub's installation settings may live: GitHub's own site and nothing else, so an answer cannot send the desktop elsewhere. */
const GITHUB_SETTINGS_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9/_.-]+$/u;

/** A workspace as the reason names it: its id, for the move, and its name, for the sentence. */
const reachingWorkspaceSchema = EffectSchema.Struct({
  id: workspaceIdSchema,
  name: EffectSchema.String,
});

const unreachedBare = (
  reason:
    | typeof REPOSITORY_UNREACHED.NOT_CONNECTED
    | typeof REPOSITORY_UNREACHED.CONNECTION_LAPSED
    | typeof REPOSITORY_UNREACHED.GONE,
) =>
  EffectSchema.Struct({
    reason: EffectSchema.Literal(reason),
    repository: githubRepositoryFullNameSchema,
  });

/** One reason, with the repository as the task names it and what that reason's remedy needs. */
export const repositoryUnreachedSchema = EffectSchema.Union([
  unreachedBare(REPOSITORY_UNREACHED.NOT_CONNECTED),
  unreachedBare(REPOSITORY_UNREACHED.CONNECTION_LAPSED),
  unreachedBare(REPOSITORY_UNREACHED.GONE),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.OTHER_OWNER),
    repository: githubRepositoryFullNameSchema,
    /** The GitHub account the workspace's installation is on; absent for an enterprise's, which has none. */
    connectedTo: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.NOT_SELECTED),
    repository: githubRepositoryFullNameSchema,
    /** The installation's settings page on GitHub, where its repositories are chosen. */
    settingsUrl: EffectSchema.String.check(EffectSchema.isPattern(GITHUB_SETTINGS_URL_PATTERN)),
  }),
  EffectSchema.Struct({
    reason: EffectSchema.Literal(REPOSITORY_UNREACHED.OTHER_WORKSPACE),
    repository: githubRepositoryFullNameSchema,
    workspace: reachingWorkspaceSchema,
  }),
]);

export type RepositoryUnreached = typeof repositoryUnreachedSchema.Type;

/**
 * A `repository-not-reachable` refusal with its reason. A service from
 * before the reasons answers none, and a reader that cannot read the
 * reason, a newer one among them, reads the refusal as one with none.
 */
export const repositoryNotReachableSchema = EffectSchema.Struct({
  error: EffectSchema.Literal(HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
  unreached: repositoryUnreachedSchema,
});
