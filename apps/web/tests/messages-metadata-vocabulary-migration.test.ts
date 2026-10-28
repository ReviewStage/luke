import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import {
  openInboxItem,
  openTaskAgent,
  openWorkspace,
  unmigratedPgliteSqlClient,
} from "@luke/database/testing";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readStoredUIMessages } from "@luke/wire/ui-messages";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * messages-metadata-vocabulary-migration.test.ts -- the migration that rewrites every stored message's metadata in the vocabulary that says only what is true.
 *
 * Over a database migrated up to it, holding a row in each shape an earlier
 * build wrote: once it runs, a user row says what carried it by its channel
 * or source alone, a spoken ask keeps who said it, an agent message names its
 * sender by the row's columns alone, taking the name from its metadata where
 * they held none, a line another agent sent as a typed ask reads as the
 * agent message it is, a member's line on one of the agent's threads written
 * as a typed ask reads as the thread line it is, by its head's lead and key,
 * one naming no thread of the agent's staying as it stands, an assistant row
 * names the model, and every row reads
 * under the write door's own vocabulary; a second run changes nothing.
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261028004039_messages_metadata_vocabulary";

/** A migrations folder holding every migration named before this one, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-vocabulary-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** Each row as an earlier build wrote it, in order, with its words and sender where it kept them; `KEY` stands for the agent's thread's key. */
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

/** Each row as it reads once the migration has run, with its sender and the name it keeps; `ITEM` stands for the agent's thread's id. */
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
        yield* Database.use((db) =>
          db.insert(user).values({ id: "dean", name: "dean", email: "dean@luke.test" }),
        );
        const workspaceId = yield* openWorkspace("dean");
        const agentId = yield* openTaskAgent("dean", workspaceId, null);
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

        yield* runWebMigrations();

        const rows = yield* stored;
        assert.deepEqual(
          rows.map((row) => [row.metadata, row.sender, row.senderName]),
          AFTER.map(([metadata, ...rest]) => [
            metadata.item_id === "ITEM" ? { ...metadata, item_id: itemId } : metadata,
            ...rest,
          ]),
        );
        // The write door's own read refuses any key the vocabulary does not name, so every row is in it.
        const read = yield* readStoredUIMessages(
          unparsedWire(
            rows.map(({ id, role, parts, metadata }) => ({ id, role, parts, metadata })),
          ),
          {},
        );
        assert.equal(read.ok, true);

        // A second run, as a deploy that ran it before recording it would, changes nothing.
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
