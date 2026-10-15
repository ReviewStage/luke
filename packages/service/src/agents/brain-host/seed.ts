import type { StoredUIMessage } from "../../core.js";
import { BRAIN_HOST } from "./bounds.js";
import { storedMessageLine } from "./context.js";

/**
 * What a rotated session opens with: the conversation so far, read back
 * from the store's own rows and handed to eve as one user-role instruction
 * at the session's start, so a new eve session over an old conversation
 * remembers what was said without eve's history being the record. Our
 * tables are the record; the seed is a bounded view of them, newest last,
 * cut from the front. A conversation with nothing said seeds nothing.
 */

/** The marker the seed rides behind, so the model knows it is data. */
const SEED_MARKER = "[conversation so far]";

export function rotationSeedText(
  messages: readonly StoredUIMessage[],
  now: number,
): string | undefined {
  if (messages.length === 0) return undefined;
  const lines = messages.map((message) =>
    storedMessageLine(message, BRAIN_HOST.RECENT_MESSAGE_CHARS),
  );
  let body = lines.join("\n");
  if (body.length > BRAIN_HOST.SEED_CHARS) {
    body = `…${body.slice(body.length - BRAIN_HOST.SEED_CHARS)}`;
  }
  return `${SEED_MARKER} ${new Date(now).toISOString()}\n${body}`;
}
