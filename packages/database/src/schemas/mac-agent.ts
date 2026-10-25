import type {
  MacAgentLineKind,
  MacAgentObject,
  MacAgentRequestKind,
} from "@luke/features/mac-agent-wire";
import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { macDevice } from "./mac-device.js";

/**
 * mac-agent.ts -- the work the service queues for a local agent's Mac: lines to its runner, and its tools' requests.
 *
 * Each row names the account, the agent, and the Mac the agent is pinned
 * to, and is claimed once, by that Mac, under that account
 * (`../models/mac-agent-store.ts`). A row stands only while its work does:
 * the expiry withdraws what no Mac claimed in time, and a request's caller
 * withdraws it once it read the answer. Every row goes with its agent, its
 * Mac, and its account alike.
 */

/**
 * One line to a local agent's runner, in the order the service wrote them:
 * `seq` is one sequence across every agent, minted as the line is queued,
 * so it never repeats, even once expiry withdrew an agent's every line, and
 * two lines queued at once never contend for one value. An agent's lines
 * are read in its order; the values are not dense, and two lines queued at
 * once may commit out of their order, so a Mac claims each by its id and
 * never passes over one below the highest it saw. A launch
 * line carries the secrets its runner is launched under (its bearer and
 * the harness credential) in `sealed_secrets`, sealed by the service, which
 * no listing reads and the claim clears in the same statement it hands
 * them over in, so they never outlive delivery. `exit_code` is the runner's
 * as the Mac settled its launch line; null until then and for every other
 * kind.
 */
export const macAgentLine = pgTable(
  "mac_agent_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => macDevice.id, { onDelete: "cascade" }),
    /** The line's place in the order every line was queued in. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    kind: text("kind").$type<MacAgentLineKind>().notNull(),
    /** What the line says, which its kind's reader holds to a shape. */
    payload: jsonb("payload").$type<MacAgentObject>().notNull(),
    /** A launch line's secrets as the service sealed them; null for every other kind and once claimed. */
    sealedSecrets: text("sealed_secrets"),
    createdAt: createdAt(),
    /** When the Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** When the Mac said it was done with it; null until then. */
    settledAt: timestamptz("settled_at"),
    /** The runner's exit code, as the Mac settled a launch line; null otherwise. */
    exitCode: integer("exit_code"),
  },
  (table) => [
    // A Mac reads its unclaimed lines.
    index("mac_agent_line_device_waiting")
      .on(table.deviceId, table.seq)
      .where(sql`${table.claimedAt} is null`),
    // The expiry withdraws an account's lines by age.
    index("mac_agent_line_user_created").on(table.userId, table.createdAt),
  ],
);

/**
 * One request of a local agent's tool to its Mac, under the id its caller
 * minted and waits on: a file to read or a command to run, and once the Mac
 * answered, what it answered. A read's answer is `bytes`, null where the Mac
 * read no such file; a command's is `exit_code`, `stdout`, and `stderr`,
 * each output held to the same bound as a read
 * (`MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES`). `settled_at` is what says it was
 * answered.
 */
export const macAgentRequest = pgTable(
  "mac_agent_request",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => macDevice.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MacAgentRequestKind>().notNull(),
    /** What the request names, such as the path to read, which its kind's reader holds to a shape. */
    args: jsonb("args").$type<MacAgentObject>().notNull(),
    /** A read's file; null before the answer, where the Mac read no such file, and for a command. */
    bytes: bytea("bytes"),
    /** A command's exit code; null before the answer and for a read. */
    exitCode: integer("exit_code"),
    /** A command's stdout; null before the answer and for a read. */
    stdout: text("stdout"),
    /** A command's stderr; null before the answer and for a read. */
    stderr: text("stderr"),
    createdAt: createdAt(),
    /** When the Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** When the Mac answered it; null until then. */
    settledAt: timestamptz("settled_at"),
  },
  (table) => [
    // A Mac reads its unclaimed requests.
    index("mac_agent_request_device_waiting")
      .on(table.deviceId, table.createdAt)
      .where(sql`${table.claimedAt} is null`),
    // The expiry withdraws an account's requests by age.
    index("mac_agent_request_user_created").on(table.userId, table.createdAt),
  ],
);
