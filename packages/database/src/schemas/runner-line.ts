/**
 * runner-line.ts -- the lines the service queues for a cloud agent's runner, which the runner reads past its cursor and acknowledges.
 *
 * A cloud runner reads its agent's lines from here under its own bearer
 * (`../models/runner-line-store.ts`) rather than taking them on its stdin, so
 * a line stands until the runner says it took it, and a launch that never
 * took one hands it to the next. Every row goes with its agent and its
 * account alike.
 */

import { sql } from "drizzle-orm";
import { bigint, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";

/**
 * One line to a cloud agent's runner, in the order the service wrote them:
 * `seq` is one sequence across every agent, minted as the line is queued.
 * Every line of one agent is queued under its runner lease, which is what
 * keeps them committed in their `seq` order, so a runner that read up to one
 * never passes over a line below it. `launch` is the first event number of
 * the launch the line was written for. `text` is one input line as the
 * runner reads it (`@luke/agent-runner`'s `InputLineSchema`), carrying no
 * secret. `line_id` is a message line's own id, the send's key, so a send
 * repeated under it queues once; null for every other kind. `accepted_at`
 * is when the runner said it took a message line (its ACCEPTED event); a
 * message line no launch accepted is handed to the next launch too.
 */
export const runnerLine = pgTable(
  "runner_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The line's place in the order every line was queued in. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    /** The first event number of the launch the line was written for. */
    launch: bigint("launch", { mode: "number" }).notNull(),
    /** One input line, as the runner reads it. */
    text: text("text").notNull(),
    /** A message line's own id; null for every other kind. */
    lineId: uuid("line_id"),
    createdAt: createdAt(),
    /** When the runner said it took the message line; null until then, and for every other kind. */
    acceptedAt: timestamptz("accepted_at"),
  },
  (table) => [
    // A runner reads its agent's lines in order.
    index("runner_line_agent_seq").on(table.agentId, table.seq),
    // A send repeated under its key queues its line once.
    uniqueIndex("runner_line_agent_line")
      .on(table.agentId, table.lineId)
      .where(sql`${table.lineId} is not null`),
  ],
);
