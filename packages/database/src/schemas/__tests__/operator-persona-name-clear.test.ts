import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
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
 * The migration that clears the first name a member's operator was given
 * before operators went by Luke, over a database holding one: the
 * operator's name is cleared and a coder's is kept. The migration's own
 * statements are run over it, as the migrator runs them. Synthetic accounts
 * and rows throughout.
 */

const MIGRATION = "20261022142025_operator_persona_name_clear";

/** An account of its own. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("the operator persona-name migration", (it) => {
  it.effect("clears an existing operator's first name and leaves a coder's", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const sql = yield* SqlClient.SqlClient;
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId: workspace, name: "Billing" });
      const operator = Option.getOrThrow(
        yield* createCodingAgent(owner, {
          taskId: null,
          organizationId: workspace,
          planSnapshot: null,
          prompt: null,
          kind: CODING_AGENT_KIND.OPERATOR,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
        }),
      ).agent;
      const coder = Option.getOrThrow(
        yield* createCodingAgent(owner, {
          taskId: task.id,
          planSnapshot: "# Billing",
          prompt: null,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
        }),
      ).agent;
      // The operator as one made before stood: given a first name, as every agent was.
      yield* db
        .update(codingAgent)
        .set({ personaName: "Ava" })
        .where(eq(codingAgent.id, operator.id));

      for (const statement of yield* migrationStatements(MIGRATION)) yield* sql.unsafe(statement);

      const nameOf = (agentId: string) =>
        Effect.map(readCodingAgent(owner, agentId), (read) => Option.getOrThrow(read).personaName);
      assert.equal(yield* nameOf(operator.id), null);
      assert.equal(yield* nameOf(coder.id), coder.personaName);
      assert.match(coder.personaName ?? "", /^\S+$/u);
    }),
  );
});
