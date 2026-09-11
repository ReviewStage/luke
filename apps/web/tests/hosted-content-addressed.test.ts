import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, test } from "vitest";
import { prompts, toolSets } from "../server/db/storage-schema";
import {
  type OfferedToolSchema,
  promptHashOf,
  recordPrompt,
  recordToolSet,
  toolSetHashOf,
} from "../server/hosted/store/content-addressed";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The content-addressed rows over the real migrations on PGlite: a prompt or
 * a tool set written twice is one row, and the hash moves with exactly what
 * the model is offered — the text, the words, the schema, and the order —
 * and with nothing else. Synthetic throughout: no real prompt or session,
 * and every text minted for its own test, since on CI these rows are shared
 * with every other file running against the one Postgres.
 */

const NOW = new Date(1_800_000_000_000);

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const SHA256_HEX_LENGTH = 64;

function schemaNamed(name: string, description = `${name} does one thing`): OfferedToolSchema {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: { words: { type: "string" } }, required: ["words"] },
  };
}

test("the same prompt recorded twice is one row, keyed by the hash of its text", async () => {
  const text = `# Identity\n\nsynthetic prompt ${randomUUID()}`;
  const first = await recordPrompt(database.db, text, NOW);
  const second = await recordPrompt(database.db, text, new Date(NOW.getTime() + 1));

  assert.equal(second, first);
  assert.equal(first, promptHashOf(text));
  assert.equal(first.length, SHA256_HEX_LENGTH);
  const rows = await database.db.select().from(prompts).where(eq(prompts.hash, first));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.text, text);
  assert.equal(rows[0]?.createdAt.getTime(), NOW.getTime());
});

test("a prompt that differs by one character is another row under another hash", async () => {
  const text = `# Identity\n\nsynthetic prompt ${randomUUID()}, first wording`;
  const edited = `${text}.`;
  const [first, second] = await Promise.all([
    recordPrompt(database.db, text, NOW),
    recordPrompt(database.db, edited, NOW),
  ]);

  assert.notEqual(second, first);
  const rows = await database.db
    .select({ hash: prompts.hash })
    .from(prompts)
    .where(eq(prompts.hash, second));
  assert.equal(rows.length, 1);
});

test("the same tool set recorded twice is one row holding the declarations as offered", async () => {
  const offered = [schemaNamed(`list_${randomUUID()}`), schemaNamed("read_transcript")];
  const first = await recordToolSet(database.db, offered, NOW);
  const second = await recordToolSet(database.db, offered, NOW);

  assert.equal(second, first);
  assert.equal(first, toolSetHashOf(offered));
  const rows = await database.db.select().from(toolSets).where(eq(toolSets.hash, first));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.schemas, offered);
});

test("the tool set's hash moves with a tool's words, its schema, its presence, and its order, and with nothing else", () => {
  const base = [schemaNamed("list_sessions"), schemaNamed("read_transcript")];
  const hash = toolSetHashOf(base);

  assert.equal(toolSetHashOf([schemaNamed("list_sessions"), schemaNamed("read_transcript")]), hash);
  assert.notEqual(
    toolSetHashOf([schemaNamed("list_sessions", "reworded"), schemaNamed("read_transcript")]),
    hash,
  );
  assert.notEqual(
    toolSetHashOf([
      { ...schemaNamed("list_sessions"), inputSchema: { type: "object", properties: {} } },
      schemaNamed("read_transcript"),
    ]),
    hash,
  );
  assert.notEqual(toolSetHashOf([schemaNamed("list_sessions")]), hash);
  assert.notEqual(
    toolSetHashOf([schemaNamed("read_transcript"), schemaNamed("list_sessions")]),
    hash,
  );
});
