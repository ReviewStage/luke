import assert from "node:assert/strict";
import { test } from "vitest";
import { BOARD_TEXT_MAX_CHARS, boardText } from "./board-text.js";
import { BOARD_ELEMENT_TYPE } from "./board-vocabulary.js";
import type { BoardElement } from "./board-wire.js";

/** A shape as the Mac's canvas stores one. */
function shape(id: string, type: BoardElement["type"], x: number): BoardElement {
  return { id, type, x, y: 0, width: 200, height: 80, roughness: 1 };
}

function label(container: string, text: string): BoardElement {
  return {
    ...shape(`${container}-label`, BOARD_ELEMENT_TYPE.TEXT, 0),
    text,
    containerId: container,
  };
}

test("an empty board reads as empty", () => {
  assert.equal(boardText({ elements: [], appliedDrawing: 0 }), "[board]\nThe board is empty.");
});

test("shapes read with their labels and boxes, free text with its place, and arrows as the ids they join", () => {
  const writes: BoardElement = {
    ...shape("writes", BOARD_ELEMENT_TYPE.ARROW, 208),
    y: 40,
    points: [
      [0, 0],
      [184, 0],
    ],
    startBinding: { elementId: "api", focus: 0, gap: 8 },
    endBinding: { elementId: "db", focus: 0, gap: 8 },
  };
  const elements = [
    shape("api", BOARD_ELEMENT_TYPE.RECTANGLE, 0),
    label("api", "API"),
    shape("db", BOARD_ELEMENT_TYPE.ELLIPSE, 400),
    label("db", "Postgres"),
    writes,
    label("writes", "writes"),
    { ...shape("title", BOARD_ELEMENT_TYPE.TEXT, 0), y: -60, text: "Phase 1" },
  ];

  assert.equal(
    boardText({ elements, appliedDrawing: 1, drawing: { number: 1, elements: [] } }),
    [
      "[board]",
      'shapes: api rectangle "API" at 0,0 200x80 | db ellipse "Postgres" at 400,0 200x80',
      'text: title "Phase 1" at 0,-60',
      'arrows: writes api -> db "writes"',
    ].join("\n"),
  );
});

test("an arrow whose shape was erased reads as ending at a point, and freehand strokes are only counted", () => {
  const dangling: BoardElement = {
    ...shape("a1", BOARD_ELEMENT_TYPE.ARROW, 10),
    y: 20,
    points: [
      [0, 0],
      [100, 0],
    ],
    startBinding: { elementId: "gone", focus: 0, gap: 8 },
    endBinding: null,
  };
  assert.equal(
    boardText({
      elements: [shape("s1", BOARD_ELEMENT_TYPE.FREEDRAW, 0), dangling],
      appliedDrawing: 0,
    }),
    "[board]\narrows: a1 (10,20) -> (110,20)\nother: 1 freehand stroke",
  );
});

test("a drawing the Mac has not put on the board yet is said to be on its way", () => {
  const text = boardText({ elements: [], appliedDrawing: 1, drawing: { number: 2, elements: [] } });
  assert.match(text, /^\[board\]\nYour latest drawing is not on the board yet/u);
});

test("a crowded board is cut at its bound and says how much was left out", () => {
  const elements = Array.from({ length: 400 }, (_, at) => [
    shape(`box-${at}`, BOARD_ELEMENT_TYPE.RECTANGLE, at * 10),
    label(`box-${at}`, "a label of some length"),
  ]).flat();
  const text = boardText({ elements, appliedDrawing: 0 });
  assert.ok(text.length <= BOARD_TEXT_MAX_CHARS + 40);
  assert.match(text, /… \d+ more not shown$/u);
});
