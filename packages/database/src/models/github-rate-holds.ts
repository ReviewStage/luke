import { and, eq, lte, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { githubRateHold } from "../schemas/github-rate-hold.js";

type HoldEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

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

export function readGitHubRateHold(identity: string): HoldEffect<GitHubRateHold | undefined> {
  return Effect.map(findHold(identity), Option.getOrUndefined);
}

export function holdGitHubIdentity(
  identity: string,
  now: Date,
  waits: readonly [number, ...number[]],
  forgottenBefore: Date,
): HoldEffect<GitHubRateHold> {
  return upsertHold({ identity, now, waits, forgottenBefore }).pipe(
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}

export function liftGitHubRateHold(identity: string, now: Date): HoldEffect<void> {
  return deleteLifted({ identity, now });
}
