import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-wire";
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

test("a pasted image or embed stays on the canvas, and every element the board admits is sent as the canvas holds it", () => {
  const image = { ...box, id: "shot", type: "image", fileId: "f1", status: "saved" };
  const embed = { ...box, id: "page", type: "embeddable", link: "https://example.com" };
  const erased = { ...box, id: "old", version: 9, isDeleted: true };

  assert.deepEqual(admittedElements([box, image, embed, erased]), [box, erased]);
});

test("an element the board cannot read is left out rather than refusing the whole scene", () => {
  const unversioned = { ...box, id: "half", version: "3" };
  assert.deepEqual(admittedElements([unversioned, box]), [box]);
});
