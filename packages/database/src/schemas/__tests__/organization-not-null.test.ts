import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { DateTime, Effect, Exit, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { MIGRATIONS_FOLDER } from "../../core/migrator.js";
import { Database } from "../../core/query.js";
import { createAutomation } from "../../models/automation-store.js";
import { createCodingAgent } from "../../models/coding-agent-store.js";
import { createTask } from "../../models/task-store.js";
import {
  getTestDB,
  migrationStatements,
  RENAME_PLAN_TO_TASK,
  undoneRename,
} from "../../testing/index.js";
import { member, organization, user } from "../auth.js";

/**
 * The contract step's migration over a database from before it: rows the
 * expand step's backfill had not reached, an automation and an agent with
 * no workspace, take their task's, and the column then refuses a null.
 * The constraint is dropped first so the database stands as one from before
 * the migration, and the migration's own statements are run over it.
 * Synthetic accounts and rows throughout.
 */

const MIGRATION = "20261015062923_organization_not_null";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** The migration's statements, as the migrator runs them. */
const statements = Effect.promise(async () =>
  (await readFile(join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"), "utf8"))
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0),
);

/** A task in a workspace the account owns, and the workspace. */
const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const organizationId = randomUUID();
  const now = yield* DateTime.nowAsDate;
  yield* db
    .insert(organization)
    .values({ id: organizationId, name: "Acme", slug: `acme-${organizationId}`, createdAt: now });
  yield* db
    .insert(member)
    .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
  const task = yield* createTask(userId, {
    organizationId,
    name: "Nightly triage",
    repository: "acme/api",
  });
  return { userId, organizationId, taskId: task.id };
});

it.layer(getTestDB())("the contract step's organization migration", (it) => {
  it.effect(
    "an automation and an agent the backfill had not reached take their plan's workspace, and the column then refuses a null",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const { userId, organizationId, taskId } = yield* openTask;
        const made = Option.getOrThrow(
          yield* createAutomation(userId, {
            taskId,
            name: "Nightly flaky-test sweep",
            trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
            action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
        );
        const started = Option.getOrThrow(
          yield* createCodingAgent(userId, {
            taskId,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/api",
            planSnapshot: null,
            prompt: "Sweep the flaky tests.",
          }),
        );
        // The database as it stood before the migration: the column open, and rows left null.
        for (const table of ["automation", "coding_agent"] as const) {
          yield* sql.unsafe(`ALTER TABLE "${table}" ALTER COLUMN "organization_id" DROP NOT NULL`);
        }
        yield* sql`UPDATE automation SET organization_id = NULL WHERE id = ${made.id}`;
        yield* sql`UPDATE coding_agent SET organization_id = NULL WHERE id = ${started.agent.id}`;

        // Note that the migration names the plan's row by the names it held then, so the later rename is walked back around it.
        const renames = yield* migrationStatements(RENAME_PLAN_TO_TASK);
        for (const statement of [...renames].reverse()) yield* sql.unsafe(undoneRename(statement));
        for (const statement of yield* statements) yield* sql.unsafe(statement);
        for (const statement of renames) yield* sql.unsafe(statement);

        const [automationRow] = yield* sql<{ readonly organization_id: string | null }>`
          SELECT organization_id FROM automation WHERE id = ${made.id}
        `;
        const [agentRow] = yield* sql<{ readonly organization_id: string | null }>`
          SELECT organization_id FROM coding_agent WHERE id = ${started.agent.id}
        `;
        const refused = yield* Effect.exit(
          sql`UPDATE automation SET organization_id = NULL WHERE id = ${made.id}`,
        );

        assert.deepEqual(
          [automationRow?.organization_id, agentRow?.organization_id],
          [organizationId, organizationId],
        );
        assert.ok(Exit.isFailure(refused), "the column refuses a null once the migration stands");
      }),
  );
});
