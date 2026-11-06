import type { AgentPullRequest } from "@repo/features/agent-wire";
import { Effect, Option, type Redacted } from "effect";
import {
  actionWrite,
  type OverviewRead,
  overviewChecksRead,
  overviewConversationRead,
  overviewPullRequestRead,
  viewedAnswerOf,
  viewedRead,
} from "../agents/agent-pull-request-procedures.js";
import { pullRequestChangesRead } from "../agents/agents-procedures.js";
import { githubReadRefusal, type PullRequestSubject } from "../agents/asked-pull-request.js";
import { pullRequestOfNumber } from "../agents/coder-host/published.js";
import {
  type MemberWrite,
  memberWriteOnReached,
  writeAnswerOf,
} from "../agents/pull-request-write.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { GitHubApp, type GitHubTokenAccess, markRefusedToken } from "./github-app.js";
import { namedReviewOptions } from "./github-people.js";
import { memberPlace } from "./github-procedures.js";
import {
  type PullRequestReadFailure,
  pullRequestByNumber,
  pullRequestReviewOptions,
} from "./pull-requests.js";

export interface RepositoryPullRequestProcedureSeams {
  resolveUserId: UserIdResolver;
}

interface PullRequestQuery {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}

interface ReachedRepository {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
  readonly subject: PullRequestSubject;
}

interface ReachedPullRequest {
  readonly token: Redacted.Redacted;
  readonly subject: PullRequestSubject;
  readonly branch: string;
  readonly pullRequest: AgentPullRequest;
}

export const reachedRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  query: PullRequestQuery,
) {
  const place = yield* memberPlace(userId, query);
  const app = yield* GitHubApp;
  const minted = yield* githubReadRefusal(
    app.repositoryPullRequestToken(place.workspaceId, place.repository, place.member),
  );
  if (Option.isNone(minted)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const { token, repository, access } = minted.value;
  const subject: PullRequestSubject = {
    organizationId: place.workspaceId,
    repository: repository.fullName,
    author: null,
  };
  return { token, access, subject } satisfies ReachedRepository;
});

export const reachedByNumber = <A, R>(
  userId: string,
  query: PullRequestQuery,
  read: (
    token: Redacted.Redacted,
    repository: string,
    number: number,
  ) => Effect.Effect<Option.Option<A>, PullRequestReadFailure, R>,
) =>
  Effect.gen(function* () {
    const { token, access, subject } = yield* reachedRepository(userId, query);
    const found = yield* githubReadRefusal(
      read(token, subject.repository, query.number).pipe(markRefusedToken(access)),
    );
    if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { token, subject, found: found.value };
  });

const reachedPullRequest = (userId: string, query: PullRequestQuery) =>
  Effect.map(
    reachedByNumber(userId, query, pullRequestOfNumber),
    ({ token, subject, found }): ReachedPullRequest => ({ token, subject, ...found }),
  );

const writtenOn = <A>(userId: string, query: PullRequestQuery, write: MemberWrite<A>) =>
  Effect.flatMap(reachedByNumber(userId, query, pullRequestByNumber), ({ subject }) =>
    memberWriteOnReached(userId, { repository: subject.repository, number: query.number }, write),
  );

const overviewPart = <A, R>(
  reached: ReachedPullRequest,
  userId: string,
  read: OverviewRead<A, R>,
) =>
  Effect.map(
    githubReadRefusal(read(reached.token, reached.subject, reached.pullRequest, userId)),
    (part) => ({ pullRequest: part }),
  );

export function repositoryPullRequestProcedures(seams: RepositoryPullRequestProcedureSeams) {
  const signedIn = hosted.pullRequests.use(accountMiddleware(seams.resolveUserId));
  return {
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      const { subject, branch, pullRequest } = yield* reachedPullRequest(context.userId, input);
      return { repository: subject.repository, branch, pullRequest };
    }),
    action: signedIn.action.effect(function* ({ input, context }) {
      const written = yield* writtenOn(context.userId, input.query, actionWrite(input.body));
      return writeAnswerOf(written);
    }),
    viewed: signedIn.viewed.effect(function* ({ input, context }) {
      return viewedAnswerOf(yield* writtenOn(context.userId, input, viewedRead));
    }),
    changes: signedIn.changes.effect(function* ({ input, context }) {
      const { token, subject, pullRequest } = yield* reachedPullRequest(context.userId, input);
      const changes = yield* githubReadRefusal(pullRequestChangesRead(token, subject, pullRequest));
      return { pullRequest: changes };
    }),
    reviewOptions: signedIn.reviewOptions.effect(function* ({ input, context }) {
      const { token, access, subject } = yield* reachedRepository(context.userId, input);
      return yield* githubReadRefusal(
        pullRequestReviewOptions(token, subject.repository).pipe(markRefusedToken(access)),
      ).pipe(
        Effect.flatMap((read) =>
          namedReviewOptions({ organizationId: subject.organizationId }, read),
        ),
      );
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
