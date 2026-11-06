import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Schema } from "effect";
import { emitJsonSchema } from "../effect/json-schema.js";

const UPDATE_FIXTURES = process.env.APP_UPDATE_FIXTURES === "1";

export function jsonSchemaGoldenRoot(moduleUrl: string): string {
  return path.join(fileURLToPath(moduleUrl), "../../fixtures/json-schema");
}

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
