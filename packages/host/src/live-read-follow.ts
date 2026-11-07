import { LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type { EntityKind, EntityPool, FieldChange, HeldRows } from "@repo/sync";
import { Effect, type Schema } from "effect";
import { drawnAtEdges, type HeldAnswers } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

/**
 * live-read-follow.ts -- one live read the windows hold, followed over the service's held poll into the sync engine's pool by its rows' keys, and told whole as its rows and every write standing over them draw.
 *
 * Each row of the read's one part is a row of the pool (`@repo/sync`), by
 * the key its part declares, so a write drawn over it (a removal, a forget)
 * shows at once and stands until the read carries its transaction, and no
 * answer from before it puts the row back. What the slice holds is drawn
 * from the rows as the pool shows them, beside what the first answer
 * carried that no row does, at the host's own instant, and again at the
 * instant the read says the clock alone next moves what it drew (`edge`,
 * `drawnAtEdges`). Nothing is told before the read first answers, since a
 * write drawn on no rows shows nothing.
 *
 * A read the service did not answer is told unanswered and asked for again
 * after `LIVE_RESTART`, as a follow that stops is. One refused for good
 * (`endsFollow`) is told unanswered and ends; one refused because the
 * session is no longer the account the follow started for ends unsaid, and
 * the next sign-in follows it again.
 */

/** A read the service did not answer, as the client and the gate tell it. */
interface Unanswered {
  readonly failure: string;
}

/** One live read as `followLiveRead` follows it. */
export interface LiveReadFollow<Part extends string, Row extends object, Answer, Drawn> {
  /** The read sealed, its rows inline at the poll address where it polls, held past `after` where it names one; signed out (`LIVE_SIGNED_OUT`) where the session is not the account it is followed for. */
  readonly seal: (poll: boolean, after?: string) => Effect.Effect<Answer | Unanswered>;
  /** Every part's rows, as the read declares them (`READ.rows`). */
  readonly rows: Schema.Decoder<{ readonly [Name in Part]: readonly Row[] }>;
  /** The part whose rows stand in the pool. */
  readonly part: Part;
  readonly pool: EntityPool;
  /** The kind the part's rows stand as in the pool, keyed by the key the part declares. */
  readonly kind: EntityKind<Row, FieldChange<Row>>;
  /** Whether a refusal ends the follow for good, told unanswered; a signed-out one always ends it, unsaid. */
  readonly endsFollow: (failure: string) => boolean;
  /** What the slice holds of the rows as the pool draws them at `now`, beside what the first answer carried. */
  readonly draw: (rows: readonly Row[], first: Answer, now: number) => Drawn;
  /** The instant after `now` the clock alone next moves what `draw` drew of the rows, where it does; none where only a write does. */
  readonly edge?: (rows: readonly Row[], now: number) => number | undefined;
  /** Whether a row another follow's write made is one this read holds; none where the read adopts none. */
  readonly adopts?: (row: Row) => boolean;
}

/** Follows `read` until let go, each change told through `answers`. */
export function followLiveRead<
  Part extends string,
  Row extends object,
  Answer extends SealedRead<Part>,
  Drawn,
>(
  read: LiveReadFollow<Part, Row, Answer, Drawn>,
  answers: HeldAnswers<Drawn>,
): Effect.Effect<void> {
  const ends = (failure: string) => failure === LIVE_SIGNED_OUT.failure || read.endsFollow(failure);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* read.seal(false);
      if ("failure" in first) {
        if (first.failure === LIVE_SIGNED_OUT.failure) return false;
        answers.unanswered();
        return !read.endsFollow(first.failure);
      }
      let wait: TxWait | undefined;
      let answered = false;
      /** Why a poll ended the follow for good, the first such failure kept, so one the account no longer reaches is told unanswered. */
      let endedBy: string | undefined;
      const drawn: Effect.Effect<void> = yield* drawnAtEdges((now) => {
        if (!answered) return undefined;
        const rows = held.rows();
        answers.answered(read.draw(rows, first, now));
        return read.edge?.(rows, now);
      });
      const held: HeldRows<Row> = yield* read.pool.stand(read.kind, {
        redraw: () => drawn,
        confirmation: () => {
          const handed = wait;
          return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
        },
        ...(read.adopts === undefined ? {} : { adopts: read.adopts }),
      });
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(read.seal(true, after), (sealed) => {
              if (!("failure" in sealed)) return sealed;
              const ended = ends(sealed.failure);
              if (ended && endedBy === undefined) endedBy = sealed.failure;
              return { failure: sealed.failure, gone: ended };
            }),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        read.rows,
        (rows) =>
          Effect.andThen(
            held.answer(rows[read.part]),
            Effect.suspend(() => {
              answered = true;
              return drawn;
            }),
          ),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      if (!gone) return true;
      if (endedBy !== undefined && endedBy !== LIVE_SIGNED_OUT.failure) answers.unanswered();
      return false;
    }),
  );
  return restarting(attempt);
}
