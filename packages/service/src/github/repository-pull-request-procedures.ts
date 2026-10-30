/**
 * repository-pull-request-procedures.ts -- one pull request of a workspace's repository, read by its repository and number rather than through an agent.
 *
 * Every procedure resolves the caller first, then whether the account is a
 * member of the workspace the query names (`github-procedures.ts`'s
 * `memberPlace`), and only then mints a token for the repository on the
 * workspace's installation, or the member's own token where none reaches
 * it, as a link to the pull request is read (`pull-request-links.ts`). The
 * pull request is read by its number afresh on each ask, with its head's
 * checks (`coder-host/published.ts`'s `pullRequestOfNumber`), and each read
 * past it is an agent's Pull request tab's own reader, handed the
 * repository and the workspace in an agent's place
 * (`agents/agent-pull-request-procedures.ts`, and `agents-procedures.ts`'s
 * changes). Nothing is kept and nothing is written on any agent's row.
 *
 * A workspace the account is not a member of and a number the repository
 * holds no pull request under are both not found, so a read never says
 * which of the two it met; a repository the member's workspace does not
 * reach is out of reach, as an agent's is.
 */

import type { AgentPullRequest } from "@luke/features/agent-wire";
import { Effect, Option, type Redacted } from "effect";
import {
  type OverviewRead,
  overviewChecksRead,
  overviewConversationRead,
  overviewPullRequestRead,
} from "../agents/agent-pull-request-procedures.js";
import { pullRequestChangesRead } from "../agents/agents-procedures.js";
import { githubReadRefusal, type PullRequestSubject } from "../agents/asked-pull-request.js";
import { pullRequestOfNumber } from "../agents/coder-host/published.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { GitHubApp, markRefusedToken } from "./github-app.js";
import { memberPlace } from "./github-procedures.js";

export interface RepositoryPullRequestProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** A pull request a query names, as the query decoded it. */
interface PullRequestQuery {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}

/** The pull request reached: the token it was read on, what its reads name it against, and it as GitHub holds it now. */
interface ReachedPullRequest {
  readonly token: Redacted.Redacted;
  readonly subject: PullRequestSubject;
  readonly branch: string;
  readonly pullRequest: AgentPullRequest;
}

/**
 * The pull request the query names, to a member of its workspace, read on
 * a token minted for its repository; not found where the account is no
 * member or the repository holds no pull request of that number.
 */
const reachedPullRequest = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  query: PullRequestQuery,
) {
  const place = yield* memberPlace(userId, query);
  const app = yield* GitHubApp;
  const reached = yield* githubReadRefusal(
    Effect.gen(function* () {
      const minted = yield* app.repositoryPullRequestToken(
        place.workspaceId,
        place.repository,
        place.member,
      );
      if (Option.isNone(minted)) {
        return yield* Effect.fail({ _tag: "RepositoryNotReachable" } as const);
      }
      const { token, repository, access } = minted.value;
      const found = yield* pullRequestOfNumber(token, repository.fullName, query.number).pipe(
        markRefusedToken(access),
      );
      return Option.map(found, (read) => ({ token, repository: repository.fullName, ...read }));
    }),
  );
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { token, repository, branch, pullRequest } = reached.value;
  const subject: PullRequestSubject = {
    organizationId: place.workspaceId,
    repository,
    author: null,
  };
  return { token, subject, branch, pullRequest } satisfies ReachedPullRequest;
});

/** One part of the pull request's overview, read afresh on the token it was reached on; none where the repository no longer holds it. */
const overviewPart = <A, R>(
  reached: ReachedPullRequest,
  userId: string,
  read: OverviewRead<A, R>,
) =>
  Effect.map(
    githubReadRefusal(read(reached.token, reached.subject, reached.pullRequest, userId)),
    (part) => ({ pullRequest: part }),
  );

/** The pull request resource: its five reads, to a signed-in member of the workspace the query names. */
export function repositoryPullRequestProcedures(seams: RepositoryPullRequestProcedureSeams) {
  const signedIn = hosted.pullRequests.use(accountMiddleware(seams.resolveUserId));
  return {
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      const { subject, branch, pullRequest } = yield* reachedPullRequest(context.userId, input);
      return { repository: subject.repository, branch, pullRequest };
    }),
    changes: signedIn.changes.effect(function* ({ input, context }) {
      const { token, subject, pullRequest } = yield* reachedPullRequest(context.userId, input);
      const changes = yield* githubReadRefusal(pullRequestChangesRead(token, subject, pullRequest));
      return { pullRequest: changes };
    }),
    overviewPullRequest: signedIn.overviewPullRequest.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewPart(reached, context.userId, overviewPullRequestRead);
    }),
    overviewChecks: signedIn.overviewChecks.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewPart(reached, context.userId, overviewChecksRead);
    }),
    overviewConversation: signedIn.overviewConversation.effect(function* ({ input, context }) {
      const reached = yield* reachedPullRequest(context.userId, input);
      return yield* overviewPart(reached, context.userId, overviewConversationRead);
    }),
  };
}
