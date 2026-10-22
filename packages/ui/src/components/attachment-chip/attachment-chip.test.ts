// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { ATTACHMENT_CHIP_STATE, AttachmentChip } from "./attachment-chip.js";

/**
 * attachment-chip.test.ts -- a chip with an open opens its file on a press
 * or a key, one without presses nothing, its way off takes the file off by
 * pointer or keyboard, once the chip has scaled out, and refuses while
 * unavailable, a reader hears each
 * control by the file's name, and a file still read or failed opens nothing.
 * A file's name fades out at its end only while the chip cuts it short.
 */

const PICTURE = "data:image/png;base64,iVBORw0KGgo=";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** The measurement each observed box was handed, fired as a resize; jsdom lays nothing out, so nothing reports one of its own accord. */
const resizes: (() => void)[] = [];

class StandInResizeObserver {
  readonly #fire: () => void;
  constructor(fire: () => void) {
    this.#fire = fire;
  }
  observe(): void {
    resizes.push(this.#fire);
  }
  disconnect(): void {}
}

/** Stands every box's words `wide` pixels in a box 100px wide, and fires every observed box's measurement, as a resize would. */
function resize(wide: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(wide);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  act(() => {
    for (const fire of resizes) fire();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  resizes.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

test("the way off holds the chip drawn and inert through its exit, and takes the file off once it is done", () => {
  const exits = holdExits();
  let removed = 0;
  try {
    const list = drawn({ name: "spec.pdf", onRemove: () => (removed += 1) });
    act(() => button(list, "Remove spec.pdf").click());
    const chip = list.querySelector("li");
    assert.equal(chip?.getAttribute("data-leaving"), "true");
    assert.equal(chip?.hasAttribute("inert"), true);
    assert.equal(removed, 0, "not taken on the frame of the press");
    act(() => exits.finish());
    assert.equal(removed, 1);
  } finally {
    exits.restore();
  }
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

test("a file's name fades out at its end only while the chip cuts it short", () => {
  const list = drawn({ name: "quarterly-report-final.pdf", icon: null, detail: "2 MB" });
  const name = () => list.querySelector(".luke-attachment-chip-name");
  resize(80);
  assert.equal(name()?.getAttribute("data-end"), "fade");
  assert.equal(name()?.getAttribute("data-overflow"), "false");
  resize(160);
  assert.equal(name()?.getAttribute("data-overflow"), "true");
});
