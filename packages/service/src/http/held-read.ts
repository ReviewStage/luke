import { createHash } from "node:crypto";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Duration, Effect, Option } from "effect";
import { LiveWake, UNWATCHED } from "../live/live-wake.js";

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
 *
 * Where the deployment runs Neon Realtime (`live/live-wake.ts`), a hold
 * watches statements covering the rows its looks read, and looks again as
 * they change rather than on its poll, with a look every `LIVE_SAFETY_POLL`
 * beside, so a change the watch missed is heard late rather than never; a
 * watch that breaks hands the hold back to its poll. Any wait of the
 * service's on a row is held the same way (`lookedUntil`).
 */

/** How often a watched wait looks though nothing told it to: what a change the watch missed waits at most. */
const LIVE_SAFETY_POLL = Duration.seconds(5);

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
 * Looks until a look finds something, or the hold ends: between looks it
 * waits for the next change of the `live` statements where Realtime
 * watches them, and its `poll` where nothing does. None past the hold.
 */
export function lookedUntil<A, E, R>(
  look: Effect.Effect<Option.Option<A>, E, R>,
  poll: Duration.Input,
  hold: Duration.Input,
  live: readonly LiveStatement[] = [],
): Effect.Effect<Option.Option<A>, E, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const wake = yield* LiveWake;
      const watch = live.length === 0 ? UNWATCHED : yield* wake.watch(live);
      while (true) {
        const found = yield* look;
        if (Option.isSome(found)) return found;
        const watched = yield* watch.live;
        yield* watched
          ? Effect.raceFirst(watch.changed, Effect.sleep(LIVE_SAFETY_POLL))
          : Effect.sleep(poll);
      }
    }),
  ).pipe(Effect.timeoutOption(hold), Effect.map(Option.flatten));
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
  live: readonly LiveStatement[] = [],
): Effect.Effect<void, E, R> {
  const moved = Effect.map(stamps, (standing) =>
    cursorOf(standing) === after ? Option.none() : Option.some(true),
  );
  return Effect.asVoid(lookedUntil(moved, poll, hold, live));
}
