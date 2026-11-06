import { bigint, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

export interface StoredPollEtags {
  readonly pullRequest?: string | undefined;
  readonly reviews?: string | undefined;
  readonly comments?: string | undefined;
  readonly checkRuns?: string | undefined;
  readonly statuses?: string | undefined;
}

export const tokenPullRequestPoll = pgTable(
  "token_pull_request_poll",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    pullRequest: integer("pull_request").notNull(),
    etags: jsonb("etags").$type<StoredPollEtags>().notNull().default({}),
    lastReviewId: bigint("last_review_id", { mode: "number" }),
    lastCommentId: bigint("last_comment_id", { mode: "number" }),
    headSha: text("head_sha"),
    checkConclusion: text("check_conclusion"),
    nextPollAt: timestamptz("next_poll_at").notNull(),
  },
  (table) => [index("token_pull_request_poll_due").on(table.nextPollAt, table.agentId)],
);
