// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";

/**
 * attached-file-chips.test.ts -- the message box's way off takes a file off
 * on the press, so the box no longer holds it, while the row keeps its chip
 * drawn, out of reach, as it scales out, and takes it once that has played;
 * of two files alike, the one pressed is the one taken off; and a file the
 * box takes on scales in.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The motion tokens the row reads, as the app's sheets set them. */
const TOKENS = {
  "--luke-duration-exit": "90ms",
  "--luke-motion-exit": "ease",
  "--luke-duration-quick": "140ms",
  "--luke-duration-shape": "460ms",
  "--luke-spring": "ease-out",
  "--luke-row-stagger": "32ms",
  "--luke-list-travel": "16px",
} as const;

/** A motion played: the element it played on, its keyframes, and a way to have it finish. */
interface Played {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly finish: () => void;
}

/** How wide a chip is drawn, side by side in its row. */
const CHIP = 120;

const SPEC: CodingAgentAttachment = {
  name: "spec.pdf",
  mediaType: "application/pdf",
  data: "JVBERi0=",
};
const NOTES: CodingAgentAttachment = { name: "notes.txt", mediaType: "text/plain", data: "aGk=" };

let root: Root | undefined;
let played: Played[] = [];

beforeEach(() => {
  played = [];
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const motion = { onfinish: null as (() => void) | null, cancel: () => undefined };
      played.push({ element: this, keyframes, finish: () => motion.onfinish?.() });
      return motion;
    },
  });
  // Note that each chip stands after the chips before it still in the row's layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = this.parentElement;
    if (!this.matches("li") || row === null) return new DOMRect(0, 0, 0, 0);
    const laidOut = [...row.children].filter(
      (each) => each instanceof HTMLElement && each.style.position !== "absolute",
    );
    const left =
      this.style.position === "absolute"
        ? Number.parseFloat(this.style.left)
        : laidOut.indexOf(this) * CHIP;
    return new DOMRect(left, 0, CHIP, 48);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
});

/** A message box holding `start`, taking a file off by its place as the box does, and on with Add. */
function Box({
  start,
  held,
}: {
  start: readonly CodingAgentAttachment[];
  held: { now: readonly CodingAgentAttachment[] };
}): React.JSX.Element {
  const [files, setFiles] = useState(start);
  held.now = files;
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setFiles([...files, NOTES]) }, "Add"),
    createElement(AttachedFileChips, {
      files: attachmentChips(files),
      onRemove: (index: number) => setFiles(files.filter((_, at) => at !== index)),
    }),
  );
}

function draw(start: readonly CodingAgentAttachment[]) {
  const held = { now: start };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Box, { start, held })));
  return held;
}

/** The chips drawn, in order, by the name their way off is heard by. */
function chips(): HTMLLIElement[] {
  return [...document.querySelectorAll<HTMLLIElement>("li.luke-attachment-chip")];
}

function remove(chip: HTMLLIElement | undefined): void {
  const off = chip?.querySelector<HTMLButtonElement>("button[aria-label^='Remove']");
  act(() => (off ?? assert.fail("a way off")).click());
}

const finishAll = () =>
  act(() => {
    for (const motion of played.splice(0)) motion.finish();
  });

test("the way off takes the file off on the press, and its chip scales out out of reach before it goes", () => {
  const held = draw([SPEC, NOTES]);
  remove(chips()[0]);
  assert.deepEqual(held.now, [NOTES], "the box no longer holds it");
  const leaving = chips().find((chip) => chip.hasAttribute("data-leaving"));
  assert.equal(leaving?.title, "spec.pdf", "drawn through its exit");
  assert.equal(leaving?.hasAttribute("inert"), true);
  const scaled = played
    .filter((motion) => motion.element === leaving)
    .some((motion) => motion.keyframes.some((frame) => String(frame.transform).includes("scale")));
  assert.ok(scaled, "it scales out");
  finishAll();
  assert.deepEqual(
    chips().map((chip) => chip.title),
    ["notes.txt"],
  );
});

test("of two files alike, the one whose way off is pressed is the one taken off", () => {
  const twin = { ...SPEC };
  const held = draw([SPEC, twin]);
  remove(chips()[1]);
  assert.equal(held.now.length, 1);
  assert.equal(held.now[0], SPEC, "the first stays");
  finishAll();
  assert.equal(chips().length, 1);
});

test("a file the box takes on scales in", () => {
  draw([SPEC]);
  act(() => document.querySelector<HTMLButtonElement>("button")?.click());
  const arrived = chips().at(-1);
  assert.equal(arrived?.title, "notes.txt");
  const scaled = played
    .filter((motion) => motion.element === arrived)
    .some((motion) => motion.keyframes.some((frame) => String(frame.transform).includes("scale")));
  assert.ok(scaled, "it scales in");
});
