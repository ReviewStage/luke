// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * board-touch.test.ts -- on a phone the whiteboard's controls each take a
 * finger's press, and the column of tools Excalidraw stands at the board's
 * right edge stands whole inside a board 390 or 360 wide, its toolbar's rows
 * clear of it. A mouse keeps Excalidraw's own sizes and its column run off
 * the edge. jsdom lays nothing out and the harness lays the panel's sheets
 * without Excalidraw's, so the board is built in the markup Excalidraw draws
 * (with the classes the workspace's pinned version draws), and the panel's
 * lengths are read off it.
 */

/** The least a finger's press is taken across, in pixels. */
const FINGER = 44;

/** How far Excalidraw insets its controls from the canvas's edges: its own `--editor-container-padding`, 1rem. */
const EDITOR_INSET = 16;

/** The phones' widths the board is drawn at. */
const PHONES = [390, 360] as const;

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** The board as Excalidraw draws it narrower than its phone breakpoint: the toolbar above, and the column of tools at its right. */
function board(): void {
  document.body.innerHTML = `
    <section class="task-board">
      <div class="task-board-canvas">
        <div class="excalidraw excalidraw-container excalidraw--mobile">
          <div class="App-top-bar">
            <section>
              <div class="App-toolbar-container">
                <label class="ToolIcon Shape"><div class="ToolIcon__icon" data-tool></div></label>
              </div>
            </section>
          </div>
          <div class="mobile-misc-tools-container">
            <label class="sidebar-trigger__label-element">
              <div class="sidebar-trigger default-sidebar-trigger" data-rail></div>
            </label>
            <label class="ToolIcon ToolIcon__lock"><div class="ToolIcon__icon" data-rail></div></label>
            <label class="ToolIcon Shape"><div class="ToolIcon__icon" data-rail></div></label>
          </div>
        </div>
      </div>
    </section>`;
}

/** The element `selector` names in the board, which must stand. */
function the(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  assert.ok(element !== null, `${selector} stands`);
  return element;
}

/** A length with every `var()` in it read off `element`, through as many as it names. */
function resolved(element: Element, length: string): string {
  const once = length.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
    getComputedStyle(element).getPropertyValue(name).trim(),
  );
  return once === length ? once : resolved(element, once);
}

/** A length of pixels `element` declares, its roles resolved and its `calc()` worked out. */
function pixels(element: Element, length: string): number {
  const sum = resolved(element, length).replace(/calc/g, "").replace(/px/g, "");
  assert.match(sum, /^[\d\s.+\-*/()]+$/, `${length} is a sum of pixels`);
  return Number(new Function(`return (${sum});`)());
}

test("on a phone every control of the board the panel sizes takes a finger's press, Excalidraw's own buttons with them", () => {
  laid = layContainersAt({}, { touch: true });
  board();
  const excalidraw = the(".excalidraw");
  for (const size of ["--default-button-size", "--lg-button-size"]) {
    assert.ok(pixels(excalidraw, `var(${size})`) >= FINGER, `Excalidraw's ${size}`);
  }
  for (const control of document.querySelectorAll("[data-tool], [data-rail]")) {
    const style = getComputedStyle(control);
    assert.ok(pixels(control, style.width) >= FINGER, `${control.className} is a finger wide`);
    assert.ok(pixels(control, style.height) >= FINGER, `${control.className} is a finger tall`);
  }
});

for (const width of PHONES) {
  test(`on a phone ${width} wide the board's column of tools stands whole inside the board, and its toolbar's rows keep clear of it`, () => {
    laid = layContainersAt({}, { touch: true });
    board();
    const rail = the(".mobile-misc-tools-container");
    const style = getComputedStyle(rail);
    const railWidth = pixels(rail, `var(--default-button-size)`) + 2 * pixels(rail, "1px");
    const railEnd = width - EDITOR_INSET - pixels(rail, style.right);
    const railStart = railEnd - railWidth;
    assert.equal(style.borderRightStyle, "solid", "the column is drawn with its right edge");
    assert.ok(railEnd < width, `it ends at ${railEnd}px, short of the board's edge`);
    assert.ok(railStart >= 0, "it starts inside the board");

    const row = the(".App-top-bar > section");
    const toolbarEnd = width - EDITOR_INSET - pixels(row, getComputedStyle(row).paddingRight);
    assert.ok(toolbarEnd <= railStart, `the toolbar ends at ${toolbarEnd}px, short of the column`);
    assert.ok(toolbarEnd - EDITOR_INSET >= 2 * FINGER, "and still holds a row of tools");
  });
}

test("with a mouse the board keeps Excalidraw's own sizes and its column of tools run off the edge", () => {
  laid = layContainersAt({}, { touch: false });
  board();
  assert.equal(getComputedStyle(the(".excalidraw")).getPropertyValue("--default-button-size"), "");
  assert.equal(getComputedStyle(the(".mobile-misc-tools-container")).right, "auto");
});
