import assert from "node:assert/strict";
import { Result } from "effect";
import { test } from "vitest";
import { applyBoardOps, BOARD_OP, type BoardOp } from "./board-skeleton.js";
import { BOARD_TEXT_MAX_CHARS, boardText } from "./board-text.js";
import { BOARD_AUTHOR, BOARD_ELEMENT_TYPE, type BoardElement } from "./board-wire.js";

const NOW = 1_800_000_000_000;

function drawn(ops: readonly BoardOp[]): readonly BoardElement[] {
  const result = applyBoardOps([], ops, NOW);
  assert.ok(Result.isSuccess(result));
  return result.success;
}

test("an empty board reads as empty under its revision", () => {
  assert.equal(boardText({ revision: 0, elements: [] }), "[board] revision 0\nThe board is empty.");
});

test("shapes read with their labels and boxes, and arrows as the ids they join", () => {
  const elements = drawn([
    {
      op: BOARD_OP.ADD,
      element: { type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" },
    },
    {
      op: BOARD_OP.ADD,
      element: { type: BOARD_ELEMENT_TYPE.ELLIPSE, id: "db", x: 400, y: 0, label: "Postgres" },
    },
    {
      op: BOARD_OP.ADD,
      element: {
        type: BOARD_ELEMENT_TYPE.ARROW,
        id: "writes",
        from: "api",
        to: "db",
        label: "writes",
      },
    },
    {
      op: BOARD_OP.ADD,
      element: { type: BOARD_ELEMENT_TYPE.TEXT, id: "title", x: 0, y: -60, text: "Phase 1" },
    },
  ]);
  const text = boardText({ revision: 3, elements, updatedBy: BOARD_AUTHOR.DEVELOPER });
  assert.equal(
    text,
    [
      "[board] revision 3, last changed by the developer",
      'shapes: api rectangle "API" at 0,0 200x80 | db ellipse "Postgres" at 400,0 200x80',
      'text: title "Phase 1" at 0,-60',
      'arrows: writes api -> db "writes"',
    ].join("\n"),
  );
});

test("an arrow whose shape was removed reads as ending at a point, and freehand strokes are only counted", () => {
  const stroke = {
    id: "s1",
    type: BOARD_ELEMENT_TYPE.FREEDRAW,
    x: 0,
    y: 0,
    width: 5,
    height: 5,
    version: 1,
    isDeleted: false,
  } satisfies BoardElement;
  const dangling = {
    id: "a1",
    type: BOARD_ELEMENT_TYPE.ARROW,
    x: 10,
    y: 20,
    width: 100,
    height: 0,
    version: 2,
    isDeleted: false,
    points: [
      [0, 0],
      [100, 0],
    ],
    startBinding: { elementId: "gone", focus: 0, gap: 8 },
    endBinding: null,
  } satisfies BoardElement;
  assert.equal(
    boardText({ revision: 1, elements: [stroke, dangling] }),
    "[board] revision 1\narrows: a1 (10,20) -> (110,20)\nother: 1 freehand stroke",
  );
});

test("a crowded board is cut at its bound and says how much was left out", () => {
  const ops: BoardOp[] = Array.from({ length: 400 }, (_, at) => ({
    op: BOARD_OP.ADD,
    element: {
      type: BOARD_ELEMENT_TYPE.RECTANGLE,
      id: `box-${at}`,
      x: at * 10,
      y: 0,
      label: "a label of some length",
    },
  }));
  const text = boardText({ revision: 1, elements: drawn(ops) });
  assert.ok(text.length <= BOARD_TEXT_MAX_CHARS + 40);
  assert.match(text, /… \d+ more not shown$/);
});
