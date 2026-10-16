import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * pr-fetch-wire.ts -- what the Mac asks the service before it checks a pull request out to run it, and what it is answered with.
 *
 * The Mac names the workspace, the repository, and the pull request's
 * number; the service reads the pull request by number on GitHub at that
 * moment and answers its head commit with an installation token limited to
 * that one repository and to contents read, good until `expiresAt`. The
 * answer is the host's alone: it is sent `no-store`, read straight into a
 * redacted value by `pr-fetch-client.ts`, and never crosses the Gateway, a
 * window, a trace, or a disk. The token the service read the pull request
 * on stays on the service.
 */

/** GitHub's own bound on a pull request's number is far past this; a number past it is no pull request. */
const MAX_PULL_REQUEST_NUMBER = 2_147_483_647;

/** A commit's id as Git spells it: forty lowercase hexadecimal digits. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export const pullRequestNumberSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
  EffectSchema.isLessThanOrEqualTo(MAX_PULL_REQUEST_NUMBER),
);

export const commitShaSchema = EffectSchema.String.check(
  EffectSchema.isPattern(COMMIT_SHA_PATTERN),
);

/** The pull request asked for (POST): the workspace whose installation reaches it, its repository, and its number. */
export const prFetchRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  prNumber: pullRequestNumberSchema,
});

export type PrFetchRequest = typeof prFetchRequestSchema.Type;

/** The service's answer: the pull request's head as GitHub holds it now, and a contents-read token for its repository alone. */
export const prFetchAnswerSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  prNumber: pullRequestNumberSchema,
  headSha: commitShaSchema,
  /** The pull request's head branch, as named on its own repository, which a fork's may share with the base's. */
  headRef: EffectSchema.String.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(255)),
  token: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  /** When GitHub stops honouring the token, as GitHub spells the instant. */
  expiresAt: EffectSchema.String,
});

export type PrFetchAnswer = typeof prFetchAnswerSchema.Type;
