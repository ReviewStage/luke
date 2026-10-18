// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ATTACHMENT_CHIP_STATE, AttachmentChip } from "./attachment-chip.js";

/**
 * attachment-chip.test.ts -- a chip with an open opens its file on a press
 * or a key, one without presses nothing, its way off takes the file off by
 * pointer or keyboard and refuses while unavailable, a reader hears each
 * control by the file's name, and a file still read or failed opens nothing.
 */

const PICTURE = "data:image/png;base64,iVBORw0KGgo=";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** One chip drawn into a list of the page, as its callers draw it. */
function drawn(props: Parameters<typeof AttachmentChip>[0]): HTMLElement {
  const list = document.createElement("ul");
  document.body.append(list);
  const root = createRoot(list);
  roots.push(root);
  act(() => root.render(createElement(AttachmentChip, props)));
  return list;
}

/** The button a reader hears by `name`. */
function button(list: HTMLElement, name: string): HTMLButtonElement {
  const found = [...list.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name,
  );
  return found ?? assert.fail(`a button named ${name}`);
}

/** The names of every button a reader hears. */
function buttonNames(list: HTMLElement): (string | null)[] {
  return [...list.querySelectorAll("button")].map((each) => each.getAttribute("aria-label"));
}

/**
 * A keyboard press: the button is a Tab stop and takes the focus, and a
 * native button turns Enter and Space into its click, which is the browser's.
 */
function pressByKeyboard(target: HTMLButtonElement): void {
  assert.equal(target.tabIndex, 0, "a Tab stop");
  act(() => target.focus());
  assert.equal(document.activeElement, target);
  act(() => target.click());
}

test("a chip with an open opens its file by pointer and by keyboard", () => {
  let opened = 0;
  const list = drawn({ name: "spec.pdf", detail: "12 KB", onOpen: () => (opened += 1) });
  act(() => button(list, "Open spec.pdf").click());
  pressByKeyboard(button(list, "Open spec.pdf"));
  assert.equal(opened, 2);
});

test("a file drawn by name shows its name and what more is said of it", () => {
  const list = drawn({ name: "a-very-long-file-name-that-will-be-cut.yml", detail: "3 KB" });
  assert.equal(list.textContent, "a-very-long-file-name-that-will-be-cut.yml3 KB");
  assert.equal(
    list.querySelector("li")?.getAttribute("title"),
    "a-very-long-file-name-that-will-be-cut.yml",
    "the whole name stands on the chip's hint where its words are cut short",
  );
});

test("a chip without an open or a way off presses nothing", () => {
  const list = drawn({ name: "trace.txt" });
  assert.deepEqual(buttonNames(list), []);
});

test("a picture is its thumbnail, named by the file", () => {
  const list = drawn({ name: "shot.png", image: PICTURE, onOpen: () => undefined });
  const picture = list.querySelector("img") ?? assert.fail("a thumbnail");
  assert.equal(picture.getAttribute("src"), PICTURE);
  assert.equal(picture.getAttribute("alt"), "shot.png");
});

test("the way off takes the file off by pointer and by keyboard, without opening it", () => {
  let opened = 0;
  let removed = 0;
  const list = drawn({
    name: "shot.png",
    image: PICTURE,
    onOpen: () => (opened += 1),
    onRemove: () => (removed += 1),
  });
  assert.deepEqual(buttonNames(list), ["Open shot.png", "Remove shot.png"]);
  act(() => button(list, "Remove shot.png").click());
  pressByKeyboard(button(list, "Remove shot.png"));
  assert.equal(removed, 2);
  assert.equal(opened, 0);
});

test("an unavailable way off refuses its press", () => {
  let removed = 0;
  const list = drawn({
    name: "shot.png",
    image: PICTURE,
    onRemove: () => (removed += 1),
    removeDisabled: true,
  });
  const remove = button(list, "Remove shot.png");
  assert.equal(remove.disabled, true);
  act(() => remove.click());
  assert.equal(removed, 0);
});

test("a file still read says so to a reader and opens nothing", () => {
  const list = drawn({
    name: "shot.png",
    state: ATTACHMENT_CHIP_STATE.LOADING,
    onOpen: () => assert.fail("a chip still read opens nothing"),
  });
  assert.deepEqual(buttonNames(list), []);
  assert.equal(list.querySelector('[role="status"]')?.textContent, "Reading shot.png");
  assert.equal(list.querySelector("img"), null);
});

test("a file that failed to come says why and its size, and opens nothing", () => {
  const list = drawn({
    name: "shot.png",
    image: PICTURE,
    state: ATTACHMENT_CHIP_STATE.FAILED,
    failure: "Not kept",
    detail: "2.4 MB",
    onOpen: () => assert.fail("a failed chip opens nothing"),
  });
  assert.deepEqual(buttonNames(list), []);
  assert.equal(list.textContent, "Not kept2.4 MB");
  assert.equal(list.querySelector("img"), null, "no picture stands for a file that failed");
  assert.equal(list.querySelector("li")?.getAttribute("title"), "shot.png");
});
