import assert from "node:assert/strict";
import { test } from "vitest";
import { DRAWING_FAULT, type DrawingRequest, StandingBoard } from "./board-drawing.js";
import { BOARD_ELEMENT_TYPE, DRAWING_STEP_TYPE, LUKE_MARK } from "./board-vocabulary.js";
import { type Board, type BoardElement, type DrawingStep, EMPTY_BOARD } from "./board-wire.js";

function shape(id: string, lukes: boolean): BoardElement {
  const element = { id, type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 };
  return lukes ? { ...element, customData: LUKE_MARK } : element;
}

function box(id: string): DrawingStep {
  return { type: BOARD_ELEMENT_TYPE.RECTANGLE, id, x: 0, y: 0, label: id };
}

function arrow(id: string, from: string, to: string): DrawingStep {
  return { type: BOARD_ELEMENT_TYPE.ARROW, id, from, to };
}

function remove(...ids: string[]): DrawingStep {
  return { type: DRAWING_STEP_TYPE.DELETE, ids };
}

const fresh = (...elements: DrawingStep[]): DrawingRequest => ({ restore: false, elements });
const restored = (...elements: DrawingStep[]): DrawingRequest => ({ restore: true, elements });

/** A board of Luke's "api" and the developer's "note". */
const BOARD: Board = { ...EMPTY_BOARD, elements: [shape("api", true), shape("note", false)] };

test("a fresh drawing may reuse Luke's ids, since it takes his elements off first", () => {
  assert.equal(StandingBoard.of(BOARD).refusalOf(fresh(box("api"))), undefined);
});

test("a restore keeps Luke's elements, so drawing one of their ids again is refused", () => {
  assert.equal(StandingBoard.of(BOARD).refusalOf(restored(box("api"))), DRAWING_FAULT.TAKEN_ID);
});

test("an element is changed by deleting it and drawing it again in the same drawing", () => {
  assert.equal(StandingBoard.of(BOARD).refusalOf(restored(remove("api"), box("api"))), undefined);
});

test("an id used twice in one drawing, or one the developer's element holds, is refused", () => {
  const standing = StandingBoard.of(BOARD);
  assert.equal(standing.refusalOf(fresh(box("db"), box("db"))), DRAWING_FAULT.TAKEN_ID);
  assert.equal(standing.refusalOf(fresh(box("note"))), DRAWING_FAULT.TAKEN_ID);
});

test("only Luke's elements may be deleted", () => {
  const standing = StandingBoard.of(BOARD);
  assert.equal(standing.refusalOf(restored(remove("note"))), DRAWING_FAULT.NOT_LUKES);
  assert.equal(standing.refusalOf(restored(remove("gone"))), DRAWING_FAULT.NOT_LUKES);
  assert.equal(standing.refusalOf(fresh(remove("api"))), DRAWING_FAULT.NOT_LUKES);
});

test("an arrow may join the developer's element, or a shape drawn after it", () => {
  const standing = StandingBoard.of(BOARD);
  assert.equal(standing.refusalOf(fresh(arrow("a1", "db", "note"), box("db"))), undefined);
});

test("an arrow whose end is missing, deleted, or another arrow is refused", () => {
  const standing = StandingBoard.of(BOARD);
  assert.equal(standing.refusalOf(fresh(arrow("a1", "db", "note"))), DRAWING_FAULT.NO_END);
  assert.equal(
    standing.refusalOf(restored(arrow("a1", "api", "note"), remove("api"))),
    DRAWING_FAULT.NO_END,
  );
  assert.equal(
    standing.refusalOf(fresh(box("db"), arrow("a1", "db", "note"), arrow("a2", "a1", "db"))),
    DRAWING_FAULT.NO_END,
  );
});

test("a drawing is checked against the board as the drawings on their way leave it", () => {
  const board: Board = {
    ...BOARD,
    appliedDrawing: 1,
    latestDrawing: 2,
    drawings: [{ number: 2, restore: true, elements: [remove("api"), box("db")] }],
  };
  const standing = StandingBoard.of(board);
  assert.deepEqual(standing.arriving, ["db"]);
  assert.deepEqual(standing.leaving, ["api"]);
  assert.equal(standing.refusalOf(restored(arrow("a1", "db", "note"))), undefined);
  assert.equal(standing.refusalOf(restored(remove("api"))), DRAWING_FAULT.NOT_LUKES);
});

test("a drawing on its way that deletes an element already erased applies without it", () => {
  const board: Board = {
    ...BOARD,
    latestDrawing: 1,
    drawings: [{ number: 1, restore: true, elements: [remove("erased"), box("db")] }],
  };
  assert.deepEqual(StandingBoard.of(board).arriving, ["db"]);
});

test("labels are not elements of their own", () => {
  const label: BoardElement = {
    ...shape("api-label", true),
    type: BOARD_ELEMENT_TYPE.TEXT,
    containerId: "api",
  };
  const standing = StandingBoard.of({ ...BOARD, elements: [...BOARD.elements, label] });
  assert.equal(standing.refusalOf(restored(remove("api-label"))), DRAWING_FAULT.NOT_LUKES);
});
