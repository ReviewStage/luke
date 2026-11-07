/**
 * pull-request-chapters.ts -- one coding agent's pull request's chapters bound: their one statement, the tables it reads, the topics that wake it, the workspace it serves, and what the reader's Generate stands on beside it.
 *
 * The statement reads the newest claim of the pull request numbered under
 * the agent's repository in the agent's workspace, in
 * `latestPullRequestChapters`'s order (`NEWEST_CLAIM`), for an account that
 * sees the agent (`agentVisibleTo`): no rows for an agent it does not see,
 * one with no repository, or a pull request never generated there. Its
 * repository is matched as the agent names it, as the agent's read matches
 * it. Note that it never reads who pressed Generate, which the capture
 * ignores, and cannot ask whether the workspace still reaches the
 * repository, which is confirmed as it is asked.
 *
 * It is woken by a claim, finish, or failure in the agent's workspace, all
 * of which name its chapters topic, by the agent's own row, and by what
 * admits the reader to its workspace or repository. The agent's task is
 * read for the reader's reach of it and wakes nothing, as a task's reach
 * moves with what admits the reader. The workspace is served from the
 * agent's own row, read once as the read is asked, which also admits the
 * reader as the agent's own read of them does (`keptUnder`), so an agent it does not reach
 * is not found. Whether the reader can generate them, and on what, comes
 * from their own keys, which no statement reads, so it is answered beside
 * the rows on every poll.
 */

import { queryBuilder } from "@repo/database/core/query";
import { NEWEST_CLAIM } from "@repo/database/models/pull-request-chapters-store";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { pullRequestChapters } from "@repo/database/schemas/pull-request-chapters";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  pullRequestChaptersSync,
  taskSync,
} from "@repo/database/sync/tables";
import type { chapterSchema } from "@repo/features/pull-request-chapters";
import { PULL_REQUEST_CHAPTERS_READ } from "@repo/features/pull-request-chapters-live";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { reachedAgentById } from "../../agents/agent-reach.js";
import { pullRequestNumberOf } from "../../agents/asked-pull-request.js";
import { generatorFor, keptUnder } from "../../chapters/pull-request-chapters-procedures.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, ownOrder } from "../live-read-binding.js";

/** A pull request's number a read's param binds, as its query spelled it; zero, which numbers no pull request, where it names none. */
function pullRequestNumberParam(param: string): number {
  const number = Number(param);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export const pullRequestChaptersRead = bindLiveRead(PULL_REQUEST_CHAPTERS_READ, {
  reads: [
    pullRequestChaptersSync,
    agentSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id, workspaceId }) => [
    [TOPIC.WORKSPACE_CHAPTERS, workspaceId],
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id, number }) => ({
    chapters: liveRowsStatement(
      PULL_REQUEST_CHAPTERS_READ.parts.chapters,
      {
        ordered: false,
        columns: {
          status: pullRequestChapters.status,
          headSha: pullRequestChapters.headSha,
          baseSha: pullRequestChapters.baseSha,
          failureKind: pullRequestChapters.failureKind,
          model: pullRequestChapters.model,
          // Note that the chapters pass through as the JSON they were stored as, which the reader decodes.
          chapters: sql<
            readonly (typeof chapterSchema.Encoded)[] | null
          >`${pullRequestChapters.chapters}`,
        },
        instants: { startedAt: pullRequestChapters.startedAt },
      },
      (selection) =>
        ownOrder(
          queryBuilder
            .select(selection)
            .from(pullRequestChapters)
            .innerJoin(
              agentTable,
              and(
                eq(agentTable.organizationId, pullRequestChapters.organizationId),
                eq(agentTable.repository, pullRequestChapters.repository),
              ),
            )
            .where(
              and(
                eq(agentTable.id, id),
                agentVisibleTo(userId),
                eq(pullRequestChapters.pullRequestNumber, pullRequestNumberParam(number)),
              ),
            )
            .orderBy(...NEWEST_CLAIM)
            .limit(1),
        ),
    ),
  }),
  // Note that the number is read first, so one of no shape is refused before the agent is.
  serve: Effect.fnUntraced(function* ({ userId, id, number }) {
    // One number named always reads as one or is refused.
    const read = yield* pullRequestNumberOf([number]);
    if (read === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const { agent } = yield* reachedAgentById(userId, id);
    // Note that an agent with no repository is answered as its rows stand, none, as it keeps no chapters.
    yield* keptUnder(userId, agent);
    return { workspaceId: agent.organizationId };
  }),
  beside: ({ params }) => generatorFor(params.userId),
});
