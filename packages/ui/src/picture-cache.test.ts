// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  forgetPictures,
  keepPictureRead,
  PICTURE_BYTE_BUDGET,
  PICTURE_STATE,
  type PictureAnswer,
  pictureNow,
  usePicture,
} from "./picture-cache.js";

/**
 * picture-cache.test.ts -- the pictures a window keeps stand within a byte
 * budget: the one drawn longest ago is let go first, and the newest stays.
 * Synthetic URLs of the size the case needs.
 */

const OWNER = "plan-1";

/** A quarter of the budget, so five pictures pass it and four fill it. */
const QUARTER = PICTURE_BYTE_BUDGET / 4;

/** A `data:` URL of `size` characters. */
function urlOf(size: number): string {
  return `data:image/png;base64,${"A".repeat(size - "data:image/png;base64,".length)}`;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  forgetPictures();
});

test("pictures kept past the budget let go of the one drawn longest ago and keep the newest", () => {
  for (const id of ["a", "b", "c", "d"]) keepPictureRead(OWNER, id, urlOf(QUARTER));

  keepPictureRead(OWNER, "e", urlOf(QUARTER));

  assert.equal(pictureNow(OWNER, "a").kind, PICTURE_STATE.READING, "the eldest is let go");
  for (const id of ["b", "c", "d", "e"])
    assert.equal(pictureNow(OWNER, id).kind, PICTURE_STATE.READY);
});

test("a picture drawn again is the newest, so another is let go in its place", () => {
  for (const id of ["a", "b", "c", "d"]) keepPictureRead(OWNER, id, urlOf(QUARTER));
  pictureNow(OWNER, "a");

  keepPictureRead(OWNER, "e", urlOf(QUARTER));

  assert.equal(pictureNow(OWNER, "b").kind, PICTURE_STATE.READING);
  for (const id of ["a", "c", "d", "e"])
    assert.equal(pictureNow(OWNER, id).kind, PICTURE_STATE.READY);
});

test("a picture larger than the budget is kept alone", () => {
  keepPictureRead(OWNER, "small", urlOf(QUARTER));
  keepPictureRead(OWNER, "huge", urlOf(PICTURE_BYTE_BUDGET + 1));

  assert.equal(pictureNow(OWNER, "small").kind, PICTURE_STATE.READING);
  assert.equal(pictureNow(OWNER, "huge").kind, PICTURE_STATE.READY);
});

test("once the window lets go of every picture, the budget counts from nothing", () => {
  for (const id of ["a", "b", "c", "d"]) keepPictureRead(OWNER, id, urlOf(QUARTER));
  forgetPictures();

  for (const id of ["a", "b", "c", "d"]) keepPictureRead(OWNER, id, urlOf(QUARTER));

  for (const id of ["a", "b", "c", "d"])
    assert.equal(pictureNow(OWNER, id).kind, PICTURE_STATE.READY);
});

test("pictures drawn together past the budget all land, none sent back to reading", async () => {
  const answers = new Map<string, (answer: PictureAnswer) => void>();
  const read = (_owner: string, id: string) =>
    new Promise<PictureAnswer>((answer) => {
      answers.set(id, answer);
    });
  const ids = ["a", "b", "c", "d", "e", "f"];
  const shown = new Map<string, string>();
  function Picture({ id }: { id: string }): ReactElement | null {
    shown.set(id, usePicture(OWNER, id, read).kind);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(
      createElement("div", null, ...ids.map((id) => createElement(Picture, { key: id, id }))),
    ),
  );

  // Each picture is a quarter of the budget, as base64 under its type.
  const base64 = "A".repeat(QUARTER - "data:image/png;base64,".length);
  await act(async () => {
    for (const answer of answers.values()) answer({ contentType: "image/png", base64 });
  });

  assert.deepEqual(
    [...shown.values()],
    ids.map(() => PICTURE_STATE.READY),
  );
});

test("pictures read ahead and drawn nowhere are let go by the budget, the newest kept", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const base64 = "A".repeat(QUARTER - "data:image/png;base64,".length);
  const read = () => Promise.resolve<PictureAnswer>({ contentType: "image/png", base64 });
  function Ahead({ id }: { id: string }): null {
    usePicture(OWNER, id, read, false);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(
      createElement("div", null, ...ids.map((id) => createElement(Ahead, { key: id, id }))),
    ),
  );

  assert.equal(pictureNow(OWNER, "a").kind, PICTURE_STATE.READING);
  assert.equal(pictureNow(OWNER, "f").kind, PICTURE_STATE.READY);
});
