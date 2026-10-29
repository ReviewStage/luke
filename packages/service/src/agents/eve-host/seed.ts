import type { StoredUIMessage } from "../../core.js";
import { EVE_HOST } from "./bounds.js";
import { storedMessageLine } from "./context.js";

/**
 * What a rotated session opens with: the conversation so far, read back
 * from the store's own rows and handed to eve as one user-role instruction
 * at the session's start, so a new eve session over an old conversation
 * remembers what was said without eve's history being the record. Our
 * tables are the record; the seed is a bounded view of them, newest last,
 * cut from the front. A conversation with nothing said seeds nothing. A
 * coding agent's session opened afresh after its last one retired is seeded
 * the same way (`coder-host/host.ts`'s `seed`).
 */

/** The marker the seed rides behind, so the model knows it is data. */
const SEED_MARKER = "[conversation so far]";

/** The seed, each message under its speaker, or under the one `speakers` names for it, such as a teammate of a coding agent's developer. */
export function rotationSeedText(
  messages: readonly StoredUIMessage[],
  now: number,
  speakers?: ReadonlyMap<StoredUIMessage, string>,
): string | undefined {
  if (messages.length === 0) return undefined;
  const lines = messages.map((message) =>
    storedMessageLine(message, EVE_HOST.RECENT_MESSAGE_CHARS, speakers?.get(message)),
  );
  let body = lines.join("\n");
  if (body.length > EVE_HOST.SEED_CHARS) {
    body = `…${body.slice(body.length - EVE_HOST.SEED_CHARS)}`;
  }
  return `${SEED_MARKER} ${new Date(now).toISOString()}\n${body}`;
}
