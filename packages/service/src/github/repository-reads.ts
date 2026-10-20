/**
 * repository-reads.ts -- which repositories of teammates' token tasks and agents a member's own GitHub token reads, asked of GitHub at most hourly.
 *
 * A task or a coding agent reached on its owner's own token is seen by
 * another member only where that member's own verified token reads its
 * repository (`@luke/database/models/workspace-store`). This is where the
 * service asks: each repository of such a task or agent in the member's
 * workspaces that the member's token was not asked about within the hour is
 * read on that token (`GitHubApp`'s `memberRepositoryReadable`), and the
 * answers are kept (`@luke/database/models/github-repository-reads`), which
 * every read of a task or an agent gates on. The sidebar's list asks first
 * (`plans.list`), so a teammate's token task shows there on the list after
 * it was made, and a repository the member's token gained or lost shows
 * within the hour. A member who keeps no verified token is asked nothing.
 */

import {
  type RepositoryRead,
  recordRepositoryReads,
  unaskedTokenRepositories,
} from "@luke/database/models/github-repository-reads";
import { readGitHubTokenRow } from "@luke/database/models/github-token-store";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { causeKind } from "@luke/runtime/effect";
import { DateTime, Duration, Effect, Option } from "effect";
import { GitHubApp } from "./github-app.js";

/** How long GitHub's answer for one member and repository stands before it is asked again. */
const READ_AGAIN_AFTER = Duration.hours(1);

/** How many repositories are asked of GitHub at once. */
const ASKED_AT_ONCE = 4;

/** The repository as the member's token read it, none where GitHub answered neither way or did not answer. */
const askedRead = (userId: string, repository: string) =>
  Effect.gen(function* () {
    const github = yield* GitHubApp;
    const readable = yield* github.memberRepositoryReadable(userId, repository);
    return Option.map(readable, (reads): RepositoryRead => ({ repository, readable: reads }));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a repository was not read on a member's token: ${causeKind(cause)}`),
        Option.none<RepositoryRead>(),
      ),
    ),
  );

/**
 * Asks GitHub, on the member's own token, about every repository of a token
 * task or agent of their workspaces whose answer is older than the hour, and
 * keeps the answers; nothing for a member who keeps no verified token. It
 * never fails: a read that does not land is logged, and the list it stands
 * before goes on with the answers kept.
 */
export const refreshRepositoryReads = /* @__PURE__ */ Effect.fn("web/refreshRepositoryReads")(
  function* (userId: string) {
    const token = yield* readGitHubTokenRow(userId);
    if (token?.status !== GITHUB_TOKEN_STATUS.VERIFIED) return;
    const now = yield* DateTime.nowAsDate;
    const since = new Date(now.getTime() - Duration.toMillis(READ_AGAIN_AFTER));
    const unasked = yield* unaskedTokenRepositories(userId, since);
    if (unasked.length === 0) return;
    const read = yield* Effect.forEach(unasked, (repository) => askedRead(userId, repository), {
      concurrency: ASKED_AT_ONCE,
    });
    yield* recordRepositoryReads(userId, read.flatMap(Option.toArray), now);
  },
  Effect.catchCause((cause) =>
    Effect.logWarning(`a member's repository reads were not refreshed: ${causeKind(cause)}`),
  ),
);
