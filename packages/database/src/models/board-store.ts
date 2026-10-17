import {
  type Board,
  type BoardElement,
  boardElementsSchema,
  type DrawingElement,
  drawingElementsSchema,
} from "@luke/features/board-wire";
import { eq, isNotNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { task, taskBoard } from "../schemas/task.js";
import { TaskArchived, type TaskStoreEffect, type TaskStoreFailure } from "./task-store.js";
import { reachableTask } from "./workspace-store.js";

/**
 * board-store.ts -- a task's whiteboard: read it, write the Mac's scene, and write Luke's drawing.
 *
 * Two writers share a board and never write the same column. The Mac writes
 * the scene with the number of Luke's drawing it holds; Luke writes his
 * drawing, which takes the next number. Each write is whole and the last one
 * wins: a task's call is one conversation, so the two rarely write in the
 * same moment, and when they do the cost is one edit of the developer's
 * written over by a scene the Mac read a moment before. Each write runs under
 * the task row's own lock, so a task deleted meanwhile reads as gone rather
 * than written back into being. Every statement names the account beside the
 * task, so a task of a workspace the account is not in reads and writes as no
 * task, exactly as in `task-store.ts`, and a board one member saved is read
 * by the rest.
 *
 * The Mac's first save to hold a new drawing of Luke's carries the scene
 * drawn as a PNG, which the board keeps until the next such save, so it
 * shows the drawing the scene holds; only `look_at_board` reads it
 * (`readBoardImage`), and a board read never carries it.
 */

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const BoardRowSchema = Schema.Struct({
  elements: Schema.NullOr(boardElementsSchema),
  appliedDrawing: Schema.NullOr(Schema.Int),
  drawing: Schema.NullOr(drawingElementsSchema),
  drawingNumber: Schema.NullOr(Schema.Int),
});

type BoardRow = typeof BoardRowSchema.Type;

const BOARD_COLUMNS = {
  elements: taskBoard.elements,
  appliedDrawing: taskBoard.appliedDrawing,
  drawing: taskBoard.drawing,
  drawingNumber: taskBoard.drawingNumber,
};

/** A task's board row joined to the task, so a task with no board yet still answers a row of nulls. */
const findBoard = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: BoardRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select(BOARD_COLUMNS)
        .from(task)
        .leftJoin(taskBoard, eq(taskBoard.taskId, task.id))
        .where(reachableTask(userId, taskId))
        .limit(1),
    ),
});

/** The task's id and whether it is archived, under its row's lock until the transaction ends; nothing where the account reaches no such task. */
const lockTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, archived: Schema.Boolean }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, archived: sql<boolean>`${task.archivedAt} is not null` })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

/**
 * The scene written whole, with its image where the save carried one. Note
 * that the elements are closed over rather than carried in the request,
 * because the request is handed to the statement encoded and an element's
 * encoded side is any wire value.
 */
function upsertScene(elements: readonly BoardElement[], image: string | undefined) {
  return SqlSchema.findOne({
    Request: Schema.Struct({ taskId: Schema.String, appliedDrawing: Schema.Int, now: Schema.Date }),
    Result: BoardRowSchema,
    execute: ({ taskId, appliedDrawing, now }) => {
      const scene = { elements, appliedDrawing, updatedAt: now };
      // Note that a save moving to a new drawing with no image drops the old one, which shows a drawing gone.
      const kept = sql`case when ${taskBoard.appliedDrawing} = ${appliedDrawing} then ${taskBoard.image} end`;
      return Database.use((db) =>
        db
          .insert(taskBoard)
          .values({ taskId, ...scene, image: image ?? null })
          .onConflictDoUpdate({
            target: taskBoard.taskId,
            set: { ...scene, image: image ?? kept },
          })
          .returning(BOARD_COLUMNS),
      );
    },
  });
}

/** The board's image, the drawing its scene holds, and Luke's latest drawing's number. */
const BoardImageRowSchema = Schema.Struct({
  image: Schema.NullOr(Schema.String),
  appliedDrawing: Schema.NullOr(Schema.Int),
  drawingNumber: Schema.NullOr(Schema.Int),
});

const findBoardImage = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: BoardImageRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          image: taskBoard.image,
          appliedDrawing: taskBoard.appliedDrawing,
          drawingNumber: taskBoard.drawingNumber,
        })
        .from(task)
        .leftJoin(taskBoard, eq(taskBoard.taskId, task.id))
        .where(reachableTask(userId, taskId))
        .limit(1),
    ),
});

/**
 * Where the plan's board stands for `readBoardImage`, written for Neon
 * Realtime to wake a look on: the drawing numbers and whether an image is
 * kept, never the image itself. None where it names a value Realtime cannot
 * carry.
 */
export function boardImageLiveStatement(
  userId: string,
  taskId: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          taskId: task.id,
          appliedDrawing: taskBoard.appliedDrawing,
          drawingNumber: taskBoard.drawingNumber,
          imaged: isNotNull(taskBoard.image),
        }),
      )
      .from(task)
      .leftJoin(taskBoard, eq(taskBoard.taskId, task.id))
      .where(reachableTask(userId, taskId)),
  );
}

/** Luke's drawing written whole, as the next number. */
function upsertDrawing(drawing: readonly DrawingElement[]) {
  return SqlSchema.findOne({
    Request: Schema.Struct({ taskId: Schema.String, now: Schema.Date }),
    Result: BoardRowSchema,
    execute: ({ taskId, now }) =>
      Database.use((db) =>
        db
          .insert(taskBoard)
          .values({ taskId, drawing, drawingNumber: 1, updatedAt: now })
          .onConflictDoUpdate({
            target: taskBoard.taskId,
            set: { drawing, drawingNumber: sql`${taskBoard.drawingNumber} + 1`, updatedAt: now },
          })
          .returning(BOARD_COLUMNS),
      ),
  });
}

/** The board a joined row holds; the empty board where the task has none yet. */
function boardOf(row: BoardRow): Board {
  const board = { elements: row.elements ?? [], appliedDrawing: row.appliedDrawing ?? 0 };
  if (row.drawing === null || row.drawingNumber === null || row.drawingNumber === 0) return board;
  return { ...board, drawing: { number: row.drawingNumber, elements: row.drawing } };
}

/**
 * Runs one write under the task row's lock, handed whether the task is
 * archived as the lock read it; nothing where the account reaches no such task.
 */
function underTaskLock<E>(
  userId: string,
  taskId: string,
  write: (now: Date, archived: boolean) => Effect.Effect<BoardRow, E, DatabaseServices>,
) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none<Board>();
        const now = yield* DateTime.nowAsDate;
        return Option.some(boardOf(yield* write(now, locked.value.archived)));
      }),
    ),
  );
}

/** The task's board, the empty board before anything was drawn; nothing where the account reaches no such task. */
export function readBoard(userId: string, taskId: string): TaskStoreEffect<Option.Option<Board>> {
  return Effect.map(findBoard({ userId, taskId }), Option.map(boardOf));
}

/**
 * The image of Luke's latest drawing as the Mac drew it on the board, once a
 * save holding that drawing has carried one; none before, and none where the
 * account reaches no such task.
 */
export function readBoardImage(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(findBoardImage({ userId, taskId }), (row) =>
    Option.flatMap(row, ({ image, appliedDrawing, drawingNumber }) =>
      image !== null && appliedDrawing === drawingNumber ? Option.some(image) : Option.none(),
    ),
  );
}

/**
 * The Mac's scene, written whole with the number of Luke's drawing it holds
 * and any image of it; the board as written. An archived task takes no scene
 * of the developer's, read under the same lock, while a drawing of Luke's on
 * a call that stood when it was archived still lands.
 */
export function writeScene(
  userId: string,
  taskId: string,
  elements: readonly BoardElement[],
  appliedDrawing: number,
  image?: string,
): Effect.Effect<Option.Option<Board>, TaskStoreFailure | TaskArchived, DatabaseServices> {
  return underTaskLock(userId, taskId, (now, archived) =>
    archived
      ? Effect.fail(new TaskArchived())
      : upsertScene(
          elements,
          image,
        )({ taskId, appliedDrawing, now }).pipe(Effect.catchTag("NoSuchElementError", Effect.die)),
  );
}

/** Luke's drawing, written whole as the next number; the board as written. */
export function writeDrawing(
  userId: string,
  taskId: string,
  drawing: readonly DrawingElement[],
): TaskStoreEffect<Option.Option<Board>> {
  // An upsert that returned no row is the database breaking its own contract, not an outcome.
  return underTaskLock(userId, taskId, (now) =>
    upsertDrawing(drawing)({ taskId, now }).pipe(Effect.catchTag("NoSuchElementError", Effect.die)),
  );
}
