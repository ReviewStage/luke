import {
  type Board,
  type BoardElement,
  boardElementsSchema,
  type DrawingElement,
  drawingElementsSchema,
} from "@sidecar/hosted/board-wire";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { plan, planBoard } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { PlanStoreEffect } from "./plan-store.js";

/**
 * board-store.ts -- a plan's whiteboard: read it, write the Mac's scene, and write Luke's drawing.
 *
 * Two writers share a board and never write the same column. The Mac writes
 * the scene with the number of Luke's drawing it holds; Luke writes his
 * drawing, which takes the next number. Each write is whole and the last one
 * wins: the planning call is one conversation, so the two rarely write in the
 * same moment, and when they do the cost is one edit of the developer's
 * written over by a scene the Mac read a moment before. Each write runs under
 * the plan row's own lock, so a plan deleted meanwhile reads as gone rather
 * than written back into being. Every statement names the account beside the
 * plan, so a plan another account owns reads and writes as no plan, exactly
 * as in `plan-store.ts`.
 */

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const BoardRowSchema = Schema.Struct({
  elements: Schema.NullOr(boardElementsSchema),
  appliedDrawing: Schema.NullOr(Schema.Int),
  drawing: Schema.NullOr(drawingElementsSchema),
  drawingNumber: Schema.NullOr(Schema.Int),
});

type BoardRow = typeof BoardRowSchema.Type;

const BOARD_COLUMNS = {
  elements: planBoard.elements,
  appliedDrawing: planBoard.appliedDrawing,
  drawing: planBoard.drawing,
  drawingNumber: planBoard.drawingNumber,
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

/** The plan's id under its row's lock until the transaction ends; nothing where the account owns no such plan. */
const lockPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId }) =>
    db.select({ id: plan.id }).from(plan).where(ownedPlan(userId, planId)).for("update"),
});

/**
 * The scene written whole. Note that the elements are closed over rather
 * than carried in the request, because the request is handed to the
 * statement encoded and an element's encoded side is any wire value.
 */
function upsertScene(elements: readonly BoardElement[]) {
  return SqlSchema.findOne({
    Request: Schema.Struct({ planId: Schema.String, appliedDrawing: Schema.Int, now: Schema.Date }),
    Result: BoardRowSchema,
    execute: ({ planId, appliedDrawing, now }) =>
      db
        .insert(planBoard)
        .values({ planId, elements, appliedDrawing, updatedAt: now })
        .onConflictDoUpdate({
          target: planBoard.planId,
          set: { elements, appliedDrawing, updatedAt: now },
        })
        .returning(BOARD_COLUMNS),
  });
}

/** Luke's drawing written whole, as the next number. */
function upsertDrawing(drawing: readonly DrawingElement[]) {
  return SqlSchema.findOne({
    Request: Schema.Struct({ planId: Schema.String, now: Schema.Date }),
    Result: BoardRowSchema,
    execute: ({ planId, now }) =>
      db
        .insert(planBoard)
        .values({ planId, drawing, drawingNumber: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: planBoard.planId,
          set: { drawing, drawingNumber: sql`${planBoard.drawingNumber} + 1`, updatedAt: now },
        })
        .returning(BOARD_COLUMNS),
  });
}

/** The board a joined row holds; the empty board where the plan has none yet. */
function boardOf(row: BoardRow): Board {
  const board = { elements: row.elements ?? [], appliedDrawing: row.appliedDrawing ?? 0 };
  if (row.drawing === null || row.drawingNumber === null || row.drawingNumber === 0) return board;
  return { ...board, drawing: { number: row.drawingNumber, elements: row.drawing } };
}

/** Runs one write under the plan row's lock; nothing where the account owns no such plan. */
function underPlanLock<E>(
  userId: string,
  planId: string,
  write: (now: Date) => Effect.Effect<BoardRow, E, SqlClient.SqlClient>,
) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockPlan({ userId, planId }))) return Option.none<Board>();
        const now = yield* DateTime.nowAsDate;
        return Option.some(boardOf(yield* write(now)));
      }),
    ),
  );
}

/** The plan's board, the empty board before anything was drawn; nothing where the account owns no such plan. */
export function readBoard(userId: string, planId: string): PlanStoreEffect<Option.Option<Board>> {
  return Effect.map(findBoard({ userId, planId }), Option.map(boardOf));
}

/** The Mac's scene, written whole with the number of Luke's drawing it holds; the board as written. */
export function writeScene(
  userId: string,
  planId: string,
  elements: readonly BoardElement[],
  appliedDrawing: number,
): PlanStoreEffect<Option.Option<Board>> {
  return underPlanLock(userId, planId, (now) =>
    upsertScene(elements)({ planId, appliedDrawing, now }).pipe(
      Effect.catchTag("NoSuchElementError", Effect.die),
    ),
  );
}

/** Luke's drawing, written whole as the next number; the board as written. */
export function writeDrawing(
  userId: string,
  planId: string,
  drawing: readonly DrawingElement[],
): PlanStoreEffect<Option.Option<Board>> {
  // An upsert that returned no row is the database breaking its own contract, not an outcome.
  return underPlanLock(userId, planId, (now) =>
    upsertDrawing(drawing)({ planId, now }).pipe(Effect.catchTag("NoSuchElementError", Effect.die)),
  );
}
