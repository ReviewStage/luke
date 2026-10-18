import { createHash } from "node:crypto";
import { type Duration, Effect, Schedule } from "effect";

/**
 * held-read.ts -- a read the desktop holds open while nothing it reads changed since its cursor: the cursor, and the hold.
 *
 * The cursor is a digest of where every row a read covers stands, so any
 * change to any of them moves it, and a reader that holds it hears the next
 * change once. A read whose cursor is still the rows' is held, looked at
 * again every poll, each look reading where the rows stand and none of
 * their words, and let go at the hold's end, when it answers the rows
 * unchanged and the reader asks again. The Inbox and a plan's comments are
 * read this way, so a window hears a teammate's or an agent's change the
 * moment it lands without asking on a clock of its own.
 */

/** How many characters of the digest a cursor carries: far more than any two readings of one plan's rows could share by chance. */
const CURSOR_CHARS = 32;

/** What a cursor digests of one row it covers: its id, revision, status, and instant, and, for a row a reader reads or not, whether it is unread for them. */
export interface CursorStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly updatedAt: number;
  readonly unread?: boolean;
}

/**
 * Where the rows stand for a reader: a digest of every row's id, revision,
 * status, and instant, and its unread state where it has one, taken in the
 * rows' id order so the same rows read in another order are the same
 * cursor, and any change to any row moves it, two within one millisecond
 * included, as does the reader marking one read or unread. Note that a row
 * with no unread state digests as it did before there was one, so a read
 * that carries none keeps its cursors. Note too that no rows digest to a
 * cursor of their own rather than the start, so a first read answers at once.
 */
export function cursorOf(stamps: readonly CursorStamp[]): string {
  const standing = stamps
    .map((stamp) =>
      stamp.unread === undefined
        ? ([stamp.id, stamp.revision, stamp.status, stamp.updatedAt] as const)
        : ([stamp.id, stamp.revision, stamp.status, stamp.updatedAt, stamp.unread] as const),
    )
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, CURSOR_CHARS);
}

/**
 * Waits until the stamps move past the reader's cursor, or the hold ends:
 * each look reads where the rows stand and none of their words, and the
 * caller reads them whole once this returns.
 */
export function heldUntilMoved<E, R>(
  stamps: Effect.Effect<readonly CursorStamp[], E, R>,
  after: string,
  poll: Duration.Duration,
  hold: Duration.Duration,
): Effect.Effect<void, E, R> {
  const moved = Effect.map(stamps, (standing) => cursorOf(standing) !== after);
  return moved.pipe(
    Effect.repeat({ schedule: Schedule.spaced(poll), until: (changed) => changed }),
    Effect.timeoutOption(hold),
    Effect.asVoid,
  );
}
