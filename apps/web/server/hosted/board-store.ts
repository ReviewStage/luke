import type { DrawingFault, DrawingRequest } from "@sidecar/hosted/board-drawing";
import {
  type Board,
  type BoardElement,
  boardElementsSchema,
  type Drawing,
  drawingSchema,
} from "@sidecar/hosted/board-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { plan, planBoard } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { PlanStoreEffect } from "./plan-store.js";

/**
 * board-store.ts -- a plan's whiteboard: read it, write the Mac's scene, and add Luke's drawing.
 *
 * The Mac writes the scene whole with the number of Luke's drawing it holds,
 * the last write winning: the planning call is one conversation, so the two
 * writers rarely write in the same moment, and when they do the cost is one
 * edit of the developer's written over by a scene the Mac read a moment
 * before. Luke adds a drawing, which takes the next number, to the drawings
 * the scene does not hold yet; a scene's write drops the drawings it says it
 * holds. A drawing is held to the board as it will stand before it is added
 * (`board-drawing.ts`), and both writes read the board under the plan row's
 * own lock, so a plan deleted meanwhile reads as gone rather than written back
 * into being, and a drawing is checked against the board it is added to. Every statement names the account beside the
 * plan, so a plan another account owns reads and writes as no plan, exactly
 * as in `plan-store.ts`.
 */

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const BoardRowSchema = Schema.Struct({
  elements: Schema.NullOr(boardElementsSchema),
  appliedDrawing: Schema.NullOr(Schema.Int),
  drawings: Schema.NullOr(Schema.Array(drawingSchema)),
  drawingNumber: Schema.NullOr(Schema.Int),
});

type BoardRow = typeof BoardRowSchema.Type;

const BOARD_COLUMNS = {
  elements: planBoard.elements,
  appliedDrawing: planBoard.appliedDrawing,
  drawings: planBoard.drawings,
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

/** The board's row as a write leaves it. */
interface BoardWrite {
  readonly elements: readonly BoardElement[];
  readonly appliedDrawing: number;
  readonly drawings: readonly Drawing[];
  readonly drawingNumber: number;
}

/**
 * The board's row written whole. Note that the values are closed over rather
 * than carried in the request, because the request is handed to the
 * statement encoded and an element's encoded side is any wire value.
 */
function upsertBoard(write: BoardWrite) {
  return SqlSchema.findOne({
    Request: Schema.Struct({ planId: Schema.String, now: Schema.Date }),
    Result: BoardRowSchema,
    execute: ({ planId, now }) =>
      db
        .insert(planBoard)
        .values({ planId, ...write, updatedAt: now })
        .onConflictDoUpdate({ target: planBoard.planId, set: { ...write, updatedAt: now } })
        .returning(BOARD_COLUMNS),
  });
}

/** The board a joined row holds; the empty board where the plan has none yet. */
function boardOf(row: BoardRow): Board {
  const appliedDrawing = row.appliedDrawing ?? 0;
  return {
    elements: row.elements ?? [],
    appliedDrawing,
    latestDrawing: row.drawingNumber ?? 0,
    drawings: (row.drawings ?? []).filter((drawing) => drawing.number > appliedDrawing),
  };
}

/** The row a board is written back as. */
function writeOf(board: Board): BoardWrite {
  return {
    elements: board.elements,
    appliedDrawing: board.appliedDrawing,
    drawings: board.drawings,
    drawingNumber: board.latestDrawing,
  };
}

/**
 * Runs one write under the plan row's lock, handed the board as it stands;
 * nothing where the account owns no such plan. The write answers the board
 * to store, or why it stores nothing.
 */
function underPlanLock<A>(
  userId: string,
  planId: string,
  write: (board: Board) => Result.Result<Board, A>,
) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockPlan({ userId, planId })))
          return Option.none<Result.Result<Board, A>>();
        const standing = yield* findBoard({ userId, planId });
        const next = write(boardOf(Option.getOrThrow(standing)));
        if (Result.isFailure(next)) return Option.some(next);
        const now = yield* DateTime.nowAsDate;
        // An upsert that returned no row is the database breaking its own contract, not an outcome.
        const row = yield* upsertBoard(writeOf(next.success))({ planId, now }).pipe(
          Effect.catchTag("NoSuchElementError", Effect.die),
        );
        return Option.some(Result.succeed(boardOf(row)));
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
  return underPlanLock<never>(userId, planId, (board) =>
    Result.succeed({
      ...board,
      elements,
      appliedDrawing,
      drawings: board.drawings.filter((drawing) => drawing.number > appliedDrawing),
    }),
  ).pipe(Effect.map(Option.map(Result.getOrThrow)));
}

/**
 * Luke's drawing, added as the next number where `refusalOf` finds nothing
 * wrong with it on the board as it stands; the board as written, or why the
 * drawing was refused.
 */
export function addDrawing(
  userId: string,
  planId: string,
  request: DrawingRequest,
  refusalOf: (board: Board) => DrawingFault | undefined,
): PlanStoreEffect<Option.Option<Result.Result<Board, DrawingFault>>> {
  return underPlanLock(userId, planId, (board) => {
    const refusal = refusalOf(board);
    if (refusal !== undefined) return Result.fail(refusal);
    const number = board.latestDrawing + 1;
    return Result.succeed({
      ...board,
      latestDrawing: number,
      drawings: [...board.drawings, { number, ...request }],
    });
  });
}
