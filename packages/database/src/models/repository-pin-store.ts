import {
  REPOSITORY_PIN_BOUNDS,
  type RepositoryPin,
  type RepositoryPinsWritten,
} from "@repo/features/task-wire";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";

const PinRowSchema = Schema.Struct({
  repository: Schema.String,
  pinnedAt: InstantColumnSchema,
});

const PinKeySchema = Schema.Struct({ userId: Schema.String, repository: Schema.String });

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const WrittenSchema = Schema.Struct({ txid: Schema.String });

const findPins = SqlSchema.findAll({
  Request: Schema.String,
  Result: PinRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ repository: repositoryPin.repository, pinnedAt: repositoryPin.pinnedAt })
        .from(repositoryPin)
        .where(eq(repositoryPin.userId, userId))
        .orderBy(desc(repositoryPin.pinnedAt), asc(repositoryPin.repository)),
    ),
});

const lockAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update"),
    ),
});

const insertPin = SqlSchema.findAll({
  Request: Schema.Struct({ ...PinKeySchema.fields, now: Schema.Date }),
  Result: WrittenSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(repositoryPin)
        .values({ userId: write.userId, repository: write.repository, pinnedAt: write.now })
        .onConflictDoNothing()
        .returning(TXID),
    ),
});

const deletePin = SqlSchema.findAll({
  Request: PinKeySchema,
  Result: WrittenSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(repositoryPin)
        .where(
          and(eq(repositoryPin.userId, key.userId), eq(repositoryPin.repository, key.repository)),
        )
        .returning(TXID),
    ),
});

export function listRepositoryPins(userId: string): TaskStoreEffect<readonly RepositoryPin[]> {
  return Effect.map(findPins(userId), (rows) =>
    rows.map((row) => ({ repository: row.repository, pinnedAt: row.pinnedAt.getTime() })),
  );
}

export function repositoryPinsLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          { repository: repositoryPin.repository },
          { pinnedAt: repositoryPin.pinnedAt },
        ),
      )
      .from(repositoryPin)
      .where(eq(repositoryPin.userId, userId)),
  );
}

export function setRepositoryPin(
  userId: string,
  repository: string,
  pinned: boolean,
): TaskStoreEffect<Option.Option<RepositoryPinsWritten>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const account = yield* lockAccount(userId);
        if (Option.isNone(account)) return Option.none();
        const answer = (rows: readonly (typeof WrittenSchema.Type)[]) =>
          Effect.map(listRepositoryPins(userId), (pins) => {
            const txid = rows[0]?.txid;
            return Option.some(txid === undefined ? { pins } : { pins, txid });
          });
        if (!pinned) return yield* answer(yield* deletePin({ userId, repository }));
        const standing = yield* listRepositoryPins(userId);
        if (standing.some((pin) => pin.repository === repository)) {
          return Option.some({ pins: standing });
        }
        if (standing.length >= REPOSITORY_PIN_BOUNDS.MAX_PINS) return Option.none();
        const now = yield* DateTime.nowAsDate;
        return yield* answer(yield* insertPin({ userId, repository, now }));
      }),
    ),
  );
}
