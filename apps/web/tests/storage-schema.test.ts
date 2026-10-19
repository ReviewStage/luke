import assert from "node:assert/strict";
import { DRIZZLE_MIGRATIONS, EFFECT_MIGRATIONS_TABLE } from "@luke/database/core/migrator";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  countRowsWhere,
  deleteUser,
  insertConversation,
  insertMessage,
  insertTurn,
  openHostedStoreTestDatabase,
} from "@luke/database/testing";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@luke/wire";
import { getColumnTable, getTableName } from "drizzle-orm";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, test } from "vitest";

/**
 * What these tests hold to is the shape the migrations built: every row
 * cascades with its account, a child goes with its parent, the idempotency
 * key refuses the duplicate and admits the neighbour, a fresh conversation
 * numbers its messages from one, a tool set is one row however often it is
 * written, the v1 conversation tables and the briefing table are gone, the
 * per-conversation latest-turn laterals have the indexes they read through,
 * and a child says whether it expects a completion. The migration
 * runner's own bookkeeping table is not one of them: it records which of these
 * tables a database has, and is declared by no schema file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** Every table the migrations declare, by its Postgres name, better-auth's own alongside Luke's. */
const DECLARED_TABLES = [
  "account",
  "account_plan_template_revision",
  "account_preference",
  "account_provider_key",
  "admin_favorite",
  "agent_pin",
  "asks",
  "attachment",
  "automation",
  "automation_run",
  "chat_attachment",
  "chat_channel",
  "chat_member",
  "chat_message",
  "chat_read",
  "coding_agent",
  "coding_agent_delegation",
  "conversation_attachment",
  "conversations",
  "github_connect_intent",
  "github_install_intent",
  "github_installation",
  "hosted_usage",
  "inbox_attachment",
  "inbox_attachment_moved",
  "inbox_item",
  "inbox_item_read",
  "inbox_message",
  "integration_connection",
  "invitation",
  "issue",
  "jwks",
  "mac_command",
  "mac_command_listener",
  "member",
  "messages",
  "oauth_access_token",
  "oauth_client",
  "oauth_client_assertion",
  "oauth_client_resource",
  "oauth_consent",
  "oauth_refresh_token",
  "oauth_resource",
  "organization",
  "personal_workspace",
  "plan_attachment",
  "plan_attachment_moved",
  "plan_comment",
  "plan_comment_thread",
  "plan_page_version",
  "plan_revision",
  "preview_fork",
  "repository_pin",
  "sandbox_terminal_lease",
  "session",
  "session_sandbox_cleanup",
  "task",
  "task_board",
  "task_pin",
  "task_section",
  "task_section_entry",
  "turns",
  "user",
  "verification",
  "voice_avatar_sessions",
  "voice_session_usage",
  "voice_sessions",
  "workspace_chat",
  "voice_transcript_segments",
  "workspace_integration_connection",
].sort();

async function publicTableNames(): Promise<readonly string[]> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select table_name as name from information_schema.tables where table_schema = 'public'
      `;
    }),
  );
  const NameRowSchema = Schema.Struct({ name: Schema.String });
  return rows
    .map((row) => Schema.decodeUnknownSync(NameRowSchema)(row).name)
    .filter((name) => name !== DRIZZLE_MIGRATIONS.TABLE && name !== EFFECT_MIGRATIONS_TABLE)
    .sort();
}

test("the migrations end at the declared schema: every declared table stands, and nothing undeclared, the v1 conversation tables and the briefing table included, remains", async () => {
  assert.deepEqual(await publicTableNames(), DECLARED_TABLES);
});

async function insertTestConversation(
  userId: string,
  row: Omit<Parameters<typeof insertConversation>[1], "userId"> = {},
): Promise<string> {
  return insertConversation(database.run, { ...row, userId });
}

async function insertTestTurn(userId: string, conversationId: string): Promise<string> {
  return insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    responseIds: ["resp_1"],
    usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
  });
}

async function insertTestMessage(
  userId: string,
  conversationId: string,
  row: Partial<Parameters<typeof insertMessage>[1]> = {},
): Promise<string> {
  return insertMessage(database.run, {
    userId,
    conversationId,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "hello" }],
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
    ...row,
  });
}

/** One account's full set of rows: a main conversation with a turn and a message, and a child of it. */
async function populateAccount(userId: string): Promise<{ main: string; child: string }> {
  const main = await insertTestConversation(userId);
  const turnId = await insertTestTurn(userId, main);
  await insertTestMessage(userId, main, { turnId });
  const child = await insertTestConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
  });
  await insertTestTurn(userId, child);
  await insertTestMessage(userId, child, { role: MESSAGE_ROLE.ASSISTANT, metadata: undefined });
  return { main, child };
}

test("every conversation row cascades with its account and no other account's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await populateAccount(userId);
  await populateAccount(other);

  await deleteUser(database.run, userId);

  for (const column of [conversations.userId, messages.userId, turns.userId]) {
    const table = getTableName(getColumnTable(column));
    assert.equal(
      await countRowsWhere(database.run, column, userId),
      0,
      `${table} still holds rows for the deleted user`,
    );
    assert.ok(
      (await countRowsWhere(database.run, column, other)) > 0,
      `${table} lost the other user's rows`,
    );
  }
});
