import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@sidecar/database/models/account-store";
import { childTitlesOf, fillChildTitle } from "@sidecar/database/models/child-titles";
import { createPlan, openPlanConversation } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { conversations } from "@sidecar/database/schemas/storage";
import { getTestDB } from "@sidecar/database/testing";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { openChildConversation } from "../server/hosted/brain-host/conversation";

/**
 * The deployment that drops the dead tables and columns migrates while this
 * one still serves, so this one has to run against the database that drop
 * leaves: every table nothing reads or writes gone, and the conversation
 * row's observed-session, event, completion-sweep, and memory-flush columns
 * and the account's workspace-provider preference gone with them. What runs
 * here is each store path that writes a row beside them or cascades through
 * them — the account's preferences and template, a plan and its
 * conversation, a subagent's child conversation and its title, and the
 * account's deletion — and each answers as it did before the drop.
 */

const DEAD_TABLES = [
  "account_workspace_preference",
  "devices",
  "events",
  "introduction_usage",
  "observation_pass",
  "provider_cursors",
  "provider_key",
  "roster_snapshot",
  "transcript_mark",
  "workspace_embedding",
  "workspace_file",
] as const;

const DEAD_COLUMNS = {
  account_preference: ["default_workspace_provider"],
  conversations: [
    "provider_id",
    "provider_session_id",
    "workspace",
    "spawned_by_message_id",
    "next_event_seq",
    "memory_flush_operation_id",
    "memory_flush_outcome",
    "memory_flushed_at",
    "completion_delivered_at",
  ],
} as const;

/** The drop the next deployment's migration makes, made here on the test's own database. */
const dropDeadShape = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const table of DEAD_TABLES) yield* sql`drop table ${sql(table)} cascade`;
  for (const [table, columns] of Object.entries(DEAD_COLUMNS)) {
    for (const column of columns) yield* sql`alter table ${sql(table)} drop column ${sql(column)}`;
  }
});

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const conversationsOf = (userId: string) =>
  db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId));

it.layer(getTestDB())("the store once the dead tables and columns are dropped", (it) => {
  it.effect(
    "preferences, the template, a plan's conversation, a child and its title, and the account's deletion all still run",
    () =>
      Effect.gen(function* () {
        yield* dropDeadShape;
        const userId = yield* openUser;

        yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
        const preferences = yield* readAccountPreferences(userId);
        assert.equal(preferences?.preferences.voice, "cedar");
        yield* writePlanTemplate(userId, "# Our plan\n");
        assert.equal(yield* readPlanTemplate(userId), "# Our plan\n");

        const started = yield* createPlan(userId, { name: "Teammate invitations" });
        const opened = yield* openPlanConversation(userId, started.id);
        assert.ok(Option.isSome(opened));
        const parent = { userId, conversationId: opened.value };

        const child = randomUUID();
        yield* openChildConversation(parent, child, "worker");
        assert.equal(yield* fillChildTitle(parent, child, "Invite flow"), true);
        assert.deepEqual(yield* childTitlesOf(parent, [child]), new Map([[child, "Invite flow"]]));

        assert.equal((yield* conversationsOf(userId)).length, 2);
        yield* deleteAccount(userId);
        assert.deepEqual(yield* conversationsOf(userId), []);
      }),
  );
});
