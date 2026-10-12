import type { InboxAnswer, InboxItem } from "@sidecar/hosted/inbox-wire";
import { Effect, Option, Schedule } from "effect";
import { type InboxStoreEffect, planInboxItems } from "../inbox-store.js";
import { CODER } from "./bounds.js";

/**
 * inbox-page.ts -- a plan's inbox as the desktop reads it: every item its agents posted, held open while nothing changed since the reader's cursor.
 *
 * The cursor is the latest instant any item changed at and how many items
 * stand, so a post, a close, an answer, and a new item each move it, and a
 * reader that holds it hears the next change once. A read whose cursor is
 * still the inbox's is held, looked at again every `MESSAGES_POLL` and let
 * go at `MESSAGES_HOLD` as a transcript read is (`transcript.ts`), so the
 * Inbox tab hears an item the moment it lands without asking on a clock of
 * its own; a read past the hold answers the inbox unchanged, and the reader
 * asks again.
 */

/**
 * Where the inbox stands for a reader: when its latest item changed, and
 * how many stand. Note that an empty inbox is a cursor of its own rather
 * than the start, so a first read answers at once whatever stands.
 */
function cursorOf(items: readonly InboxItem[]): string {
  const latest = Math.max(0, ...items.map((item) => item.updatedAt));
  return `${latest}.${items.length}`;
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
  const changed = Effect.map(read, (page) =>
    page.cursor === after ? Option.none() : Option.some(page),
  );
  return changed.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: Option.isSome }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.flatMap((held) => {
      const page = Option.flatten(held);
      return Option.isSome(page) ? Effect.succeed(page.value) : read;
    }),
  );
}
