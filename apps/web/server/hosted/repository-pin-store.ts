import { REPOSITORY_PIN_BOUNDS, type RepositoryPin } from "@sidecar/hosted/plan-wire";
import { and, asc, desc, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import { db } from "../db/query.js";
import { repositoryPin } from "../db/repository-pin-schema.js";
import type { PlanStoreEffect, PlanStoreFailure } from "./plan-store.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * repository-pin-store.ts -- the repositories an account pinned in the sidebar, read and written for `/api/repository-pins`.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads or moves another's pins. A pin keeps the
 * instant it was first made, so pinning twice moves nothing, and unpinning
 * deletes the row, so unpinning twice moves nothing either.
 */

const PinRowSchema = Schema.Struct({
  repository: Schema.String,
  pinnedAt: InstantColumnSchema,
});

const PinKeySchema = Schema.Struct({ userId: Schema.String, repository: Schema.String });

const findPins = SqlSchema.findAll({
  Request: Schema.String,
  Result: PinRowSchema,
  execute: (userId) =>
    db
      .select({ repository: repositoryPin.repository, pinnedAt: repositoryPin.pinnedAt })
      .from(repositoryPin)
      .where(eq(repositoryPin.userId, userId))
      .orderBy(desc(repositoryPin.pinnedAt), asc(repositoryPin.repository)),
});

const insertPin = SqlSchema.void({
  Request: Schema.Struct({ ...PinKeySchema.fields, now: Schema.Date }),
  execute: (write) =>
    db
      .insert(repositoryPin)
      .values({ userId: write.userId, repository: write.repository, pinnedAt: write.now })
      .onConflictDoNothing(),
});

const deletePin = SqlSchema.void({
  Request: PinKeySchema,
  execute: (key) =>
    db
      .delete(repositoryPin)
      .where(
        and(eq(repositoryPin.userId, key.userId), eq(repositoryPin.repository, key.repository)),
      ),
});

/** The account's pinned repositories, newest pinned first. */
export function listRepositoryPins(userId: string): PlanStoreEffect<readonly RepositoryPin[]> {
  return Effect.map(findPins(userId), (rows) =>
    rows.map((row) => ({ repository: row.repository, pinnedAt: row.pinnedAt.getTime() })),
  );
}

/**
 * Pins one repository or unpins it, and answers the account's pins as they
 * then stand; nothing where a new pin would hold more than the bound, with
 * nothing written. A repository already pinned keeps its instant and counts
 * against no bound.
 */
export const setRepositoryPin = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  repository: string,
  pinned: boolean,
): Effect.fn.Return<
  Option.Option<readonly RepositoryPin[]>,
  PlanStoreFailure,
  SqlClient.SqlClient
> {
  if (!pinned) {
    yield* deletePin({ userId, repository });
    return Option.some(yield* listRepositoryPins(userId));
  }
  const standing = yield* listRepositoryPins(userId);
  if (standing.some((pin) => pin.repository === repository)) return Option.some(standing);
  if (standing.length >= REPOSITORY_PIN_BOUNDS.MAX_PINS) return Option.none();
  const now = yield* DateTime.nowAsDate;
  yield* insertPin({ userId, repository, now });
  return Option.some(yield* listRepositoryPins(userId));
});
