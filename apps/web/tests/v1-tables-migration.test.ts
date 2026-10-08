import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Schema } from "effect";
import { test } from "vitest";

/**
 * Migration 0057 runs on a production database that still holds what earlier
 * builds wrote, so it is held here to that database rather than to a fresh
 * one: every conversation of a kind this build never opens goes with its
 * messages, turns, and asks while a plan's conversation keeps all of its
 * own; the retired mobile client goes with its tokens and consents while the
 * desktop's keep theirs; and the rows of the dropped tables and columns stand
 * in no way of the drop. The shape it leaves is `storage-schema.test.ts`'s
 * and `drizzle-schema.test.ts`'s to hold.
 */

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const V1_TABLES_MIGRATION = "0057_drop_v1_tables";

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int, tag: Schema.String })),
});
type JournalEntry = Schema.Schema.Type<typeof Journal>["entries"][number];

const decodeJournal = Schema.decodeUnknownSync(Schema.fromJsonString(Journal));

async function journal(): Promise<readonly JournalEntry[]> {
  return decodeJournal(await readFile(`${MIGRATIONS}/meta/_journal.json`, "utf8")).entries;
}

async function apply(client: PGlite, entry: JournalEntry): Promise<void> {
  await client.exec(await readFile(`${MIGRATIONS}/${entry.tag}.sql`, "utf8"));
}

const CONVERSATION = {
  PLAN: "00000000-0000-4000-8000-000000000001",
  MAIN: "00000000-0000-4000-8000-000000000002",
  OBSERVED: "00000000-0000-4000-8000-000000000003",
  CHILD: "00000000-0000-4000-8000-000000000004",
} as const;

const TURN = {
  PLAN: "00000000-0000-4000-8000-0000000000a1",
  MAIN: "00000000-0000-4000-8000-0000000000a2",
  OBSERVED: "00000000-0000-4000-8000-0000000000a3",
  CHILD: "00000000-0000-4000-8000-0000000000a4",
} as const;

const MESSAGE = {
  PLAN: "00000000-0000-4000-8000-0000000000b1",
  MAIN: "00000000-0000-4000-8000-0000000000b2",
  OBSERVED: "00000000-0000-4000-8000-0000000000b3",
} as const;

const PLAN_ID = "00000000-0000-4000-8000-0000000000c1";

/** One account as an earlier build left it: a plan, the v1 conversations, and a row in every table the migration drops. */
const EARLIER_BUILD_ROWS = `
  insert into "user" (id, name, email) values ('user-a', 'A', 'a@luke.test');
  insert into oauth_client (id, client_id, redirect_uris) values
    ('client-desktop', 'luke-desktop', array['http://127.0.0.1/callback']),
    ('client-mobile', 'luke-mobile', array['luke://callback']);
  insert into oauth_refresh_token (id, token, client_id, user_id, scopes) values
    ('refresh-desktop', 'refresh-token-desktop', 'luke-desktop', 'user-a', array['openid']),
    ('refresh-mobile', 'refresh-token-mobile', 'luke-mobile', 'user-a', array['openid']);
  insert into oauth_access_token (id, token, client_id, user_id, refresh_id, scopes) values
    ('access-desktop', 'access-token-desktop', 'luke-desktop', 'user-a', 'refresh-desktop', array['openid']),
    ('access-mobile', 'access-token-mobile', 'luke-mobile', 'user-a', 'refresh-mobile', array['openid']),
    ('access-mobile-alone', 'access-token-mobile-alone', 'luke-mobile', 'user-a', null, array['openid']);
  insert into oauth_consent (id, client_id, user_id, scopes) values
    ('consent-desktop', 'luke-desktop', 'user-a', array['openid']),
    ('consent-mobile', 'luke-mobile', 'user-a', array['openid']);
  insert into conversations (id, user_id, kind) values
    ('${CONVERSATION.PLAN}', 'user-a', 'plan'),
    ('${CONVERSATION.MAIN}', 'user-a', 'main');
  insert into conversations (id, user_id, kind, provider_id, provider_session_id, title, workspace) values
    ('${CONVERSATION.OBSERVED}', 'user-a', 'observed', 'conductor', 'session-1', 'Fix the build', 'luke');
  insert into turns (id, user_id, conversation_id, origin, status) values
    ('${TURN.PLAN}', 'user-a', '${CONVERSATION.PLAN}', 'spoken', 'settled'),
    ('${TURN.MAIN}', 'user-a', '${CONVERSATION.MAIN}', 'typed', 'settled'),
    ('${TURN.OBSERVED}', 'user-a', '${CONVERSATION.OBSERVED}', 'transcript_change', 'settled');
  insert into messages (id, user_id, conversation_id, seq, turn_id, client_id, role, parts, placed_at) values
    ('${MESSAGE.PLAN}', 'user-a', '${CONVERSATION.PLAN}', 1, '${TURN.PLAN}', 'plan-1', 'user', '[]', now()),
    ('${MESSAGE.MAIN}', 'user-a', '${CONVERSATION.MAIN}', 1, '${TURN.MAIN}', 'main-1', 'user', '[]', now()),
    ('${MESSAGE.OBSERVED}', 'user-a', '${CONVERSATION.OBSERVED}', 1, '${TURN.OBSERVED}', 'observed-1', 'user', '[]', now());
  insert into conversations (id, user_id, kind, parent_conversation_id, spawned_by_message_id, label) values
    ('${CONVERSATION.CHILD}', 'user-a', 'child', '${CONVERSATION.MAIN}', '${MESSAGE.MAIN}', 'helper');
  insert into turns (id, user_id, conversation_id, origin, status, cancel_requested_at) values
    ('${TURN.CHILD}', 'user-a', '${CONVERSATION.CHILD}', 'child', 'settled', now());
  insert into asks (user_id, conversation_id, client_id, origin, cancel_requested_at) values
    ('user-a', '${CONVERSATION.PLAN}', 'plan-ask', 'spoken', null),
    ('user-a', '${CONVERSATION.MAIN}', 'main-ask', 'typed', now());
  insert into events (user_id, conversation_id, seq, message_id, kind, device_id) values
    ('user-a', '${CONVERSATION.MAIN}', 1, '${MESSAGE.MAIN}', 'speech.claimed', 'device-1');
  insert into plan (id, user_id, name, conversation_id) values
    ('${PLAN_ID}', 'user-a', 'Ship it', '${CONVERSATION.PLAN}');
  insert into provider_cursors (user_id, provider_id, provider_session_id, cursor) values
    ('user-a', 'conductor', 'session-1', 'after-1');
  insert into devices (id, user_id, installation_id, platform) values
    ('device-1', 'user-a', 'installation-1', 'ios');
  insert into roster_snapshot (user_id, sealed_body, observed_at) values ('user-a', 'sealed', 1);
  insert into transcript_mark (user_id, mark, updated_at) values ('user-a', 1, now());
  insert into observation_pass (user_id, attempted_at) values ('user-a', 1);
  insert into provider_key (user_id, provider_id, ciphertext) values ('user-a', 'conductor', 'sealed');
  insert into workspace_file (user_id, path, content, created_at, updated_at) values ('user-a', 'USER.md', 'notes', 1, 1);
  insert into workspace_embedding (user_id, hash, model, embedding, created_at) values ('user-a', 'hash', 'model', '[1, 2]', 1);
  insert into introduction_usage (caller, day, mints) values ('global', '2026-10-01', 3);
  insert into account_preference (user_id, voice, default_workspace_provider) values ('user-a', 'marin', 'conductor');
  insert into account_workspace_preference (user_id, provider_id) values ('user-a', 'conductor');
  insert into voice_sessions (user_id, device_id, plan_id, live_session_id, delegation_mode) values
    ('user-a', 'device-1', '${PLAN_ID}', 'live-1', 'client');
`;

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The ids one query answers, in the order it answered them. */
async function ids(client: PGlite, query: string): Promise<readonly string[]> {
  const result = await client.query(query);
  return result.rows.map((row) => Schema.decodeUnknownSync(IdRowSchema)(row).id);
}

test("migration 0057 keeps a plan's conversation whole and the desktop's sign-in, and takes every other conversation and the mobile client with what hangs from them", async () => {
  const client = new PGlite();
  const entries = await journal();
  const migration = entries.find((entry) => entry.tag === V1_TABLES_MIGRATION);
  assert.ok(migration);
  for (const entry of entries.filter((entry) => entry.idx < migration.idx)) {
    await apply(client, entry);
  }
  await client.exec(EARLIER_BUILD_ROWS);

  await apply(client, migration);

  assert.deepEqual(await ids(client, "select id from conversations order by id"), [
    CONVERSATION.PLAN,
  ]);
  assert.deepEqual(await ids(client, "select id from turns order by id"), [TURN.PLAN]);
  assert.deepEqual(await ids(client, "select id from messages order by id"), [MESSAGE.PLAN]);
  assert.deepEqual(await ids(client, "select client_id as id from asks order by client_id"), [
    "plan-ask",
  ]);
  assert.deepEqual(await ids(client, "select conversation_id as id from plan"), [
    CONVERSATION.PLAN,
  ]);
  assert.deepEqual(await ids(client, "select live_session_id as id from voice_sessions"), [
    "live-1",
  ]);
  assert.deepEqual(await ids(client, "select voice as id from account_preference"), ["marin"]);
  assert.deepEqual(await ids(client, "select client_id as id from oauth_client"), ["luke-desktop"]);
  assert.deepEqual(await ids(client, "select id from oauth_refresh_token"), ["refresh-desktop"]);
  assert.deepEqual(await ids(client, "select id from oauth_access_token"), ["access-desktop"]);
  assert.deepEqual(await ids(client, "select id from oauth_consent"), ["consent-desktop"]);
  await client.close();
});
