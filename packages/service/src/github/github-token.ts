import type { DatabaseServices } from "@repo/database/core/query";
import { readGitHubTokenRow, setGitHubTokenStatus } from "@repo/database/models/github-token-store";
import { openGitHubToken, parseKeyRing } from "@repo/database/models/provider-key-seal";
import type { TaskStoreEffect, TaskStoreFailure } from "@repo/database/models/task-store";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import { DateTime, Effect, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../environment.js";

export const GITHUB_TOKEN_ABSENCE = {
  NONE: "none",
  INVALID: "invalid",
  UNREADABLE: "unreadable",
} as const;

export type GitHubTokenAbsence = (typeof GITHUB_TOKEN_ABSENCE)[keyof typeof GITHUB_TOKEN_ABSENCE];

export interface MemberGitHubToken {
  readonly token: Redacted.Redacted<string>;
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly markInvalid: TaskStoreEffect<void>;
}

export function memberGitHubToken(
  userId: string,
): Effect.Effect<
  Result.Result<MemberGitHubToken, GitHubTokenAbsence>,
  TaskStoreFailure,
  DatabaseServices | HostedEnvironment
> {
  return Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    return yield* openMemberGitHubToken(environment.providerKeyEncryptionKeys, userId);
  });
}

export function openMemberGitHubToken(
  configured: Redacted.Redacted | undefined,
  userId: string,
): Effect.Effect<
  Result.Result<MemberGitHubToken, GitHubTokenAbsence>,
  TaskStoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const row = yield* readGitHubTokenRow(userId);
    if (row === undefined) return Result.fail(GITHUB_TOKEN_ABSENCE.NONE);
    if (row.status === GITHUB_TOKEN_STATUS.INVALID)
      return Result.fail(GITHUB_TOKEN_ABSENCE.INVALID);
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
