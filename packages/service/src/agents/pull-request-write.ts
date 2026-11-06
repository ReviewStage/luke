import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent, WithRepository } from "@repo/database/models/agent-store";
import {
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestRefusal,
  type PullRequestWriteAnswer,
} from "@repo/features/pull-request-write-wire";
import { Effect, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../github/github-app.js";
import { logGitHubReadFailure, logWorkspaceReadFailure } from "../github/github-refusal.js";
import type { GitHubWriteFailure } from "../github/pull-request-writes.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { agentPullRequestReach } from "./coder-host/published.js";

export interface MemberPullRequest {
  readonly repository: string;
  readonly number: number;
  readonly token: Redacted.Redacted;
}

export type MemberWritten<A> =
  | { readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.DONE; readonly value: A }
  | { readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED }
  | {
      readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.REFUSED;
      readonly words: string;
      readonly reason?: PullRequestRefusal;
    };

type WriteServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

const SIGN_IN_REQUIRED = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED } as const;

const reached = (userId: string, agent: WithRepository<Agent>) =>
  agentPullRequestReach(userId, agent).pipe(
    Effect.asVoid,
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
      switch (failure._tag) {
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        default:
          return Effect.andThen(
            logWorkspaceReadFailure(failure),
            Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
          );
      }
    }),
  );

const memberToken = (userId: string) =>
  Effect.gen(function* () {
    const app = yield* GitHubApp;
    return yield* app.userToken(userId);
  }).pipe(
    Effect.map((token): Redacted.Redacted | undefined => token),
    Effect.catch((failure): Effect.Effect<undefined, HostedRefusal> => {
      switch (failure._tag) {
        case "GitHubSignInRequired":
          return Effect.succeed(undefined);
        case "GitHubAppNotConfigured":
        case "GitHubUnavailable":
          return Effect.andThen(
            logGitHubReadFailure(failure),
            Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
          );
        default:
          return Effect.andThen(
            logWorkspaceReadFailure(failure),
            Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
          );
      }
    }),
  );

export const memberReadToken = (
  userId: string,
): Effect.Effect<Redacted.Redacted | undefined, never, WriteServices> =>
  memberToken(userId).pipe(Effect.catch(() => Effect.succeed(undefined)));

function writtenOf<A>(failure: GitHubWriteFailure): Effect.Effect<MemberWritten<A>, HostedRefusal> {
  switch (failure._tag) {
    case "GitHubTokenRefused":
      return Effect.succeed(SIGN_IN_REQUIRED);
    case "GitHubWriteRefused":
      return Effect.succeed({
        outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
        words: failure.words,
        ...(failure.reason === undefined ? undefined : { reason: failure.reason }),
      });
    case "GitHubUnavailable":
      return Effect.andThen(logGitHubReadFailure(failure), Effect.fail(HOSTED_REFUSAL.UNAVAILABLE));
  }
}

export type MemberWrite<A> = (
  pullRequest: MemberPullRequest,
) => Effect.Effect<A, GitHubWriteFailure, HttpClient.HttpClient>;

export const memberWriteOnReached = <A>(
  userId: string,
  pullRequest: Omit<MemberPullRequest, "token">,
  write: MemberWrite<A>,
): Effect.Effect<MemberWritten<A>, HostedRefusal, WriteServices> =>
  Effect.gen(function* () {
    const token = yield* memberToken(userId);
    if (token === undefined) return SIGN_IN_REQUIRED;
    return yield* write({ ...pullRequest, token }).pipe(
      Effect.map(
        (value): MemberWritten<A> => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, value }),
      ),
      Effect.catch(writtenOf<A>),
    );
  });

export const memberPullRequestWrite = <A>(
  userId: string,
  agent: WithRepository<Agent>,
  number: number,
  write: MemberWrite<A>,
): Effect.Effect<MemberWritten<A>, HostedRefusal, WriteServices> =>
  Effect.andThen(
    reached(userId, agent),
    memberWriteOnReached(userId, { repository: agent.repository, number }, write),
  );

export function writeAnswerOf<A>(written: MemberWritten<A>): PullRequestWriteAnswer {
  return written.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
    ? { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }
    : written;
}
