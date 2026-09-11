import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { afterAll, test } from "vitest";
import {
  type OfferedToolSchema,
  promptHashOf,
  recordToolSet,
  toolSetHashOf,
} from "../server/hosted/store/content-addressed";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const readToolSetRows = (hash: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql`select hash, schemas from tool_sets where hash = ${hash}`;
  });

/**
 * The content addresses over the real migrations on PGlite: a prompt is a
 * hash and nothing stored, a tool set written twice is one row, and each
 * hash moves with exactly what the model is offered — the text, the words,
 * the schema, and the order — and with nothing else. Synthetic throughout:
 * no real prompt or session, and every text minted for its own test, since
 * on CI these rows are shared with every other file running against the one
 * Postgres.
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

test("the same prompt text is one hash whenever it is taken, and one character apart is another", () => {
  const text = `# Identity\n\nsynthetic prompt ${randomUUID()}`;
  const hash = promptHashOf(text);

  assert.equal(promptHashOf(text), hash);
  assert.equal(hash.length, SHA256_HEX_LENGTH);
  assert.notEqual(promptHashOf(`${text}.`), hash);
});

test("the same tool set recorded twice is one row holding the declarations as offered", async () => {
  const offered = [schemaNamed(`list_${randomUUID()}`), schemaNamed("read_transcript")];
  const first = await database.run(recordToolSet(offered, NOW));
  const second = await database.run(recordToolSet(offered, NOW));

  assert.equal(second, first);
  assert.equal(first, toolSetHashOf(offered));
  const rows = await database.run(readToolSetRows(first));
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
