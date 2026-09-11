import { createHash } from "node:crypto";
import { toolSets } from "../../db/storage-schema.js";
import type { HostedStoreDatabase } from "./database.js";

/**
 * What a turn ran under, addressed by the SHA-256 of the bytes as the model
 * was offered them, so a thousand turns under one prompt or one tool set
 * carry one hash and a changed workspace file or a reworded tool is a new
 * hash on the next turn that runs under it. The hash is taken over exactly
 * what was offered, never over a normalized form: the schemas' key order is
 * part of what a model reads, and the goldens hold it still for the same
 * reason. The two are kept differently. The prompt is the developer's words,
 * embedding their workspace rows whole, so nothing of it is stored but its
 * fingerprint on the turn; the tool set is the build's own, identical for
 * every account and carrying nothing of anyone's, so it is stored whole,
 * once, under its hash.
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

/** The content address of a prompt: the hash of its text, and the whole of what the record keeps of it. */
export function promptHashOf(text: string): string {
  return sha256Hex(text);
}

/** The content address of a tool set: the hash of the offered declarations serialized in their offered order. */
export function toolSetHashOf(schemas: readonly OfferedToolSchema[]): string {
  return sha256Hex(JSON.stringify(schemas));
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
