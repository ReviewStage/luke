import {
  BOARD_AUTHOR,
  type Board,
  type BoardAuthor,
  type BoardElement,
  boardElementsSchema,
  EMPTY_BOARD,
  pruneTombstones,
} from "@sidecar/hosted/board-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { plan, planBoard } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { PlanStoreEffect } from "./plan-store.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * board-store.ts -- a plan's whiteboard: read it, and write it over the revision the writer read.
 *
 * Two writers share a board, Luke's `draw_on_board` and the developer's
 * canvas, and either may write while the other is mid-edit. A write names
 * the revision it was drawn on and lands only if that is still the board's
 * revision; otherwise it answers the board as it now stands and writes
 * nothing, and the writer merges and tries again. The check and the write
 * run under the plan row's own lock, so two writes over one revision cannot
 * both land, and a plan deleted meanwhile reads as gone rather than written
 * back into being. Every statement names the account beside the plan, so a
 * plan another account owns reads and writes as no plan, exactly as in
 * `plan-store.ts`. A board is pruned of its oldest tombstones as it is
 * written (`pruneTombstones`).
 */

export const BOARD_WRITE = {
  SAVED: "saved",
  CONFLICT: "conflict",
  NO_PLAN: "no-plan",
} as const;

export type BoardWrite =
  | { readonly outcome: typeof BOARD_WRITE.SAVED; readonly board: Board }
  | { readonly outcome: typeof BOARD_WRITE.CONFLICT; readonly board: Board }
  | { readonly outcome: typeof BOARD_WRITE.NO_PLAN };

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const BoardRowSchema = Schema.Struct({
  elements: Schema.NullOr(boardElementsSchema),
  revision: Schema.NullOr(Schema.Int),
  updatedBy: Schema.NullOr(Schema.Literals(Object.values(BOARD_AUTHOR))),
  updatedAt: Schema.NullOr(InstantColumnSchema),
});

type BoardRow = typeof BoardRowSchema.Type;

const BOARD_COLUMNS = {
  elements: planBoard.elements,
  revision: planBoard.revision,
  updatedBy: planBoard.updatedBy,
  updatedAt: planBoard.updatedAt,
};

/** The account's plan, when it owns one under this id. */
function ownedPlan(userId: string, planId: string) {
  return and(eq(plan.id, planId), eq(plan.userId, userId));
}

/** A plan's board row joined to the plan, so a plan with no board yet still answers a row of nulls. */
const findBoard = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: BoardRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select(BOARD_COLUMNS)
      .from(plan)
      .leftJoin(planBoard, eq(planBoard.planId, plan.id))
      .where(ownedPlan(userId, planId))
      .limit(1),
});

/** The same, holding the plan row's lock until the transaction ends. */
const lockBoard = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: BoardRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select(BOARD_COLUMNS)
      .from(plan)
      .leftJoin(planBoard, eq(planBoard.planId, plan.id))
      .where(ownedPlan(userId, planId))
      .for("update", { of: plan }),
});

/**
 * Writes the board's row whole. Note that the elements are closed over
 * rather than carried in the request, because the request is handed to the
 * statement encoded and an element's encoded side is any wire value.
 */
function upsertBoard(elements: readonly BoardElement[]) {
  return SqlSchema.findOne({
    Request: Schema.Struct({
      planId: Schema.String,
      revision: Schema.Int,
      updatedBy: Schema.Literals(Object.values(BOARD_AUTHOR)),
      now: Schema.Date,
    }),
    Result: BoardRowSchema,
    execute: ({ planId, revision, updatedBy, now }) =>
      db
        .insert(planBoard)
        .values({ planId, elements, revision, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: planBoard.planId,
          set: { elements, revision, updatedBy, updatedAt: now },
        })
        .returning(BOARD_COLUMNS),
  });
}

/** The board a joined row holds; the empty board where the plan has none yet. */
function boardOf(row: BoardRow): Board {
  if (row.revision === null || row.elements === null) return EMPTY_BOARD;
  return {
    revision: row.revision,
    elements: row.elements,
    ...(row.updatedBy === null ? undefined : { updatedBy: row.updatedBy }),
    ...(row.updatedAt === null ? undefined : { updatedAt: row.updatedAt.getTime() }),
  };
}

/** The plan's board, the empty board before anything was drawn; nothing where the account owns no such plan. */
export function readBoard(userId: string, planId: string): PlanStoreEffect<Option.Option<Board>> {
  return Effect.map(findBoard({ userId, planId }), Option.map(boardOf));
}

/**
 * Writes the board's elements whole over `baseRevision`, as the next
 * revision: saved with the board as written, a conflict with the board as
 * it stands where it moved past the base, or no plan.
 */
export function writeBoard(
  userId: string,
  planId: string,
  baseRevision: number,
  elements: readonly BoardElement[],
  author: BoardAuthor,
): PlanStoreEffect<BoardWrite> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockBoard({ userId, planId });
        if (Option.isNone(locked)) return { outcome: BOARD_WRITE.NO_PLAN } as const;
        const standing = boardOf(locked.value);
        if (standing.revision !== baseRevision) {
          return { outcome: BOARD_WRITE.CONFLICT, board: standing } as const;
        }
        const now = yield* DateTime.nowAsDate;
        const written = yield* upsertBoard(pruneTombstones(elements))({
          planId,
          revision: baseRevision + 1,
          updatedBy: author,
          now,
        }).pipe(
          // An upsert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        return { outcome: BOARD_WRITE.SAVED, board: boardOf(written) } as const;
      }),
    ),
  );
}
