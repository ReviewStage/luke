import type {
  DeviceAgentLineKind,
  DeviceAgentObject,
  DeviceAgentRequestKind,
} from "@luke/features/device-agent-wire";
import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { device } from "./device.js";

/**
 * device-agent.ts -- the work the service queues for a local agent's Mac: lines to its runner, and its tools' requests.
 *
 * Each row names the account, the agent, and the Mac the agent is pinned
 * to, and is claimed once, by that Mac, under that account
 * (`../models/device-agent-store.ts`). A row stands only while its work does:
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
 * them over in, so they never outlive delivery. A claim carries a token
 * its Mac minted for the line (`claim_token`), so the same claim asked again
 * after its answer was lost is answered again, never its secrets.
 * `exit_code` is the runner's
 * as the Mac settled its launch line; null until then and for every other
 * kind.
 */
export const deviceAgentLine = pgTable(
  "device_agent_line",
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
      .references(() => device.id, { onDelete: "cascade" }),
    /** The line's place in the order every line was queued in. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    kind: text("kind").$type<DeviceAgentLineKind>().notNull(),
    /** What the line says, which its kind's reader holds to a shape. */
    payload: jsonb("payload").$type<DeviceAgentObject>().notNull(),
    /** A launch line's secrets as the service sealed them; null for every other kind and once claimed. */
    sealedSecrets: text("sealed_secrets"),
    createdAt: createdAt(),
    /** When the Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** The token the Mac's claim carried, which its retries carry too; null while it waits and for a claim from a build before the token. */
    claimToken: uuid("claim_token"),
    /** When the Mac said it was done with it; null until then. */
    settledAt: timestamptz("settled_at"),
    /** The runner's exit code, as the Mac settled a launch line; null otherwise. */
    exitCode: integer("exit_code"),
  },
  (table) => [
    // A Mac reads its unclaimed lines.
    index("device_agent_line_device_waiting")
      .on(table.deviceId, table.seq)
      .where(sql`${table.claimedAt} is null`),
    // The expiry withdraws an account's lines by age.
    index("device_agent_line_user_created").on(table.userId, table.createdAt),
    // The lease sweep reads the open launches of the devices that went away, and a beat its own.
    index("device_agent_line_open_launch")
      .on(table.deviceId, table.seq)
      .where(sql`${table.kind} = 'launch' and ${table.settledAt} is null`),
  ],
);

/**
 * One request of a local agent's tool to its Mac, under the id its caller
 * minted and waits on: a file to read, and once the Mac answered, what it
 * answered. A read's answer is `bytes`, null where the Mac read no such
 * file. `settled_at` is what says it was answered. `exit_code`, `stdout`,
 * and `stderr` held a command's answer while a tool could run one; nothing
 * writes them now.
 */
export const deviceAgentRequest = pgTable(
  "device_agent_request",
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
      .references(() => device.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DeviceAgentRequestKind>().notNull(),
    /** What the request names, such as the path to read, which its kind's reader holds to a shape. */
    args: jsonb("args").$type<DeviceAgentObject>().notNull(),
    /** A read's file; null before the answer, and where the Mac read no such file. */
    bytes: bytea("bytes"),
    /** A command's exit code, from when a tool could run one; nothing writes it now. */
    exitCode: integer("exit_code"),
    /** A command's stdout, from when a tool could run one; nothing writes it now. */
    stdout: text("stdout"),
    /** A command's stderr, from when a tool could run one; nothing writes it now. */
    stderr: text("stderr"),
    createdAt: createdAt(),
    /** When the Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** When the Mac answered it; null until then. */
    settledAt: timestamptz("settled_at"),
  },
  (table) => [
    // A Mac reads its unclaimed requests.
    index("device_agent_request_device_waiting")
      .on(table.deviceId, table.createdAt)
      .where(sql`${table.claimedAt} is null`),
    // The expiry withdraws an account's requests by age.
    index("device_agent_request_user_created").on(table.userId, table.createdAt),
  ],
);
