import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  type OfferedToolSchema,
  promptHashOf,
  toolSetHashOf,
} from "../server/hosted/store/content-addressed";

/**
 * The content addresses a turn row carries: a prompt is a hash and nothing
 * stored, and each hash moves with exactly what the model is offered — the
 * text, the words, the schema, and the order — and with nothing else.
 * Synthetic throughout: no real prompt or session, and every text minted for
 * its own test.
 */

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
