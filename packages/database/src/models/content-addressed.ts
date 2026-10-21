import { createHash } from "node:crypto";

/**
 * The prompt a turn ran under, addressed by the SHA-256 of its text as the
 * model was offered it, so a thousand turns under one prompt carry one hash
 * and a changed workspace file is a new hash on the next turn that runs
 * under it. The hash is taken over exactly what was offered, never over a
 * normalized form. The prompt is not stored: the turn row carries its hash
 * and nothing else of it, since it is the developer's words, embedding their
 * workspace rows whole.
 */

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The content address of a prompt: the hash of its text, and the whole of what the record keeps of it. */
export function promptHashOf(text: string): string {
  return sha256Hex(text);
}
