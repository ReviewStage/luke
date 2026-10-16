import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";

/**
 * run-snapshot-wire.ts -- a coding agent's working tree as the Mac takes it to run, and the token it fetches the starting commit with.
 *
 * The Mac asks for one agent (POST, the agent in the path). Where its
 * sandbox is asleep, the service wakes it and answers that it is waking, and
 * the Mac asks again. Where it runs, the answer is the commit the agent's
 * work starts from, which GitHub holds, the agent's branch, and a gzipped
 * binary patch of everything since, uncommitted and untracked files
 * included, with an installation token limited to the repository and to
 * contents read, good until `expiresAt`. A patch past the bound is answered
 * with its size and nothing else. The answer is the host's alone: sent
 * `no-store`, its token read straight into a redacted value, and never
 * crossing the Gateway, a window, a trace, or a disk.
 */

/** The most bytes a gzipped patch may hold, which keeps the answer under a function's response bound in base64. */
export const RUN_SNAPSHOT_BOUNDS = {
  MAX_PATCH_BYTES: 2_500_000,
} as const;

/** A commit's id as Git spells it. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

/** The sandbox was asleep and is waking; ask again in a moment. */
const wakingSchema = EffectSchema.Struct({ waking: EffectSchema.Literal(true) });

/** The patch is past the bound; its gzipped size. */
const tooLargeSchema = EffectSchema.Struct({ tooLarge: EffectSchema.Int });

/** The working tree, and what fetches its base. */
const snapshotSchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  base: EffectSchema.String.check(EffectSchema.isPattern(COMMIT_SHA_PATTERN)),
  branch: EffectSchema.NullOr(EffectSchema.String.check(EffectSchema.isMaxLength(255))),
  /** The gzipped patch, in base64. */
  patch: EffectSchema.String,
  token: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  /** When GitHub stops honouring the token, as GitHub spells the instant. */
  expiresAt: EffectSchema.String,
});

export const runSnapshotAnswerSchema = EffectSchema.Union([
  wakingSchema,
  tooLargeSchema,
  snapshotSchema,
]);

export type RunSnapshotAnswer = typeof runSnapshotAnswerSchema.Type;
