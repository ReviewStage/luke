import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";
import { plan } from "./plan-schema.js";
import { conversations } from "./storage-schema.js";

/**
 * coding-agent-schema.ts -- one coding agent started on a plan, linking its conversation to the plan it works.
 *
 * A coding agent is a `coding_agent` conversation: its transcript is that
 * conversation's `messages` rows and its status its latest `turns` row, so
 * this row holds only what the conversation does not. The model and effort
 * are read on every step, so switching later is a row update; the snapshot
 * is the exact plan text the agent was handed, kept whole because the plan
 * keeps being edited after; the repository is `owner/name`. There is no
 * commit column: the checkout's own output is in the transcript, and the
 * pull request on GitHub records its base.
 *
 * `idempotency_key` is the Start request's own key, unique per account, so a
 * network retry of one Start finds the agent it already made rather than
 * starting a second. The row goes with its plan, its account, and its
 * conversation alike.
 */
export const codingAgent = pgTable(
  "coding_agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /** The plan's document exactly as the agent was given it. */
    planSnapshot: text("plan_snapshot").notNull(),
    /** The GitHub repository the agent works in, as `owner/name`. */
    repository: text("repository").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    // One agent per Start: a retry carrying the same key finds this row.
    uniqueIndex("coding_agent_user_idempotency").on(table.userId, table.idempotencyKey),
    // The tabs read one plan's agents in the order they were started.
    index("coding_agent_plan_created").on(table.planId, table.createdAt),
  ],
);
