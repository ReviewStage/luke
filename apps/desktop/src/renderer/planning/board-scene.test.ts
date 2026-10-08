import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { test } from "vitest";
import { admittedElements } from "./board-scene";

const box = {
  id: "api",
  type: BOARD_ELEMENT_TYPE.RECTANGLE,
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  version: 3,
  isDeleted: false,
  roughness: 1,
};

test("a pasted image, an embed, or an erased element stays on the canvas, and every other element is sent as the canvas holds it", () => {
  const image = { ...box, id: "shot", type: "image", fileId: "f1", status: "saved" };
  const embed = { ...box, id: "page", type: "embeddable", link: "https://example.com" };
  const erased = { ...box, id: "old", version: 9, isDeleted: true };

  assert.deepEqual(admittedElements([box, image, embed, erased]), [box]);
});

test("an element the board cannot read is left out rather than refusing the whole scene", () => {
  const unplaced = { ...box, id: "half", x: "left" };
  assert.deepEqual(admittedElements([unplaced, box]), [box]);
});
