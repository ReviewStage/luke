import { bigint, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";

/**
 * token-pull-request-poll.ts -- what the scheduled sweep last read of a token agent's pull request.
 *
 * A coding agent on its starter's own GitHub token works on a repository no
 * installation of the Luke GitHub App reaches, so no webhook tells it of a
 * review, a comment, or a check on its pull request; the sweep polls the
 * pull request instead (`token-pull-request-sweep.ts`). One row per such
 * agent, made the first time the sweep claims it: the pull request polled,
 * the ETag GitHub answered each read with, so the next read is conditional,
 * the newest review and conversation comment seen, the head and the check
 * conclusion last seen on it, and when the next poll is due. The row goes
 * with its agent.
 */

/** The ETag GitHub last answered each read with, by the read; absent until a read answered one. */
export interface StoredPollEtags {
  readonly pullRequest?: string | undefined;
  readonly reviews?: string | undefined;
  readonly comments?: string | undefined;
  readonly checkRuns?: string | undefined;
  readonly statuses?: string | undefined;
}

export const tokenPullRequestPoll = pgTable("token_pull_request_poll", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => codingAgent.id, { onDelete: "cascade" }),
  /** The pull request's number the state below was read on; another number starts the state afresh. */
  pullRequest: integer("pull_request").notNull(),
  etags: jsonb("etags").$type<StoredPollEtags>().notNull().default({}),
  /** GitHub's id of the newest review seen; null before a read of the reviews. */
  lastReviewId: bigint("last_review_id", { mode: "number" }),
  /** GitHub's id of the newest conversation comment seen; null before a read of the comments. */
  lastCommentId: bigint("last_comment_id", { mode: "number" }),
  /** The head commit the checks were last read on. */
  headSha: text("head_sha"),
  /** What the checks on that head last came to, failed or not, as the sweep words it (`CHECK_SUMMARY`). */
  checkConclusion: text("check_conclusion"),
  nextPollAt: timestamptz("next_poll_at").notNull(),
});
