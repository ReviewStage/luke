import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  type JournalEntry,
  runWebMigrations,
  webMigrationJournal,
} from "@sidecar/database/core/migrator";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { conversations } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { unmigratedPgliteSqlClient } from "@sidecar/database/testing";
import { INBOX_BLOCK, INBOX_REPLY, INBOX_RESPONSE, INBOX_STATUS } from "@sidecar/hosted/inbox-wire";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { answerInboxItem, planInboxItems, postInboxItem } from "../server/hosted/inbox-store";

/**
 * Migration 0088 moves every inbox item from the fixed kinds, a kind, a
 * Markdown details field, a choice's options and recommendation, to blocks
 * and a response under version 2, and an answer's one choice to its
 * choices. The database is migrated to the entry before it, rows are
 * written in the old shape as the deployment before it wrote them, and the
 * migration is applied over them, so what the store then reads is what the
 * old rows meant and an old item still takes its answer. The deployment
 * before it still serves while it migrates and still writes the old shape,
 * so a row that deployment writes afterwards, naming the old columns and
 * none of the new, is filled the same way as it lands, and an answer it
 * writes with one choice reads as choices. A row this deployment writes is
 * projected back onto the old columns the same way, so that deployment
 * reads an approval as an approval and a choice with its options rather
 * than every new item as a question.
 *
 * Synthetic accounts, plans, and words throughout.
 */

/** The migration under test, and the one the database stands at before it. */
const MIGRATION = "0088_inbox_item_blocks";
const BEFORE = "0087_account_plan_template";

/** The vocabulary version the migration converts every row to and stamps it with: blocks and a response, before any later block type. */
const BLOCKS_VERSION = 2;

const JOURNAL_FILE = ["meta", "_journal.json"] as const;

/** The real folder's migrations and journal, copied into a folder of the test's own whose journal ends where the test says. */
const migrationsThrough = (tag: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const source = path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "database",
      "migrations",
    );
    const folder = yield* fileSystem.makeTempDirectoryScoped();
    yield* fileSystem.makeDirectory(path.join(folder, JOURNAL_FILE[0]));
    const entries = yield* webMigrationJournal(source);
    yield* Effect.forEach(entries, (entry) =>
      fileSystem.copyFile(
        path.join(source, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      ),
    );
    const journal = (through: string) => {
      const end = entries.findIndex((entry) => entry.tag === through);
      assert.notEqual(end, -1, `no migration ${through}`);
      const named: ReadonlyArray<JournalEntry> = entries.slice(0, end + 1);
      return fileSystem.writeFileString(
        path.join(folder, ...JOURNAL_FILE),
        JSON.stringify({ version: "7", dialect: "postgresql", entries: named }),
      );
    };
    yield* journal(tag);
    const latest = entries.at(-1)?.tag ?? tag;
    return { folder, journal, latest };
  });

/**
 * An account with one plan and one agent. The agent's row is written naming
 * only the columns it had before 0088, as the deployment before it wrote
 * one, since the store's own Start names every column a later migration
 * added and the database here stands before those.
 */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const planId = randomUUID();
  const sql = yield* SqlClient.SqlClient;
  // The plan is written by hand too, since the store's own start names the workspace a later migration added.
  yield* sql`insert into plan (id, user_id, name, document) values (${planId}, ${userId}, ${"Teammate invitations"}, ${""})`;
  const conversationId = randomUUID();
  yield* db
    .insert(conversations)
    .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
  const agentId = randomUUID();
  yield* sql`
    insert into coding_agent (id, plan_id, user_id, conversation_id, model, effort, plan_snapshot, repository, idempotency_key)
    values (${agentId}, ${planId}, ${userId}, ${conversationId}, 'anthropic/claude-opus-5.5', 'high', '# Teammate invitations', 'acme/relay', ${randomUUID()})
  `;
  return { userId, planId, agentId };
});

/** An item in the shape the deployment before 0088 wrote it. */
interface OldRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly details: string | null;
  readonly options: string | null;
  readonly recommended: string | null;
  readonly status: string;
  readonly answer: string | null;
}

/** One row written as the deployment before 0088 wrote it, naming its columns and none of 0088's. */
function writeOldRow(agent: { userId: string; planId: string; agentId: string }, row: OldRow) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into inbox_item (user_id, plan_id, agent_id, key, revision, kind, title, details, options, recommended, needs_reply, status, answer, answer_key, posted_at, updated_at)
      values (${agent.userId}, ${agent.planId}, ${agent.agentId}, ${row.key}, 1, ${row.kind}, ${row.title}, ${row.details}, ${row.options}::jsonb, ${row.recommended}, true, ${row.status}, ${row.answer}::jsonb, ${row.answer === null ? null : randomUUID()}, now(), now())
    `;
  });
}

const OLD_ROWS: readonly OldRow[] = [
  {
    key: "invite-queue",
    kind: "choice",
    title: "Which queue sends the invitation emails?",
    details: "The repo already runs **Postgres**.",
    options: JSON.stringify([
      { label: "Postgres outbox", detail: "No new service." },
      { label: "Redis" },
    ]),
    recommended: "Postgres outbox",
    status: "open",
    answer: null,
  },
  {
    key: "branch-protection",
    kind: "task",
    title: "Require a review on main",
    details: null,
    options: null,
    recommended: null,
    status: "open",
    answer: null,
  },
  {
    key: "invite-copy",
    kind: "question",
    title: "What should the email say?",
    details: "  ",
    options: null,
    recommended: null,
    status: "open",
    answer: null,
  },
  {
    key: "ship",
    kind: "approval",
    title: "Ship it?",
    details: "Two files.",
    options: null,
    recommended: null,
    status: "answered",
    answer: JSON.stringify({ reply: "chose", choice: "Redis", note: "Fine." }),
  },
];

/** A choice as this deployment posts one, under a key the old rows hold, which replaces that row. */
const NEW_CHOICE = {
  title: "Which queue, now?",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Which one?" }],
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres outbox" }, { label: "Redis" }],
    recommended: "Redis",
  },
} as const;

it.effect(
  "every item written before 0088 reads after it as the blocks and the response it meant, its answer's choice as its choices, and still takes its answer; a row written and answered in the old shape after it reads the same way, and a row written in the new shape is projected onto the old columns",
  () =>
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const { folder, journal, latest } = yield* migrationsThrough(BEFORE);
          yield* runWebMigrations(folder);
          const agent = yield* openAgent;
          yield* Effect.forEach(OLD_ROWS, (row) => writeOldRow(agent, row));

          yield* journal(MIGRATION);
          const applied = yield* runWebMigrations(folder);
          assert.deepEqual(
            applied.map(([, name]) => name),
            [MIGRATION],
          );

          const items = yield* planInboxItems(agent.userId, agent.planId);
          assert.ok(items.every((item) => item.version === BLOCKS_VERSION));
          const byKey = new Map(items.map((item) => [item.key, item]));
          assert.deepEqual(byKey.get("invite-queue")?.blocks, [
            { type: INBOX_BLOCK.MARKDOWN, text: "The repo already runs **Postgres**." },
          ]);
          assert.deepEqual(byKey.get("invite-queue")?.response, {
            type: INBOX_RESPONSE.CHOICE,
            options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
            recommended: "Postgres outbox",
          });
          assert.deepEqual(byKey.get("branch-protection")?.blocks, []);
          assert.deepEqual(byKey.get("branch-protection")?.response, { type: INBOX_RESPONSE.TASK });
          assert.deepEqual(byKey.get("invite-copy")?.blocks, [], "blank details are no block");
          assert.deepEqual(byKey.get("invite-copy")?.response, { type: INBOX_RESPONSE.TEXT });
          assert.deepEqual(byKey.get("ship")?.response, { type: INBOX_RESPONSE.APPROVAL });
          assert.deepEqual(byKey.get("ship")?.answer, {
            reply: INBOX_REPLY.CHOSE,
            choices: ["Redis"],
            note: "Fine.",
          });

          const queue = byKey.get("invite-queue");
          assert.ok(queue);
          const taken = yield* answerInboxItem(
            agent.userId,
            queue.id,
            queue.revision,
            { reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
            randomUUID(),
          );
          assert.equal(Option.getOrUndefined(taken)?.status, INBOX_STATUS.ANSWERED);

          // The deployment before 0088 still serves while it migrates, and still writes the old shape.
          yield* writeOldRow(agent, {
            key: "late",
            kind: "task",
            title: "Written by the old deployment",
            details: "Still taken.",
            options: null,
            recommended: null,
            status: "open",
            answer: null,
          });
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            update inbox_item set status = 'answered', answer = ${JSON.stringify({ reply: "chose", choice: "Postgres outbox" })}::jsonb, answer_key = ${randomUUID()}
            where agent_id = ${agent.agentId} and key = 'late'
          `;
          const late = (yield* planInboxItems(agent.userId, agent.planId)).find(
            (item) => item.key === "late",
          );
          assert.equal(late?.version, BLOCKS_VERSION);
          assert.deepEqual(late?.blocks, [{ type: INBOX_BLOCK.MARKDOWN, text: "Still taken." }]);
          assert.deepEqual(late?.response, { type: INBOX_RESPONSE.TASK });
          assert.deepEqual(late?.answer, {
            reply: INBOX_REPLY.CHOSE,
            choices: ["Postgres outbox"],
          });

          // What this deployment writes, it writes on a database its every migration ran on,
          // and the deployment before it reads through the old columns.
          yield* journal(latest);
          yield* runWebMigrations(folder);
          yield* postInboxItem(agent, {
            key: "ship",
            title: "Ship it?",
            blocks: [
              { type: INBOX_BLOCK.MARKDOWN, text: "Two files." },
              {
                type: INBOX_BLOCK.LINK,
                url: "https://github.com/acme/relay/pull/7",
                label: "The PR",
              },
            ],
            response: { type: INBOX_RESPONSE.APPROVAL },
          });
          yield* postInboxItem(agent, { ...NEW_CHOICE, key: "invite-queue" });
          const legacy = yield* sql<{
            key: string;
            kind: string;
            details: string | null;
            options: unknown;
            recommended: string | null;
          }>`
            select key, kind, details, options, recommended from inbox_item
            where agent_id = ${agent.agentId} and key in ('ship', 'invite-queue') order by key
          `;
          assert.deepEqual(legacy, [
            {
              key: "invite-queue",
              kind: "choice",
              details: "Which one?",
              options: [{ label: "Postgres outbox" }, { label: "Redis" }],
              recommended: "Redis",
            },
            {
              key: "ship",
              kind: "approval",
              details: "Two files.\n\nThe PR: https://github.com/acme/relay/pull/7",
              options: null,
              recommended: null,
            },
          ]);
        }),
      ),
      Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer),
    ),
);
