import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { workspaceIdSchema } from "./plan-wire.js";

/**
 * repository-run-wire.ts -- how a workspace's repositories are set up and run on a Mac, shared by every member.
 *
 * Each repository of a workspace may carry a setup command, which prepares a
 * fresh checkout (`pnpm install`), and a run command, which starts the app
 * (`pnpm dev`). Run on this Mac runs them from the root of Luke's own
 * checkout of a pull request. They are the workspace's: any member reads
 * and sets them, and a pull request never supplies them. A repository is
 * named by its full name, which the service keeps lowercased, since GitHub
 * reads names without case.
 */

export const REPOSITORY_RUN_BOUNDS = {
  /** The most characters either command holds. */
  MAX_COMMAND_CHARS: 4_096,
} as const;

/** The query naming the workspace whose commands are read. */
export const REPOSITORY_RUNS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

const command = EffectSchema.NullOr(
  EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(REPOSITORY_RUN_BOUNDS.MAX_COMMAND_CHARS),
  ),
);

/** One repository's commands; null where none is set. */
const repositoryRunSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  setupCommand: command,
  runCommand: command,
});

export type RepositoryRun = typeof repositoryRunSchema.Type;

/** The workspace's repositories with commands set (GET). */
export const repositoryRunsAnswerSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(repositoryRunSchema),
});

export type RepositoryRunsAnswer = typeof repositoryRunsAnswerSchema.Type;

/** One repository's commands set, or both cleared with null (PUT); answered with the workspace's commands as they then stand. */
export const repositoryRunSetRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  ...repositoryRunSchema.fields,
});

export type RepositoryRunSetRequest = typeof repositoryRunSetRequestSchema.Type;
