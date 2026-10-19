import type { DatabaseServices } from "@luke/database/core/query";
import { readGitHubTokenRow, setGitHubTokenStatus } from "@luke/database/models/github-token-store";
import { openGitHubToken, parseKeyRing } from "@luke/database/models/provider-key-seal";
import type { TaskStoreEffect, TaskStoreFailure } from "@luke/database/models/task-store";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { DateTime, Effect, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../environment.js";

/**
 * github-token.ts -- a member's own GitHub personal access token, opened for the one call that needs it.
 *
 * The service-side read every use of a member's token goes through: the
 * token as a `Redacted` where the member keeps one GitHub has not refused,
 * or why there is none to use. A use that GitHub answers 401 marks the
 * token invalid through the read's own `markInvalid`, which names the seal
 * the read opened, so a token the member replaced meanwhile is left as it
 * stands. Read afresh for every use, so a token saved, replaced, or removed
 * in Settings is the one the next use takes.
 */

/** Why a member has no token to use. */
export const GITHUB_TOKEN_ABSENCE = {
  /** The member keeps no token. */
  NONE: "none",
  /** GitHub refused the token at a use since its save. */
  INVALID: "invalid",
  /** The deployment cannot open the token: no ring, or none that opens it. */
  UNREADABLE: "unreadable",
} as const;

export type GitHubTokenAbsence = (typeof GITHUB_TOKEN_ABSENCE)[keyof typeof GITHUB_TOKEN_ABSENCE];

/** A member's token GitHub has not refused, opened, with whose it is and how to mark it refused. */
export interface MemberGitHubToken {
  readonly token: Redacted.Redacted<string>;
  readonly githubUserId: string;
  readonly githubLogin: string;
  /** Marks this token invalid, after GitHub answered a use of it 401. */
  readonly markInvalid: TaskStoreEffect<void>;
}

/** The member's token to use, or why there is none. */
export function memberGitHubToken(
  userId: string,
): Effect.Effect<
  Result.Result<MemberGitHubToken, GitHubTokenAbsence>,
  TaskStoreFailure,
  DatabaseServices | HostedEnvironment
> {
  return Effect.gen(function* () {
    const row = yield* readGitHubTokenRow(userId);
    if (row === undefined) return Result.fail(GITHUB_TOKEN_ABSENCE.NONE);
    if (row.status === GITHUB_TOKEN_STATUS.INVALID)
      return Result.fail(GITHUB_TOKEN_ABSENCE.INVALID);
    const configured = (yield* HostedEnvironment).providerKeyEncryptionKeys;
    const ring = configured === undefined ? undefined : parseKeyRing(configured);
    if (ring === undefined || Result.isFailure(ring)) {
      return Result.fail(GITHUB_TOKEN_ABSENCE.UNREADABLE);
    }
    const opened = openGitHubToken(ring.success, userId, row);
    if (Result.isFailure(opened)) return Result.fail(GITHUB_TOKEN_ABSENCE.UNREADABLE);
    return Result.succeed({
      token: opened.success,
      githubUserId: row.githubUserId,
      githubLogin: row.githubLogin,
      markInvalid: Effect.flatMap(DateTime.nowAsDate, (now) =>
        setGitHubTokenStatus(userId, row.sealedToken, GITHUB_TOKEN_STATUS.INVALID, now),
      ),
    });
  });
}
