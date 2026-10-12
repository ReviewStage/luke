// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import "../file-tree/index";
import { AttachedFileChips } from "./attached-file-chips";

/**
 * The files on a message as chips, and the viewer a press on one opens: an
 * image chip opens the viewer on its picture, the arrows and the arrow keys
 * walk the message's files round from either end, a text file shows its
 * numbered lines, Escape closes and hands focus back to the chip, and a
 * chip's way off in the message box takes it off without opening it. A
 * file other than an image draws its type's icon from the file tree bundle,
 * which the test loads as the window would.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Text as a `data:` URL, as a text attachment carries it. */
function textUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return `data:text/plain;base64,${btoa(String.fromCharCode(...bytes))}`;
}

const SHOT = {
  name: "shot.png",
  mediaType: "image/png",
  url: "data:image/png;base64,iVBORw0KGgo=",
};
const CODE = {
  name: "invite.ts",
  mediaType: "text/plain",
  url: textUrl("const days = 7;\nexport {};\n"),
};
const SPEC = {
  name: "spec.pdf",
  mediaType: "application/pdf",
  url: "data:application/pdf;base64,JVBERi0=",
};
/** A file eve staged before the row was written, which the service kept no bytes of. */
const STAGED = { name: "staged.png", mediaType: "image/png", url: "" };

function mount(files: readonly (typeof SHOT)[], onRemove?: (index: number) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(AttachedFileChips, { files, onRemove })));
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  return {
    container,
    dialog,
    /** The open file's name, as the viewer's title says it. */
    title: () => {
      const shown = dialog();
      const id = shown?.getAttribute("aria-labelledby");
      return id ? document.getElementById(id)?.textContent : undefined;
    },
    open: (name: string) => {
      const chip = container.querySelector<HTMLButtonElement>(`button[aria-label="Open ${name}"]`);
      assert.ok(chip, `${name} opens`);
      // A press on a button focuses it, as Chromium's does, before it acts.
      chip.focus();
      act(() => chip.click());
      return chip;
    },
    key: (key: string) => {
      const target = document.activeElement ?? document.body;
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    },
    press: (label: string) => {
      const button = dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button, `the viewer has ${label}`);
      act(() => button.click());
    },
  };
}

test("an image chip opens the viewer on its picture, saying which of the message's files it is", () => {
  const chips = mount([SHOT, CODE, SPEC]);
  chips.open("shot.png");
  assert.equal(chips.title(), "shot.png");
  assert.equal(chips.dialog()?.querySelector("img")?.getAttribute("src"), SHOT.url);
  assert.match(chips.dialog()?.textContent ?? "", /1 of 3/u);
});

test("the arrows and the arrow keys walk the message's files, round from either end, and a file with no bytes is neither a press nor a stop", () => {
  const chips = mount([SHOT, STAGED, CODE, SPEC]);
  assert.equal(chips.container.querySelector('button[aria-label="Open staged.png"]'), null);
  chips.open("shot.png");
  const walked: (string | null | undefined)[] = [];
  chips.key("ArrowRight");
  walked.push(chips.title());
  chips.press("Next file");
  walked.push(chips.title());
  chips.key("ArrowRight");
  walked.push(chips.title());
  chips.key("ArrowLeft");
  walked.push(chips.title());
  chips.press("Previous file");
  walked.push(chips.title());
  assert.deepEqual(walked, ["invite.ts", "spec.pdf", "shot.png", "spec.pdf", "invite.ts"]);
});

test("a text file shows its lines, numbered, with Copy beside Download", () => {
  const chips = mount([CODE]);
  chips.open("invite.ts");
  const lines = [...(chips.dialog()?.querySelectorAll(".code-line") ?? [])].map((line) => [
    line.querySelector(".code-line-number")?.textContent,
    line.querySelector(".code-line-text")?.textContent,
  ]);
  assert.deepEqual(lines, [
    ["1", "const days = 7;"],
    ["2", "export {};"],
  ]);
  assert.ok(chips.dialog()?.querySelector('button[aria-label="Copy text"]'));
  assert.ok(chips.dialog()?.querySelector('button[aria-label="Download"]'));
});

test("Escape closes the viewer and hands focus back to the chip that opened it", () => {
  const chips = mount([SHOT, CODE]);
  chips.open("invite.ts");
  assert.equal(document.activeElement, chips.dialog());
  chips.key("Escape");
  assert.equal(chips.dialog(), null);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Open invite.ts");
});

test("a chip's way off in the message box takes it off without opening it", () => {
  const removed: number[] = [];
  const chips = mount([SHOT, CODE], (index) => removed.push(index));
  const remove = chips.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove invite.ts"]',
  );
  assert.ok(remove);
  act(() => remove.click());
  assert.deepEqual(removed, [1]);
  assert.equal(chips.dialog(), null);
});

test("a file other than an image draws its type's icon as the file tree does, and an image its thumbnail", () => {
  const chips = mount([SHOT, CODE, SPEC]);
  const icons = [...chips.container.querySelectorAll(".attached-file")].map((chip) => {
    const symbol = chip.querySelector(".file-type-icon use")?.getAttribute("href");
    if (symbol === undefined || symbol === null) return chip.querySelector("img")?.alt;
    // The symbol is drawn from the sheet the bundle added to the document.
    assert.equal(document.querySelector(symbol)?.tagName, "symbol");
    return chip.querySelector(".file-type-icon")?.getAttribute("data-file-type");
  });
  assert.deepEqual(icons, ["shot.png", "typescript", "default"]);
});
