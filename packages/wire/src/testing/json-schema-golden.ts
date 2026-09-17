import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { emitJsonSchema } from "../effect/json-schema.js";
import type { WireValue } from "../json.js";
import type { JsonSchemaNode } from "../schema-vocabulary.js";

/**
 * The JSON Schema a model is shown, recorded. These bytes are prompt-cache
 * bytes: a model provider keys its cache on the text of the request, so a
 * reordered key or a widened bound costs every conversation its prefix, and a
 * rewrite of what emits them is measured against these files rather than
 * against a reader's memory of them. Nothing sorts the keys, because their
 * order is part of what is being held still.
 */

/** Records the schemas instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const GOLDEN_SUFFIX = ".json";

/**
 * One function tool as a request carries it. Wire declares the node's strict
 * form for a function tool's parameters already; this is the object that node
 * travels inside, so a golden can hold the whole of what a model is handed
 * rather than the parameters alone.
 */
interface JsonSchemaGoldenTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchemaNode;
}

export type JsonSchemaGolden = JsonSchemaNode | JsonSchemaGoldenTool;

/** What a golden file holds: a JSON Schema, or any other JSON a test pins byte for byte, such as a protocol envelope. */
export type JsonGolden = JsonSchemaGolden | WireValue;

/** Anything that emits a node: every `Schema`, and nothing that has to be one. */
export interface JsonSchemaSource {
  jsonSchema(): JsonSchemaNode;
}

/**
 * A recorded node's source, either way it was declared: a `Schema` the
 * builder answers for, or the Effect declaration a module states directly and
 * wire's own emitter walks.
 */
export type RecordedJsonSchemaSource = JsonSchemaSource | Schema.Top;

/** The node a source emits, whichever of the two it is. */
export function jsonSchemaOf(source: RecordedJsonSchemaSource): JsonSchemaNode {
  return Schema.isSchema(source) ? emitJsonSchema(source) : source.jsonSchema();
}

/**
 * Every export of a module that is an Effect schema. A recorded set declared
 * as `RecordedEffectJsonSchemas<typeof module>` is exhaustive by construction:
 * a schema added to that module does not compile until it is recorded, which
 * is what keeps a rewrite of the emitter from quietly moving bytes nobody
 * pinned.
 */
type EffectJsonSchemaExportName<Module> = {
  [Key in keyof Module]: Module[Key] extends Schema.Top ? Key : never;
}[keyof Module];

export type RecordedEffectJsonSchemas<Module> = {
  readonly [Key in EffectJsonSchemaExportName<Module>]: Schema.Top;
};

/** The `fixtures/json-schema` directory of the package a test file sits in. */
export function jsonSchemaGoldenRoot(moduleUrl: string): string {
  return path.join(fileURLToPath(moduleUrl), "../../fixtures/json-schema");
}

function goldenText(recorded: JsonGolden): string {
  return `${JSON.stringify(recorded, undefined, 2)}\n`;
}

function goldenPath(root: string, name: string): string {
  return path.join(root, `${name}${GOLDEN_SUFFIX}`);
}

/**
 * Compares one emitted schema with the recorded bytes and never records:
 * for a test that proves another emitter reproduces a golden some other
 * package's test owns, so a recording run rewrites each golden from the one
 * declaration that records it and never from the emitter being measured.
 */
export async function matchJsonSchemaGolden(
  root: string,
  name: string,
  emitted: JsonGolden,
): Promise<void> {
  const filePath = goldenPath(root, name);
  const held = await fs.readFile(filePath, "utf8").catch(() => undefined);
  assert.ok(held !== undefined, `no JSON Schema recorded at ${filePath}`);
  assert.equal(goldenText(emitted), held);
}

/**
 * Compares one recorded JSON value with the bytes on disk, or records it: the
 * one door every byte golden in the repository goes through, so
 * `LUKE_UPDATE_FIXTURES` is read here and in no test file of its own.
 */
export async function settleJsonGolden(
  root: string,
  name: string,
  recorded: JsonGolden,
): Promise<void> {
  if (UPDATE_FIXTURES) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(goldenPath(root, name), goldenText(recorded));
    return;
  }
  await matchJsonSchemaGolden(root, name, recorded);
}

/** Compares one emitted schema with the recorded bytes, or records it. */
export async function settleJsonSchemaGolden(
  root: string,
  name: string,
  recorded: JsonSchemaGolden,
): Promise<void> {
  await settleJsonGolden(root, name, recorded);
}

/**
 * The recorded set is exactly the named one: a schema (or any other golden
 * under the root) added later cannot go unrecorded, and one retired leaves no
 * golden behind claiming it still stands. Recording drops what the names no
 * longer reach.
 */
export async function settleJsonSchemaGoldenSet(
  root: string,
  names: readonly string[],
): Promise<void> {
  const expected = [...names].sort();
  if (UPDATE_FIXTURES) {
    await fs.mkdir(root, { recursive: true });
    const named = new Set(expected);
    for (const entry of await fs.readdir(root)) {
      if (!entry.endsWith(GOLDEN_SUFFIX)) continue;
      if (named.has(entry.slice(0, -GOLDEN_SUFFIX.length))) continue;
      await fs.rm(path.join(root, entry));
    }
    return;
  }
  const held = (await fs.readdir(root))
    .filter((entry) => entry.endsWith(GOLDEN_SUFFIX))
    .map((entry) => entry.slice(0, -GOLDEN_SUFFIX.length))
    .sort();
  assert.deepEqual(held, expected);
}
