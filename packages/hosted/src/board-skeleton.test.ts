import assert from "node:assert/strict";
import { Result, Schema } from "effect";
import { test } from "vitest";
import {
  applyBoardOps,
  BOARD_OP,
  BOARD_OP_REFUSAL,
  type BoardOp,
  type BoardSkeleton,
} from "./board-skeleton.js";
import { BOARD_ELEMENT_TYPE, type BoardElement, boardElementsSchema } from "./board-wire.js";

const NOW = 1_800_000_000_000;

function box(id: string, x: number, label?: string): BoardOp {
  const element: BoardSkeleton =
    label === undefined
      ? { type: BOARD_ELEMENT_TYPE.RECTANGLE, id, x, y: 100 }
      : { type: BOARD_ELEMENT_TYPE.RECTANGLE, id, x, y: 100, label };
  return { op: BOARD_OP.ADD, element };
}

function arrow(id: string, from: string, to: string): BoardOp {
  return { op: BOARD_OP.ADD, element: { type: BOARD_ELEMENT_TYPE.ARROW, id, from, to } };
}

function applied(elements: readonly BoardElement[], ops: readonly BoardOp[]) {
  const result = applyBoardOps(elements, ops, NOW);
  assert.ok(Result.isSuccess(result), JSON.stringify(Result.isFailure(result) && result.failure));
  return result.success;
}

function live(elements: readonly BoardElement[], id: string): BoardElement {
  const element = elements.find((candidate) => candidate.id === id && !candidate.isDeleted);
  assert.ok(element, `no live element ${id}`);
  return element;
}

test("a labelled box becomes a rectangle and a text element bound to each other, both readable as board elements", () => {
  const elements = applied([], [box("api", 100, "API")]);
  const api = live(elements, "api");
  const label = elements.find((element) => element.containerId === "api");
  assert.ok(label);
  assert.equal(label.text, "API");
  assert.deepEqual(api.boundElements, [{ id: label.id, type: BOARD_ELEMENT_TYPE.TEXT }]);
  assert.equal(api.width, 200);
  assert.equal(api.height, 80);
  assert.doesNotThrow(() => Schema.decodeUnknownSync(boardElementsSchema)(elements));
});

test("an arrow between two boxes is bound at both ends, runs between their facing edges, and is listed on each box", () => {
  const elements = applied([], [box("api", 0), box("db", 400), arrow("writes", "api", "db")]);
  const run = live(elements, "writes");
  assert.equal(run.startBinding?.elementId, "api");
  assert.equal(run.endBinding?.elementId, "db");
  assert.ok(run.x > 200, "the arrow starts right of the first box");
  assert.ok(run.x + (run.points?.[1]?.[0] ?? 0) < 400, "and stops left of the second");
  for (const id of ["api", "db"]) {
    assert.ok(live(elements, id).boundElements?.some((bound) => bound.id === "writes"));
  }
});

test("moving a box takes its label and its arrows along", () => {
  const first = applied([], [box("api", 0, "API"), box("db", 400), arrow("writes", "api", "db")]);
  const moved = applied(first, [{ op: BOARD_OP.UPDATE, id: "db", x: 400, y: 600 }]);
  const label = moved.find((element) => element.containerId === "api");
  assert.ok(label);
  const run = live(moved, "writes");
  const end = (run.y ?? 0) + (run.points?.[1]?.[1] ?? 0);
  assert.ok(end > 500, "the arrow now ends down at the moved box");
  assert.ok(live(moved, "writes").version > live(first, "writes").version);
});

test("removing a box marks it, its label, and the arrows bound to it deleted, each at a higher version", () => {
  const first = applied([], [box("api", 0, "API"), box("db", 400), arrow("writes", "api", "db")]);
  const removed = applied(first, [{ op: BOARD_OP.REMOVE, id: "api" }]);
  for (const id of ["api", "writes"]) {
    const before = first.find((element) => element.id === id);
    const after = removed.find((element) => element.id === id);
    assert.equal(after?.isDeleted, true, id);
    assert.ok((after?.version ?? 0) > (before?.version ?? 0), id);
  }
  assert.ok(removed.filter((element) => element.containerId === "api").every((e) => e.isDeleted));
  assert.deepEqual(live(removed, "db").boundElements, []);
});

test("an id is reusable once its element was removed, and the new element outranks the tombstone", () => {
  const first = applied([], [box("api", 0)]);
  const removed = applied(first, [{ op: BOARD_OP.REMOVE, id: "api" }]);
  const again = applied(removed, [box("api", 50)]);
  const tombstone = removed.find((element) => element.id === "api");
  assert.ok(live(again, "api").version > (tombstone?.version ?? 0));
  assert.equal(again.filter((element) => element.id === "api").length, 1);
});

test("a batch with one bad operation changes nothing and names the operation and why", () => {
  const first = applied([], [box("api", 0)]);
  const result = applyBoardOps(first, [box("db", 400), arrow("writes", "api", "cache")], NOW);
  assert.deepEqual(result, Result.fail({ at: 1, reason: BOARD_OP_REFUSAL.NO_ELEMENT }));
  assert.deepEqual(
    applyBoardOps(first, [box("api", 10)], NOW),
    Result.fail({ at: 0, reason: BOARD_OP_REFUSAL.ID_TAKEN }),
  );
  assert.deepEqual(
    applyBoardOps(first, [{ op: BOARD_OP.UPDATE, id: "api", from: "api" }], NOW),
    Result.fail({ at: 0, reason: BOARD_OP_REFUSAL.NOT_AN_ARROW }),
  );
});

test("clearing marks every element deleted and keeps each as a tombstone", () => {
  const first = applied([], [box("api", 0, "API"), box("db", 400), arrow("writes", "api", "db")]);
  const cleared = applied(first, [{ op: BOARD_OP.CLEAR }]);
  assert.equal(cleared.length, first.length);
  assert.ok(cleared.every((element) => element.isDeleted));
});

test("an element the developer drew keeps its own fields through an update Luke makes", () => {
  const drawn = {
    id: "Xy3_dev",
    type: BOARD_ELEMENT_TYPE.ELLIPSE,
    x: 10,
    y: 10,
    width: 100,
    height: 50,
    version: 7,
    isDeleted: false,
    fillStyle: "hachure",
    customData: { kept: true },
  } satisfies BoardElement;
  const updated = applied([drawn], [{ op: BOARD_OP.UPDATE, id: "Xy3_dev", label: "Queue" }]);
  const ellipse = live(updated, "Xy3_dev");
  assert.equal(ellipse.fillStyle, "hachure");
  assert.deepEqual(ellipse.customData, { kept: true });
  assert.equal(ellipse.version, 8);
});
