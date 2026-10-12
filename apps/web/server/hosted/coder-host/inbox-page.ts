import { createHash } from "node:crypto";
import type { InboxAnswer } from "@sidecar/hosted/inbox-wire";
import { Effect, Schedule } from "effect";
import {
  type InboxStamp,
  type InboxStoreEffect,
  planInboxItems,
  planInboxStamps,
} from "../inbox-store.js";
import { CODER } from "./bounds.js";

/**
 * inbox-page.ts -- a plan's inbox as the desktop reads it: every item its agents posted, held open while nothing changed since the reader's cursor.
 *
 * The cursor is a digest of where every item stands, so a post, a close,
 * an answer, and a new item each move it, and a reader that holds it hears
 * the next change once. A read whose cursor is
 * still the inbox's is held, looked at again every `MESSAGES_POLL`, each
 * look reading where the items stand and none of their words, and let
 * go at `MESSAGES_HOLD` as a transcript read is (`transcript.ts`), so the
 * Inbox tab hears an item the moment it lands without asking on a clock of
 * its own; a read past the hold answers the inbox unchanged, and the reader
 * asks again.
 */

/** How many characters of the digest a cursor carries: far more than any two inboxes of a plan could share by chance. */
const CURSOR_CHARS = 32;

/**
 * Where the inbox stands for a reader: a digest of every item's id,
 * revision, status, and instant, taken in the items' id order so the same
 * items read in another order are the same cursor, and any change to any
 * item moves it, two within one millisecond included. Note that an empty
 * inbox digests to a cursor of its own rather than the start, so a first
 * read answers at once.
 */
function cursorOf(
  stamps: readonly Pick<InboxStamp, "id" | "revision" | "status" | "updatedAt">[],
): string {
  const standing = stamps
    .map((stamp) => [stamp.id, stamp.revision, stamp.status, stamp.updatedAt] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, CURSOR_CHARS);
}

/** The plan's inbox as it stands, held while its cursor is still the reader's. */
export function planInboxPast(
  userId: string,
  planId: string,
  after: string,
): InboxStoreEffect<InboxAnswer> {
  const read = Effect.map(planInboxItems(userId, planId), (items) => ({
    items,
    cursor: cursorOf(items),
  }));
  // Each look inside the hold reads where the items stand and none of their words; the items are read whole once they moved.
  const moved = Effect.map(planInboxStamps(userId, planId), (stamps) => cursorOf(stamps) !== after);
  return moved.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: (changed) => changed }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.flatMap(() => read),
  );
}
