import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { joinWorkspace, openWorkspace, unmigratedPgliteSqlClient } from "@luke/database/testing";
import { INBOX_MESSAGE_AUTHOR } from "@luke/features/inbox-wire";
import {
  memberOpenAsks,
  readInboxAttachment,
  readInboxItem,
} from "@luke/service/inbox/inbox-store";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * inbox-item-pre-v5-threads-migration.test.ts -- the migration that writes every inbox item from before version 5 as a thread.
 *
 * Over a database migrated up to it, holding items an agent posted before
 * version 5: once it runs, each reads as a thread its agent's message
 * opens, carrying its blocks as Markdown, its picture as that message's
 * file, and the ask its response stood for, open, answered, or withdrawn as
 * the item stood; an answer reads as the member's message answering that
 * ask, with the note as its words; the open ask is the one the operator's
 * read finds; an item the version 4 tool posted after the bump is written
 * the same way; and a second run writes nothing twice. Synthetic accounts
 * throughout.
 */

const MIGRATION = "20261023183614_inbox_item_pre_v5_threads";

/** A PNG's signature and nothing after it: bytes enough for a picture row. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A migrations folder holding every migration named before this one, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-pre-v5-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

const openUser = (id: string) =>
  Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@luke.test` }));

it.effect(
  "an item from before version 5 reads as a thread its agent's message opens, its ask and answer on its messages",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* openUser("dean");
        yield* openUser("charles");
        // The task and its agent are written as the schema of then holds them, since the store writes columns later migrations add.
        const workspaceId = yield* openWorkspace("dean");
        yield* joinWorkspace(workspaceId, "charles");
        const taskId = randomUUID();
        yield* sql`insert into task (id, user_id, organization_id, number, name, document) values (${taskId}, 'dean', ${workspaceId}, 1, 'Teammate invitations', '')`;
        const agent = { id: randomUUID(), conversationId: randomUUID() };
        yield* sql`insert into conversations (id, user_id, kind) values (${agent.conversationId}, 'dean', ${CONVERSATION_KIND.CODING_AGENT})`;
        yield* sql`insert into coding_agent (id, task_id, organization_id, user_id, conversation_id, model, effort, plan_snapshot, repository, idempotency_key)
          values (${agent.id}, ${taskId}, ${workspaceId}, 'dean', ${agent.conversationId}, 'anthropic/claude-opus-5.5', 'high', '# Teammate invitations', 'acme/relay', ${randomUUID()})`;
        const item = (
          key: string,
          status: string,
          blocks: unknown,
          response: unknown,
          rest: {
            readonly answer?: unknown;
            readonly closedReason?: string;
            readonly version?: number;
          } = {},
        ) =>
          Effect.gen(function* () {
            const id = randomUUID();
            const answer = rest.answer === undefined ? null : JSON.stringify(rest.answer);
            yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, blocks, response, needs_reply, status, answer, answer_key, answered_by, closed_reason, posted_at, updated_at)
              values (${id}, 'dean', ${taskId}, ${workspaceId}, ${agent.id}, ${key}, 1, ${rest.version ?? 4}, ${key}, ${JSON.stringify(blocks)}::jsonb, ${JSON.stringify(response)}::jsonb, true, ${status}, ${answer}::jsonb, ${answer === null ? null : randomUUID()}, ${answer === null ? null : "charles"}, ${rest.closedReason ?? null}, '2026-10-17T09:00:00Z', '2026-10-17T10:00:00Z')`;
            return id;
          });
        const pictureId = randomUUID();
        const branch = yield* item(
          "branch-protection",
          "open",
          [
            { type: "markdown", text: "Require a review on `main`." },
            { type: "link", url: "https://github.com/acme/relay/settings", label: "Settings" },
            { type: "image", attachmentId: pictureId, alt: "The [rules] page" },
          ],
          { type: "task" },
        );
        yield* sql`insert into attachment (id, organization_id, user_id, task_id, inbox_item_id, kind, content_type, byte_count, bytes, created_at)
          values (${pictureId}, ${workspaceId}, 'dean', ${taskId}, ${branch}, 'image', 'image/png', ${PNG.length}, ${PNG}, '2026-10-17T09:00:00Z')`;
        const copy = yield* item(
          "invite-copy",
          "answered",
          [{ type: "markdown", text: "Which subject line?" }],
          { type: "choice", options: [{ label: "Join us" }, { label: "You're invited" }] },
          { answer: { reply: "chose", choices: ["Join us"], note: "Shorter reads better." } },
        );
        const deploy = yield* item(
          "deploy",
          "closed",
          [{ type: "markdown", text: "Deploy the preview?" }],
          { type: "approval" },
          { closedReason: "Deployed it myself." },
        );
        // The version 4 tool still posted for a while after the bump: version 5, its question in its blocks, its thread asking nothing.
        const rollback = yield* item(
          "rollback",
          "answered",
          [{ type: "markdown", text: "Roll back the migration?" }],
          { type: "approval" },
          { answer: { reply: "approved" }, version: 5 },
        );

        yield* runWebMigrations();
        yield* sql`delete from __drizzle_migrations where name = ${MIGRATION}`;
        yield* runWebMigrations();

        const read = (itemId: string) =>
          Effect.map(readInboxItem("dean", itemId), (found) => Option.getOrThrow(found).item);
        const [{ slug }] = yield* sql<{
          readonly slug: string;
        }>`select slug from organization where id = ${workspaceId}`;
        const address = `https://tryluke.dev/${slug}/plan/${taskId}/inbox/${branch}/files/${pictureId}`;
        const opened = yield* read(branch);
        assert.deepEqual(
          opened.thread?.map(({ author, text, files, ask }) => ({ author, text, files, ask })),
          [
            {
              author: INBOX_MESSAGE_AUTHOR.AGENT,
              text: `Require a review on \`main\`.\n\n[Settings](https://github.com/acme/relay/settings)\n\n![The \\[rules\\] page](${address})`,
              files: [{ attachmentId: pictureId, name: "picture-1.png", mediaType: "image/png" }],
              ask: { type: "do", steps: [], status: "open" },
            },
          ],
        );
        assert.equal(opened.version, 5);
        assert.ok(Option.isSome(yield* readInboxAttachment("dean", branch, pictureId)));

        const answered = yield* read(copy);
        const [asked, answer] = answered.thread ?? [];
        assert.deepEqual(
          [asked?.ask, answer?.author, answer?.member?.userId, answer?.text, answer?.answers],
          [
            {
              type: "decide",
              options: [{ label: "Join us" }, { label: "You're invited" }],
              status: "answered",
            },
            INBOX_MESSAGE_AUTHOR.MEMBER,
            "charles",
            "Shorter reads better.",
            { ask: asked?.id, reply: "chose", choices: ["Join us"] },
          ],
        );

        const withdrawn = yield* read(deploy);
        assert.deepEqual(withdrawn.thread?.[0]?.ask, {
          type: "decide",
          options: [{ label: "Approve" }, { label: "Decline" }],
          status: "withdrawn",
          withdrawnReason: "Deployed it myself.",
        });

        const approved = yield* read(rollback);
        const [posted, approval] = approved.thread ?? [];
        assert.deepEqual(
          [posted?.text, posted?.ask?.status, approval?.answers],
          [
            "Roll back the migration?",
            "answered",
            { ask: posted?.id, reply: "chose", choices: ["Approve"] },
          ],
        );

        const waiting = yield* memberOpenAsks("dean", workspaceId, 10);
        assert.deepEqual(
          waiting.map(({ id, askType }) => ({ id, askType })),
          [{ id: branch, askType: "do" }],
        );
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
