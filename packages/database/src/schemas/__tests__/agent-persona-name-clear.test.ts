import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_ARCHIVER } from "@luke/features/coding-agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent } from "../../models/coding-agent-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace } from "../../testing/index.js";
import { user } from "../auth.js";
import { codingAgent } from "../coding-agent.js";

/**
 * The migration that clears the human names coding agents were given, over a
 * database holding named agents: every name is cleared and every title kept,
 * and an archive an agent made under its human name names it by its title,
 * or its model, instead. The migration's own statements are run over it, as
 * the migrator runs them. Synthetic accounts and rows throughout.
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
  it.effect(
    "clears every agent's human name, keeps its title, and renames an archive an agent made under its name",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Billing" });
        const start = (title: string | undefined) =>
          createCodingAgent(owner, {
            taskId: task.id,
            planSnapshot: "# Billing",
            prompt: null,
            ...(title === undefined ? undefined : { title }),
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/api",
          }).pipe(Effect.map((started) => Option.getOrThrow(started).agent.id));
        const invoices = yield* start("Invoice emails");
        const untitled = yield* start(undefined);
        const archivedByName = yield* start("Refund webhook");
        const archivedByTitle = yield* start("Refund retries");
        // The agents as ones made before stood: given a first name, as every agent was.
        const named = (agentId: string, personaName: string) =>
          db.update(codingAgent).set({ personaName }).where(eq(codingAgent.id, agentId));
        yield* named(invoices, "Maya");
        yield* named(untitled, "Theo");
        // An archive each named its archiver as it then stood: by its human name, and by its title.
        const archivedBy = (agentId: string, agentName: string) =>
          db
            .update(codingAgent)
            .set({
              archivedAt: new Date(),
              archivedBy: {
                by: CODING_AGENT_ARCHIVER.AGENT,
                userId: owner,
                agentId: invoices,
                agentName,
                reason: "Its pull request merged.",
              },
            })
            .where(eq(codingAgent.id, agentId));
        yield* archivedBy(archivedByName, "Maya");
        yield* archivedBy(archivedByTitle, "Invoice emails");

        for (const statement of yield* migrationStatements(MIGRATION)) yield* sql.unsafe(statement);

        const read = (agentId: string) =>
          Effect.map(
            db
              .select({
                personaName: codingAgent.personaName,
                title: codingAgent.title,
                archiver: codingAgent.archivedBy,
              })
              .from(codingAgent)
              .where(eq(codingAgent.id, agentId)),
            ([row]) => [row?.personaName, row?.title, row?.archiver?.agentName],
          );
        assert.deepEqual(yield* read(invoices), [null, "Invoice emails", undefined]);
        assert.deepEqual(yield* read(untitled), [null, null, undefined]);
        assert.deepEqual(yield* read(archivedByName), [null, "Refund webhook", "Invoice emails"]);
        assert.deepEqual(yield* read(archivedByTitle), [null, "Refund retries", "Invoice emails"]);
      }),
  );
});
