/**
 * github-rate-holds.ts -- the holds GitHub's rate limits put on an identity, written by the instance refused and read by every instance.
 *
 * A refusal writes its hold in one statement, so two instances refused at
 * once can neither shorten the other's hold nor each count a strike: the
 * hold kept is the later of the one standing and the one asked for, and a
 * refusal while a hold stands is the same strike as the one that set it,
 * since it is a request that was already out. How long each strike in a row
 * holds is the caller's to say, as a wait per strike, the last standing for
 * every strike past it, so the backoff is stated once, in the gate. The
 * first answer GitHub sends once the hold is over lets the row go, and only
 * then: a hold another instance moved on meanwhile stands. A hold lifted
 * longer ago than the caller remembers counts no strike, so a refusal days
 * after the last starts the backoff afresh even where no answer came
 * between them. Every statement
 * is keyed by the identity alone, which is the App, nobody, or a token's
 * digest, never a token or an account.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { githubRateHold } from "../schemas/github-rate-hold.js";

type HoldEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One identity's hold as every instance reads it: when it lifts, and how many refusals in a row it follows. */
export interface GitHubRateHold {
  readonly heldUntil: Date;
  readonly strikes: number;
}

const HoldRowSchema = Schema.Struct({ heldUntil: Schema.Date, strikes: Schema.Number });

const HOLD_COLUMNS = { heldUntil: githubRateHold.heldUntil, strikes: githubRateHold.strikes };

const findHold = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: HoldRowSchema,
  execute: (identity) =>
    Database.use((db) =>
      db
        .select(HOLD_COLUMNS)
        .from(githubRateHold)
        .where(eq(githubRateHold.identity, identity))
        .limit(1),
    ),
});

const upsertHold = SqlSchema.findOne({
  Request: Schema.Struct({
    identity: Schema.String,
    now: Schema.Date,
    waits: Schema.NonEmptyArray(Schema.Int),
    forgottenBefore: Schema.Date,
  }),
  Result: HoldRowSchema,
  execute: ({ identity, now, waits, forgottenBefore }) => {
    const at = sql`${now.toISOString()}::timestamptz`;
    const forgotten = sql`${forgottenBefore.toISOString()}::timestamptz`;
    // The strike this refusal counts as: the standing one while its hold stands, the first again where it lifted long ago, else the next.
    const strikes = sql`(case when ${githubRateHold.heldUntil} > ${at} then ${githubRateHold.strikes} when ${githubRateHold.heldUntil} < ${forgotten} then 1 else ${githubRateHold.strikes} + 1 end)`;
    const table = sql`(array[${sql.join(
      waits.map((wait) => sql`${wait}`),
      sql`, `,
    )}]::bigint[])`;
    const wait = sql`${table}[least(${strikes}, cardinality(${table}))]`;
    return Database.use((db) =>
      db
        .insert(githubRateHold)
        .values({
          identity,
          heldUntil: new Date(now.getTime() + waits[0]),
          strikes: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: githubRateHold.identity,
          set: {
            strikes,
            heldUntil: sql`greatest(${githubRateHold.heldUntil}, ${at} + ${wait} * interval '1 millisecond')`,
            updatedAt: now,
          },
        })
        .returning(HOLD_COLUMNS),
    );
  },
});

const deleteLifted = SqlSchema.void({
  Request: Schema.Struct({ identity: Schema.String, now: Schema.Date }),
  execute: ({ identity, now }) =>
    Database.use((db) =>
      db
        .delete(githubRateHold)
        .where(and(eq(githubRateHold.identity, identity), lte(githubRateHold.heldUntil, now))),
    ),
});

/** The identity's hold as it stands, lifted or not, or nothing where no refusal is on record. */
export function readGitHubRateHold(identity: string): HoldEffect<GitHubRateHold | undefined> {
  return Effect.map(findHold(identity), Option.getOrUndefined);
}

/**
 * Holds the identity for a refusal at `now`, answering the hold as it now
 * stands. `waits` names the milliseconds each strike in a row holds for,
 * the first strike first, the last for every strike past it; the hold
 * written is never shorter than the one standing. A hold that lifted before
 * `forgottenBefore` counts no strike, so the refusal is the first strike
 * again, as it is where an answer since let the row go.
 */
export function holdGitHubIdentity(
  identity: string,
  now: Date,
  waits: readonly [number, ...number[]],
  forgottenBefore: Date,
): HoldEffect<GitHubRateHold> {
  // Note that an upsert always answers the one row it wrote, so no row is a defect rather than a failure a caller reads.
  return upsertHold({ identity, now, waits, forgottenBefore }).pipe(
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}

/** Lets go of the identity's hold once an answer at `now` came after it lifted; a hold standing past `now` stays. */
export function liftGitHubRateHold(identity: string, now: Date): HoldEffect<void> {
  return deleteLifted({ identity, now });
}
