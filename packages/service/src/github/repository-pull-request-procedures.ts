/**
 * repository-pull-request-procedures.ts -- one pull request of a workspace's repository, read and changed by its repository and number rather than through an agent.
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
 * A change to the pull request (`POST /api/pull-requests/action`), and the
 * read of which of its files the member marked viewed
 * (`GET /api/pull-requests/viewed`), reach it the same way, read once by its
 * number so one the repository holds none under is not found, and are then
 * made through the one seam every change to a pull request takes, as the
 * member on their own GitHub sign-in and never on the token minted here
 * (`agents/pull-request-write.ts`). No agent's kept published answer is let
 * go, as none is named; it lapses on its own short while.
 *
 * A workspace the account is not a member of and a number the repository
 * holds no pull request under are both not found, so a read never says
 * which of the two it met; a repository the member's workspace does not
 * reach is out of reach, as an agent's is.
 */

import type { AgentPullRequest } from "@luke/features/agent-wire";
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

/** A pull request a query names, as the query decoded it. */
interface PullRequestQuery {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}

/** The repository the query names, reached for a member of its workspace: the token minted for it, how that token was had, and what its reads name it against. */
interface ReachedRepository {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
  readonly subject: PullRequestSubject;
}

/** The pull request reached: the token it was read on, what its reads name it against, and it as GitHub holds it now. */
interface ReachedPullRequest {
  readonly token: Redacted.Redacted;
  readonly subject: PullRequestSubject;
  readonly branch: string;
  readonly pullRequest: AgentPullRequest;
}

/**
 * The repository the query names, to a member of its workspace, on a token
 * minted for it; not found where the account is no member, and out of reach
 * where the workspace no longer reaches the repository. Nothing about the
 * number is read here.
 */
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

/**
 * The repository the query names, reached as above, and what `read` finds
 * there by the query's number on the token minted for it; not found where
 * the account is no member or `read` finds nothing, so neither says which.
 */
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

/** The pull request the query names, read with its head's checks, to a member of its workspace; not found as `reachedByNumber` is. */
const reachedPullRequest = (userId: string, query: PullRequestQuery) =>
  Effect.map(
    reachedByNumber(userId, query, pullRequestOfNumber),
    ({ token, subject, found }): ReachedPullRequest => ({ token, subject, ...found }),
  );

/**
 * The pull request the query names, to a member of its workspace, as the
 * member's own write is made on it (`pull-request-write.ts`): read once
 * on the minted token so a number it holds none under is not found, then
 * handed on by the repository and number alone.
 */
const writtenOn = <A>(userId: string, query: PullRequestQuery, write: MemberWrite<A>) =>
  Effect.flatMap(reachedByNumber(userId, query, pullRequestByNumber), ({ subject }) =>
    memberWriteOnReached(userId, { repository: subject.repository, number: query.number }, write),
  );

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

/** The pull request resource: its seven reads and its one change, to a signed-in member of the workspace the query names. */
export function repositoryPullRequestProcedures(seams: RepositoryPullRequestProcedureSeams) {
  const signedIn = hosted.pullRequests.use(accountMiddleware(seams.resolveUserId));
  return {
    pullRequest: signedIn.pullRequest.effect(function* ({ input, context }) {
      const { subject, branch, pullRequest } = yield* reachedPullRequest(context.userId, input);
      return { repository: subject.repository, branch, pullRequest };
    }),
    /** One change to the pull request, as the asking member on their own GitHub sign-in (`pull-request-write.ts`), and how GitHub took it. */
    action: signedIn.action.effect(function* ({ input, context }) {
      const written = yield* writtenOn(context.userId, input.query, actionWrite(input.body));
      return writeAnswerOf(written);
    }),
    /** Which of the pull request's files the asking member marked viewed on GitHub, on their own GitHub sign-in. */
    viewed: signedIn.viewed.effect(function* ({ input, context }) {
      return viewedAnswerOf(yield* writtenOn(context.userId, input, viewedRead));
    }),
    changes: signedIn.changes.effect(function* ({ input, context }) {
      const { token, subject, pullRequest } = yield* reachedPullRequest(context.userId, input);
      const changes = yield* githubReadRefusal(pullRequestChangesRead(token, subject, pullRequest));
      return { pullRequest: changes };
    }),
    /**
     * What the reviewer and label pickers offer, of the repository rather than
     * the pull request, as an agent's are (`agents-procedures.ts`): the number
     * is decoded with the rest of the query and names nothing more, so a number
     * the repository holds none under still answers. Note that it is left
     * unchecked, because reading the pull request would cost a GitHub call on
     * every picker read for no gain: a non-member is refused all the same.
     */
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
