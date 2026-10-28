/**
 * polled-live.ts -- a live read as the service answers it polled, for a host test: each part's rows as the test sets them, and a poll past where they stood held until the test moves them.
 */

import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Deferred, Effect } from "effect";

/**
 * A polled live read over `parts`: each part's rows none until a test sets
 * them, so a read answered before then carries no rows and its poll is held,
 * as a service whose rows never moved holds it. Every part's digest is the
 * read's version, which each `set` moves, so a poll past the version standing
 * is held until the next `set`, and one past any other is answered at once.
 * `Refused` is what the test may have it refuse with (`refuse`). Where
 * `derive` is given, every answer reads the rows from it, as a service reads
 * its own tables, and `move` says they moved; a change it is not told of is
 * missed until a later one, as a follow that missed it would. Rows `set` on
 * such a read stand over what it reads until the next `move`. A `set` may
 * name the txids of the writes that moved it, which every part of each
 * answer carries until the next `set` or `move`, as an answer Luke Sync woke
 * does.
 */
export function polledLive<
  Part extends string,
  Refused extends { readonly failure: string } = never,
>(parts: readonly Part[], derive?: () => Partial<Record<Part, readonly unknown[]>>) {
  let version = 0;
  const rows = new Map<Part, readonly unknown[]>();
  let woken: readonly string[] | undefined;
  let moved = Deferred.makeUnsafe<void>();
  let refusal: Refused | undefined;
  let polls = 0;
  let held = 0;
  const wake = () => {
    Deferred.doneUnsafe(moved, Effect.void);
    moved = Deferred.makeUnsafe<void>();
  };
  const answer = () => ({
    url: LIVE_POLL_URL,
    // SAFETY: every part is written here, and no other.
    queries: Object.fromEntries(
      parts.map((part) => {
        const carried = rows.get(part) ?? derive?.()[part];
        const query: SealedLiveQueryWire = {
          capability: LIVE_POLL_URL,
          queryFingerprint: LIVE_POLL_URL,
          expiresAt: 0,
          digest: String(version),
          ...(carried === undefined ? undefined : { rows: carried }),
          ...(woken === undefined ? undefined : { txids: woken }),
        };
        return [part, query];
      }),
    ) as Record<Part, SealedLiveQueryWire>,
  });
  /** Whether `after` names where the rows stand now: every part's digest it joins (`liveDigestOf`), whichever parts the reader follows, at the version standing. */
  const standing = (after: string) => after.split(",").every((each) => each === String(version));
  /** The read past `after`, held while the rows stand where it names. */
  const poll = (after: string | undefined): Effect.Effect<ReturnType<typeof answer> | Refused> =>
    Effect.suspend(() => {
      if (refusal !== undefined) return Effect.succeed(refusal);
      if (after === undefined || !standing(after)) return Effect.succeed(answer());
      const waiting = moved;
      held += 1;
      return Deferred.await(waiting).pipe(
        Effect.ensuring(Effect.sync(() => (held -= 1))),
        Effect.andThen(poll(after)),
      );
    });
  return {
    /** The read as its first ask is answered: the rows as they stand, or the refusal standing. */
    first: (): ReturnType<typeof answer> | Refused => refusal ?? answer(),
    /** A poll past `after`, counted, held while nothing moved. */
    poll: (after: string | undefined) =>
      Effect.andThen(
        Effect.sync(() => {
          polls += 1;
        }),
        poll(after),
      ),
    /** Sets the parts named to the rows given, the rest as they stand, and moves the read once, woken by the writes `txids` names where it names any. */
    set: (next: Partial<Record<Part, readonly unknown[]>>, txids?: readonly string[]) => {
      for (const part of parts) {
        const carried = next[part];
        if (carried !== undefined) rows.set(part, carried);
      }
      woken = txids;
      version += 1;
      wake();
    },
    /** Moves the read, its rows as `derive` reads them now. */
    move: () => {
      rows.clear();
      woken = undefined;
      version += 1;
      wake();
    },
    /** Has every read from now on refused, a held poll among them, or answered again where none is given. */
    refuse: (next: Refused | undefined) => {
      refusal = next;
      wake();
    },
    /** How many polls were asked. */
    polls: () => polls,
    /** How many polls are held now. */
    held: () => held,
  };
}

export type PolledLive<
  Part extends string,
  Refused extends { readonly failure: string } = never,
> = ReturnType<typeof polledLive<Part, Refused>>;
