import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Schema } from "effect";
import { emitJsonSchema } from "../effect/json-schema.js";

/**
 * The JSON Schema a model is shown, recorded. These bytes are prompt-cache
 * bytes: a model provider keys its cache on the text of the request, so a
 * reordered key or a widened bound costs every conversation its prefix. Only
 * a schema a model is shown, as a tool's input, is recorded; nothing sorts the
 * keys, because their order is part of what is being held still.
 */

/** Records the schemas instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

/** The `fixtures/json-schema` directory of the package a test file sits in. */
export function jsonSchemaGoldenRoot(moduleUrl: string): string {
  return path.join(fileURLToPath(moduleUrl), "../../fixtures/json-schema");
}

/** Compares the JSON Schema one schema emits with the recorded bytes, or records it. */
export async function settleJsonSchemaGolden(
  root: string,
  name: string,
  schema: Schema.Top,
): Promise<void> {
  const filePath = path.join(root, `${name}.json`);
  const emitted = `${JSON.stringify(emitJsonSchema(schema), undefined, 2)}\n`;
  if (UPDATE_FIXTURES) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, emitted);
    return;
  }
  const held = await fs.readFile(filePath, "utf8").catch(() => undefined);
  assert.ok(held !== undefined, `no JSON Schema recorded at ${filePath}`);
  assert.equal(emitted, held);
}
