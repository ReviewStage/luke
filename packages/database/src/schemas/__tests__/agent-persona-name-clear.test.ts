import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent, readCodingAgent } from "../../models/coding-agent-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace } from "../../testing/index.js";
import { user } from "../auth.js";
import { codingAgent } from "../coding-agent.js";

/**
 * The migration that clears the human names coding agents were given, over a
 * database holding named agents: every name is cleared, so each agent goes by
 * its title again, and the title is kept. The migration's own statements are
 * run over it, as the migrator runs them. Synthetic accounts and rows
 * throughout.
 */

const MIGRATION = "20261023144245_agent_persona_name_clear";

/** An account of its own. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("the agent persona-name migration", (it) => {
  it.effect("clears every agent's human name and keeps its title", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const sql = yield* SqlClient.SqlClient;
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId: workspace, name: "Billing" });
      const start = (title: string) =>
        createCodingAgent(owner, {
          taskId: task.id,
          planSnapshot: "# Billing",
          prompt: null,
          title,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
        }).pipe(Effect.map((started) => Option.getOrThrow(started).agent));
      const invoices = yield* start("Invoice emails");
      const refunds = yield* start("Refund webhook");
      // The agents as ones made before stood: given a first name, as every agent was.
      for (const [agent, name] of [
        [invoices, "Maya"],
        [refunds, "Theo"],
      ] as const) {
        yield* db
          .update(codingAgent)
          .set({ personaName: name })
          .where(eq(codingAgent.id, agent.id));
      }

      for (const statement of yield* migrationStatements(MIGRATION)) yield* sql.unsafe(statement);

      const read = (agentId: string) =>
        Effect.map(readCodingAgent(owner, agentId), (found) => {
          const agent = Option.getOrThrow(found);
          return [agent.personaName, agent.title];
        });
      assert.deepEqual(yield* read(invoices.id), [null, "Invoice emails"]);
      assert.deepEqual(yield* read(refunds.id), [null, "Refund webhook"]);
    }),
  );
});
