import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import {
  openInboxItem,
  openWorkspace,
  RENAME_AGENT_TABLES,
  unmigratedPgliteSqlClient,
} from "@repo/database/testing";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readStoredUIMessages } from "@repo/wire/ui-messages";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const MIGRATION = "20261028004039_messages_metadata_vocabulary";
const STRAGGLERS = "20261028182547_messages_metadata_vocabulary_stragglers";

const foldersBefore = foldersUpTo(MIGRATION);

function foldersUpTo(last: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-vocabulary-" });
    const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
      (name) => name.localeCompare(last) < 0,
    );
    for (const name of names) {
      yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
    }
    return folder;
  });
}

const openEarlierAgent = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, 'dean', 'coding_agent')`;
    yield* sql`insert into coding_agent (id, organization_id, user_id, conversation_id, model, effort, idempotency_key)
      values (${id}, ${workspaceId}, 'dean', ${conversationId}, 'anthropic/claude-opus-5.5', 'high', ${randomUUID()})`;
    return id;
  });

const BEFORE = [
  { role: "user", metadata: { author: "developer", channel: "typed" } },
  { role: "assistant", metadata: { author: "brain" } },
  {
    role: "user",
    metadata: { author: "agent", channel: "agent_message", from: "Invite emails" },
    sender: "agent",
    senderName: "Invite emails",
  },
  {
    role: "user",
    metadata: { author: "agent", channel: "agent_message", from: "Release notes" },
  },
  {
    role: "user",
    metadata: { author: "developer", channel: "typed" },
    sender: "agent",
    senderName: "Billing",
  },
  {
    role: "user",
    metadata: { author: "developer", channel: "thread", event: "message", item_id: "item-1" },
    sender: "member",
  },
  { role: "user", metadata: { author: "voice_model", channel: "voice", voice_session_id: "vs-1" } },
  { role: "assistant", metadata: { author: "voice_model", channel: "voice" } },
  { role: "user", metadata: { author: "brain", source: "child" } },
  { role: "user", metadata: { author: "brain", source: "transcript_change" } },
  {
    role: "user",
    metadata: { author: "developer", channel: "typed" },
    text: 'Thread answer on "Which base?" (key KEY):\n\nApprove',
    sender: "member",
  },
  {
    role: "user",
    metadata: { author: "developer", channel: "typed" },
    text: 'Inbox message on "Which base?" (key KEY):\n\nMain, yes.',
    sender: "member",
  },
  {
    role: "user",
    metadata: { author: "developer", channel: "typed" },
    text: 'Thread closed on "Which base?" (key another-thread):',
    sender: "member",
  },
] as const;

const AFTER: readonly (readonly [
  Readonly<Record<string, string>>,
  string | null,
  string | null,
])[] = [
  [{ channel: "typed" }, null, null],
  [{ author: "model" }, null, null],
  [{ channel: "agent_message" }, "agent", "Invite emails"],
  [{ channel: "agent_message" }, "agent", "Release notes"],
  [{ channel: "agent_message" }, "agent", "Billing"],
  [{ channel: "thread", event: "message", item_id: "item-1" }, "member", null],
  [{ author: "voice_model", channel: "voice", voice_session_id: "vs-1" }, null, null],
  [{ author: "voice_model", channel: "voice" }, null, null],
  [{ source: "child" }, null, null],
  [{ source: "transcript_change" }, null, null],
  [{ channel: "thread", event: "answer", item_id: "ITEM" }, "member", null],
  [{ channel: "thread", event: "message", item_id: "ITEM" }, "member", null],
  [{ channel: "typed" }, "member", null],
];

it.effect(
  "every message's metadata is rewritten in the vocabulary that says only what is true, its sender kept in its columns",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;
        const workspaceId = yield* openWorkspace("dean");
        const agentId = yield* openEarlierAgent(workspaceId);
        const itemId = yield* openInboxItem("dean", workspaceId, null, agentId, true);
        const [thread] = yield* sql<{
          readonly key: string;
        }>`select key from inbox_item where id = ${itemId}`;
        const [agent] = yield* sql<{
          readonly conversationId: string;
        }>`select conversation_id as "conversationId" from coding_agent where id = ${agentId}`;
        const key = thread?.key ?? assert.fail("the thread was not written");
        const conversationId = agent?.conversationId ?? assert.fail("the agent was not written");
        for (const [seq, row] of BEFORE.entries()) {
          const text = "text" in row ? row.text.replace("KEY", key) : "Rebase before you push.";
          const sender = "sender" in row ? row.sender : null;
          const senderName = "senderName" in row ? row.senderName : null;
          yield* sql`insert into messages (user_id, conversation_id, seq, client_id, role, parts, metadata, placed_at, sender, sender_name)
            values ('dean', ${conversationId}, ${seq}, ${`row-${seq}`}, ${row.role}, ${JSON.stringify([{ type: "text", text }])}::jsonb, ${JSON.stringify(row.metadata)}::jsonb, now(), ${sender}, ${senderName})`;
        }
        const stored = sql<{
          readonly id: string;
          readonly role: string;
          readonly parts: WireBoundaryInput;
          readonly metadata: WireBoundaryInput;
          readonly sender: string | null;
          readonly senderName: string | null;
        }>`select id, role, parts, metadata, sender, sender_name as "senderName" from messages where conversation_id = ${conversationId} order by seq`;

        yield* runWebMigrations(yield* foldersUpTo(RENAME_AGENT_TABLES));

        const rows = yield* stored;
        assert.deepEqual(
          rows.map((row) => [row.metadata, row.sender, row.senderName]),
          AFTER.map(([metadata, ...rest]) => [
            metadata.item_id === "ITEM" ? { ...metadata, item_id: itemId } : metadata,
            ...rest,
          ]),
        );
        const read = yield* readStoredUIMessages(
          unparsedWire(
            rows.map(({ id, role, parts, metadata }) => ({ id, role, parts, metadata })),
          ),
          {},
        );
        assert.equal(read.ok, true);

        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const statements = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
        )).split("--> statement-breakpoint");
        for (const statement of statements) yield* sql.unsafe(statement);
        assert.deepEqual(yield* stored, rows);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);

const STRAGGLERS_BEFORE = [
  {
    role: "user",
    metadata: { author: "agent", channel: "agent_message", from: "Invite emails" },
  },
  {
    role: "user",
    metadata: { author: "agent", channel: "agent_message", from: "Release notes" },
    sender: "agent",
    senderName: "Release notes",
  },
  { role: "assistant", metadata: { author: "brain" } },
  { role: "user", metadata: { author: "developer", channel: "typed" } },
  {
    role: "user",
    metadata: {
      author: "developer",
      channel: "github",
      event: "comment",
      repository: "acme/app",
      url: "https://github.com/acme/app/pull/1",
      by: "reviewer",
    },
  },
  { role: "user", metadata: { author: "developer", channel: "start", brief: "prompt" } },
  { role: "user", metadata: { author: "developer", channel: "luke" } },
  { role: "user", metadata: { author: "voice_model", channel: "voice", voice_session_id: "vs-1" } },
  { role: "assistant", metadata: { author: "model" } },
] as const;

const STRAGGLERS_AFTER: readonly (readonly [
  Readonly<Record<string, string>>,
  string | null,
  string | null,
])[] = [
  [{ channel: "agent_message" }, "agent", "Invite emails"],
  [{ channel: "agent_message" }, "agent", "Release notes"],
  [{ author: "model" }, null, null],
  [{ channel: "typed" }, null, null],
  [
    {
      channel: "github",
      event: "comment",
      repository: "acme/app",
      url: "https://github.com/acme/app/pull/1",
      by: "reviewer",
    },
    null,
    null,
  ],
  [{ channel: "start", brief: "prompt" }, null, null],
  [{ channel: "luke" }, null, null],
  [{ author: "voice_model", channel: "voice", voice_session_id: "vs-1" }, null, null],
  [{ author: "model" }, null, null],
];

it.effect(
  "a row a release serving beside the vocabulary migration wrote in the old shape is rewritten, its sender kept in its columns",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersUpTo(STRAGGLERS));
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;
        const workspaceId = yield* openWorkspace("dean");
        const agentId = yield* openEarlierAgent(workspaceId);
        const [agent] = yield* sql<{
          readonly conversationId: string;
        }>`select conversation_id as "conversationId" from coding_agent where id = ${agentId}`;
        const conversationId = agent?.conversationId ?? assert.fail("the agent was not written");
        for (const [seq, row] of STRAGGLERS_BEFORE.entries()) {
          const sender = "sender" in row ? row.sender : null;
          const senderName = "senderName" in row ? row.senderName : null;
          yield* sql`insert into messages (user_id, conversation_id, seq, client_id, role, parts, metadata, placed_at, sender, sender_name)
            values ('dean', ${conversationId}, ${seq}, ${`row-${seq}`}, ${row.role}, ${JSON.stringify([{ type: "text", text: "Rebase before you push." }])}::jsonb, ${JSON.stringify(row.metadata)}::jsonb, now(), ${sender}, ${senderName})`;
        }
        const stored = sql<{
          readonly id: string;
          readonly role: string;
          readonly parts: WireBoundaryInput;
          readonly metadata: WireBoundaryInput;
          readonly sender: string | null;
          readonly senderName: string | null;
        }>`select id, role, parts, metadata, sender, sender_name as "senderName" from messages where conversation_id = ${conversationId} order by seq`;

        yield* runWebMigrations(yield* foldersUpTo(RENAME_AGENT_TABLES));

        const rows = yield* stored;
        assert.deepEqual(
          rows.map((row) => [row.metadata, row.sender, row.senderName]),
          STRAGGLERS_AFTER,
        );
        const read = yield* readStoredUIMessages(
          unparsedWire(
            rows.map(({ id, role, parts, metadata }) => ({ id, role, parts, metadata })),
          ),
          {},
        );
        assert.equal(read.ok, true);

        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const statements = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, STRAGGLERS, "migration.sql"),
        )).split("--> statement-breakpoint");
        for (const statement of statements) yield* sql.unsafe(statement);
        assert.deepEqual(yield* stored, rows);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
