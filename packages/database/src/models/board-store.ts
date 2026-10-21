import {
  type Board,
  type BoardElement,
  boardElementsSchema,
  type DrawingElement,
  drawingElementsSchema,
} from "@luke/features/board-wire";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { task, taskBoard } from "../schemas/task.js";
import { TaskArchived, type TaskStoreEffect, type TaskStoreFailure } from "./task-store.js";
import { reachableTask, taskSeenBy } from "./workspace-store.js";

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
 *
 * Where the board stands is also written for Neon Realtime
 * (`boardLiveStatement`), so the desktop reads it again the moment Luke
 * draws or a save lands rather than when the call's activity suggests one
 * might have.
 */

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const BoardRowSchema = Schema.Struct({
  elements: Schema.NullOr(boardElementsSchema),
  appliedDrawing: Schema.NullOr(Schema.Int),
  drawing: Schema.NullOr(drawingElementsSchema),
  drawingNumber: Schema.NullOr(Schema.Int),
});

type BoardRow = typeof BoardRowSchema.Type;

/** A scene's row as its write returns it: the board, whether it holds an image, and the id of the transaction that wrote it. */
const SavedSceneRowSchema = Schema.Struct({
  ...BoardRowSchema.fields,
  imaged: Schema.Boolean,
  txid: Schema.String,
});

/** The id of the transaction a write runs in, read in the write's own `RETURNING`, as text so its 64 bits stay exact. */
const TXID = sql<string>`pg_current_xact_id()::text`;

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

/** Where the board's live row (`boardLiveStatement`) stands: the drawing the scene holds and whether it holds its image, each null before the board was first written. */
const LiveMarkSchema = Schema.Struct({
  appliedDrawing: Schema.NullOr(Schema.Int),
  imaged: Schema.NullOr(Schema.Boolean),
});

type LiveMark = typeof LiveMarkSchema.Type;

/**
 * The task's id, whether it is archived, and where its board's live row
 * stands, under the task row's lock until the transaction ends; nothing
 * where the account reaches no such task.
 */
const lockTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, archived: Schema.Boolean, ...LiveMarkSchema.fields }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          id: task.id,
          archived: sql<boolean>`${task.archivedAt} is not null`,
          appliedDrawing: taskBoard.appliedDrawing,
          imaged: sql<
            boolean | null
          >`case when ${taskBoard.taskId} is null then null else ${taskBoard.image} is not null end`,
        })
        .from(task)
        .leftJoin(taskBoard, eq(taskBoard.taskId, task.id))
        .where(reachableTask(userId, taskId))
        .for("update", { of: task }),
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
    Result: SavedSceneRowSchema,
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
          .returning({
            ...BOARD_COLUMNS,
            imaged: sql<boolean>`${taskBoard.image} is not null`,
            txid: TXID,
          }),
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
function underTaskLock<A, E>(
  userId: string,
  taskId: string,
  write: (
    now: Date,
    locked: { readonly archived: boolean; readonly mark: LiveMark },
  ) => Effect.Effect<A, E, DatabaseServices>,
) {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockTask({ userId, taskId });
        if (Option.isNone(locked)) return Option.none<A>();
        const now = yield* DateTime.nowAsDate;
        const { archived, appliedDrawing, imaged } = locked.value;
        return Option.some(yield* write(now, { archived, mark: { appliedDrawing, imaged } }));
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
 * and any image of it; the board as written and, where the write moved the
 * board's live row (`boardLiveStatement`), the id of the transaction that
 * wrote it, which a desktop following the board waits on before it
 * confirms the save, as Neon's guide to optimistic mutations has it. A save
 * that leaves that row as it stood, such as one moving only the scene's
 * elements, answers none, since no follower would ever see its
 * transaction. An archived task takes no scene of the developer's, read
 * under the same lock, while a drawing of Luke's on a call that stood when
 * it was archived still lands.
 */
export function writeScene(
  userId: string,
  taskId: string,
  elements: readonly BoardElement[],
  appliedDrawing: number,
  image?: string,
): Effect.Effect<
  Option.Option<{ readonly board: Board; readonly txid?: string }>,
  TaskStoreFailure | TaskArchived,
  DatabaseServices
> {
  return underTaskLock(userId, taskId, (now, { archived, mark }) =>
    Effect.andThen(
      archived ? Effect.fail(new TaskArchived()) : Effect.void,
      upsertScene(
        elements,
        image,
      )({ taskId, appliedDrawing, now }).pipe(
        Effect.catchTag("NoSuchElementError", Effect.die),
        Effect.map((row) => {
          const board = boardOf(row);
          const moved = mark.appliedDrawing !== row.appliedDrawing || mark.imaged !== row.imaged;
          return moved ? { board, txid: row.txid } : { board };
        }),
      ),
    ),
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
    upsertDrawing(drawing)({ taskId, now }).pipe(
      Effect.catchTag("NoSuchElementError", Effect.die),
      Effect.map(boardOf),
    ),
  );
}

/**
 * Where the task's board stands, written for Neon Realtime: the number of
 * Luke's latest drawing, the drawing the scene holds, and whether the scene
 * holds its image, as one row a board, none before the board was first
 * written. It is a mark, none of the elements or the image it marks, which
 * the desktop reads again (`readBoard`) once the row moves. The account is
 * joined through its membership of the task's workspace, as Neon's guide
 * authorizes a live read, and held to the task's GitHub access as every
 * read of it is (`taskSeenBy`), so one that leaves the workspace, or loses
 * the repository a task on its owner's token names, stops seeing the row.
 * None where a value cannot be carried, which a caller answers as the board
 * not being live.
 */
export function boardLiveStatement(userId: string, taskId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          taskId: taskBoard.taskId,
          drawingNumber: taskBoard.drawingNumber,
          appliedDrawing: taskBoard.appliedDrawing,
          imaged: sql<boolean>`${taskBoard.image} is not null`,
        }),
      )
      .from(taskBoard)
      .innerJoin(task, eq(task.id, taskBoard.taskId))
      .innerJoin(
        member,
        and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
      )
      .where(and(eq(taskBoard.taskId, taskId), taskSeenBy(userId))),
  );
}
