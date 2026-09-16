import { createHash } from "node:crypto";

/**
 * What a turn ran under, addressed by the SHA-256 of the bytes as the model
 * was offered them, so a thousand turns under one prompt or one tool set
 * carry one hash and a changed workspace file or a reworded tool is a new
 * hash on the next turn that runs under it. The hash is taken over exactly
 * what was offered, never over a normalized form: the schemas' key order is
 * part of what a model reads, and the goldens hold it still for the same
 * reason. Neither is stored: the turn row carries the prompt's hash and the
 * tool set's and nothing else of either. The prompt is the developer's words,
 * embedding their workspace rows whole; the tool set is the build's own,
 * identical for every account, and read from the build that offered it.
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
