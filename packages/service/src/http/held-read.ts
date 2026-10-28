import { createHash } from "node:crypto";
import type { SyncTopic } from "@luke/database/sync/notification";
import { type Duration, Effect, Option } from "effect";
import { Sync } from "../sync/watch.js";

/**
 * held-read.ts -- a read the desktop holds open while nothing it reads changed since its cursor: the cursor, and the hold.
 *
 * The cursor is a digest of where every row a read covers stands, so any
 * change to any of them moves it, and a reader that holds it hears the next
 * change once. A read whose cursor is still the rows' is held, looked at
 * again each time a watch on the rows' topics wakes (`sync/watch.ts`), each
 * look reading where the rows stand and none of their words, and let go at
 * the hold's end, when it answers the rows unchanged and the reader asks
 * again. A watch on no topics, or one Luke Sync cannot wake, wakes every
 * poll. The Inbox and a plan's comments are read this way, so a window
 * hears a teammate's or an agent's change the moment it lands without
 * asking on a clock of its own.
 */

/** How many characters of the digest a cursor carries: far more than any two readings of one plan's rows could share by chance. */
const CURSOR_CHARS = 32;

/** What a cursor digests of one row it covers: its id, revision, status, and instant, for a row a reader reads or not, whether it is unread for them, and, for a row that waits on someone, who. */
export interface CursorStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly updatedAt: number;
  readonly unread?: boolean;
  readonly waitsOn?: string;
}

/**
 * Where the rows stand for a reader: a digest of every row's id, revision,
 * status, and instant, and its unread state where it has one, taken in the
 * rows' id order so the same rows read in another order are the same
 * cursor, and any change to any row moves it, two within one millisecond
 * included, as does the reader marking one read or unread, or the row
 * coming to wait on someone else. Note that a row with no unread state and
 * nobody it waits on digests as it did before either was kept, so a read
 * that carries neither keeps its cursors. Note too that no rows digest to a
 * cursor of their own rather than the start, so a first read answers at once.
 */
export function cursorOf(stamps: readonly CursorStamp[]): string {
  const standing = stamps
    .map((stamp) => [
      stamp.id,
      stamp.revision,
      stamp.status,
      stamp.updatedAt,
      ...(stamp.unread === undefined ? [] : [stamp.unread]),
      ...(stamp.waitsOn === undefined ? [] : [stamp.waitsOn]),
    ])
    .toSorted(([a], [b]) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(standing)).digest("hex").slice(0, CURSOR_CHARS);
}

/**
 * A read that moved, the ids of the transactions whose writes woke the looks
 * before it, each once, and the instant the first of the writes that woke the
 * look that moved was heard (clock milliseconds): none where it moved at the
 * first look or its clock woke it.
 */
export interface Held<A> {
  readonly read: A;
  readonly txids: readonly string[];
  readonly heardAt: Option.Option<number>;
}

/**
 * Reads until a read is one `moved` says moved, which it answers, or the
 * hold ends, answering none, waiting between reads on a watch of the
 * topics, which wakes every `poll` where nothing else does. Note that the
 * watch is opened before the first read, so a write that commits while that
 * read runs still wakes the look after it.
 */
export function heldUntil<A, E, R>(
  read: Effect.Effect<A, E, R>,
  moved: (read: A) => boolean,
  topics: readonly SyncTopic[],
  poll: Duration.Duration,
  hold: Duration.Duration,
): Effect.Effect<Option.Option<Held<A>>, E, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const watch = yield* (yield* Sync).watch(topics, poll);
      const woken = new Set<string>();
      let heardAt = Option.none<number>();
      let standing = yield* read;
      while (!moved(standing)) {
        for (const txid of yield* watch.next) woken.add(txid);
        // Note that only the wake before the look that moved is kept, since an earlier one that moved nothing, as a parent's write may on a worker's read, is not what this read answers.
        heardAt = yield* watch.heardAt;
        standing = yield* read;
      }
      return { read: standing, txids: [...woken], heardAt };
    }),
  ).pipe(Effect.timeoutOption(hold));
}

/**
 * Waits until the stamps move past the reader's cursor, or the hold ends:
 * each look reads where the rows stand and none of their words, and the
 * caller reads them whole once this returns.
 */
export function heldUntilMoved<E, R>(
  stamps: Effect.Effect<readonly CursorStamp[], E, R>,
  after: string,
  topics: readonly SyncTopic[],
  poll: Duration.Duration,
  hold: Duration.Duration,
): Effect.Effect<void, E, R> {
  return Effect.asVoid(
    heldUntil(stamps, (standing) => cursorOf(standing) !== after, topics, poll, hold),
  );
}
