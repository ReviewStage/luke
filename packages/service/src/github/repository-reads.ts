import {
  type RepositoryRead,
  recordRepositoryReads,
  unaskedTokenRepositories,
} from "@repo/database/models/github-repository-reads";
import { readGitHubTokenRow } from "@repo/database/models/github-token-store";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import { causeKind } from "@repo/runtime/effect";
import { DateTime, Duration, Effect, Option } from "effect";
import { GitHubApp } from "./github-app.js";

const READ_AGAIN_AFTER = Duration.hours(1);

const ASKED_AT_ONCE = 4;

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
    yield* recordRepositoryReads(userId, token.sealedToken, read.flatMap(Option.toArray), now);
  },
  Effect.catchCause((cause) =>
    Effect.logWarning(`a member's repository reads were not refreshed: ${causeKind(cause)}`),
  ),
);
