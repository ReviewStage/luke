/**
 * pull-request-write.ts -- the one seam every change to a coding agent's pull request goes through: made on GitHub as the workspace member who asked, on their own GitHub sign-in, or not at all.
 *
 * A member may press a button on any agent of their workspace, a teammate's
 * among them, so who acts on GitHub is the member and never the agent's
 * developer or the Luke GitHub App: the App's token would let a member do
 * through Luke what their own account may not, such as merge without write
 * access. The agent is first reached as every read reaches it
 * (`agent-reach.ts`, then `coder-host/published.ts`'s
 * `agentPullRequestReach`), so a repository the workspace's installation no
 * longer reaches is refused before the member's token is read. That token is
 * the member's own GitHub App user token (`GitHubApp.userToken`), the one an
 * agent opens its pull request on as its developer
 * (`coder-host/pull-request.ts`), and it never leaves the service. A member
 * with no sign-in GitHub takes, none at all, a refresh GitHub refused, or a
 * token GitHub answers 401 to, is answered as one who must sign in with
 * GitHub again, and nothing is tried as anyone else. A change GitHub
 * refuses is answered in GitHub's own words (`github/pull-request-writes.ts`).
 * Luke's own failures, the store, an unconfigured App, or a GitHub that did
 * not answer, are the hosted refusals a read answers, each logged by its
 * kind alone.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import {
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestWriteAnswer,
} from "@luke/features/pull-request-write-wire";
import { Effect, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../github/github-app.js";
import { logGitHubReadFailure, logWorkspaceReadFailure } from "../github/github-refusal.js";
import type { GitHubWriteFailure } from "../github/pull-request-writes.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { agentPullRequestReach } from "./coder-host/published.js";

/** The pull request a write is on, and the member's token it is made with. */
export interface MemberPullRequest {
  /** `owner/name`, the agent's repository. */
  readonly repository: string;
  readonly number: number;
  /** The member's own GitHub App user token; never logged, never answered. */
  readonly token: Redacted.Redacted;
}

/** How a write went: made, with what it answered; the member to sign in with GitHub again; or GitHub's refusal in its words. */
export type MemberWritten<A> =
  | { readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.DONE; readonly value: A }
  | { readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED }
  | { readonly outcome: typeof PULL_REQUEST_WRITE_OUTCOME.REFUSED; readonly words: string };

type WriteServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

const SIGN_IN_REQUIRED = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED } as const;

/** The agent's repository confirmed in the workspace's reach, as a read confirms it, or the refusal a read answers. */
const reached = (userId: string, agent: CodingAgent) =>
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

/** The member's own token, or none where they must sign in with GitHub again; Luke's own failure to read it is unavailable. */
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

/** A write's failure as how it went: the token refused, GitHub's refusal, or a GitHub that did not answer. */
function writtenOf<A>(failure: GitHubWriteFailure): Effect.Effect<MemberWritten<A>, HostedRefusal> {
  switch (failure._tag) {
    case "GitHubTokenRefused":
      return Effect.succeed(SIGN_IN_REQUIRED);
    case "GitHubWriteRefused":
      return Effect.succeed({ outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: failure.words });
    case "GitHubUnavailable":
      return Effect.andThen(logGitHubReadFailure(failure), Effect.fail(HOSTED_REFUSAL.UNAVAILABLE));
  }
}

/**
 * One write on the agent's pull request as the member: the repository
 * reached, the member's token read, and the write made with it; how it went,
 * or Luke's own refusal.
 */
export const memberPullRequestWrite = <A>(
  userId: string,
  agent: CodingAgent,
  number: number,
  write: (
    pullRequest: MemberPullRequest,
  ) => Effect.Effect<A, GitHubWriteFailure, HttpClient.HttpClient>,
): Effect.Effect<MemberWritten<A>, HostedRefusal, WriteServices> =>
  Effect.gen(function* () {
    yield* reached(userId, agent);
    const token = yield* memberToken(userId);
    if (token === undefined) return SIGN_IN_REQUIRED;
    return yield* write({ repository: agent.repository, number, token }).pipe(
      Effect.map(
        (value): MemberWritten<A> => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, value }),
      ),
      Effect.catch(writtenOf<A>),
    );
  });

/** How a write went, as the wire answers it: what a made write answered is the caller's, never the wire's. */
export function writeAnswerOf<A>(written: MemberWritten<A>): PullRequestWriteAnswer {
  return written.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
    ? { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }
    : written;
}
