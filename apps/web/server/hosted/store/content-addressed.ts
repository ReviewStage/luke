import { createHash } from "node:crypto";
import { prompts, toolSets } from "../../db/storage-schema.js";
import type { HostedStoreDatabase } from "./database.js";

/**
 * What a turn ran under, stored once by its content: the prompt's text and
 * the tool set's schemas, each keyed by the SHA-256 of the bytes as the model
 * was offered them, so the same prompt written by a thousand turns is one
 * row and a changed workspace file or a reworded tool is a new hash on the
 * next turn that runs under it. The hash is taken over exactly what was
 * offered, never over a normalized form: the schemas' key order is part of
 * what a model reads, and the goldens hold it still for the same reason.
 */

/** One tool as the model is offered it: the name, the words, and the JSON Schema of its input. */
export interface OfferedToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The content address of a prompt: the hash of its text. */
export function promptHashOf(text: string): string {
  return sha256Hex(text);
}

/** The content address of a tool set: the hash of the offered declarations serialized in their offered order. */
export function toolSetHashOf(schemas: readonly OfferedToolSchema[]): string {
  return sha256Hex(JSON.stringify(schemas));
}

/** Writes the prompt where no row stands for its hash; answers the hash either way. */
export async function recordPrompt(
  db: HostedStoreDatabase,
  text: string,
  now: Date,
): Promise<string> {
  const hash = promptHashOf(text);
  await db.insert(prompts).values({ hash, text, createdAt: now }).onConflictDoNothing();
  return hash;
}

/** Writes the tool set where no row stands for its hash; answers the hash either way. */
export async function recordToolSet(
  db: HostedStoreDatabase,
  schemas: readonly OfferedToolSchema[],
  now: Date,
): Promise<string> {
  const hash = toolSetHashOf(schemas);
  await db
    .insert(toolSets)
    .values({ hash, schemas: [...schemas], createdAt: now })
    .onConflictDoNothing();
  return hash;
}
