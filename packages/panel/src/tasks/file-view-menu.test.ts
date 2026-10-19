/**
 * file-view-menu.test.ts -- the end of a File tab's bar as the developer meets it: View settings offering the settings a File tab's lines follow, its wrap, numbers, and type, each drawn at once, and a ⋯ of actions alone, its Copy path copying the file's path. Synthetic files only.
 */

// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { CodeLinesView, useLinesLook } from "./code-lines.js";
import { WHOLE_TEXT } from "./file-tab-model.js";
import { FileViewMenu } from "./file-view.js";

const PATH = "src/billing/plan.ts";

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({});
  handSettings();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A File tab's lines as the tab draws them, in the look it reads. */
function DrawnLines(): React.JSX.Element {
  return createElement(CodeLinesView, {
    look: useLinesLook(),
    firstLine: 1,
    lines: [[{ text: "const seats = 3;" }]],
    pointed: { path: PATH },
  });
}

/** How the drawn lines stand: their numbers, their wrap, and the type their box names. */
function drawnLines(container: HTMLElement) {
  const box = container.querySelector<HTMLElement>(".code-lines") ?? assert.fail("lines are drawn");
  return {
    numbers: box.dataset.lineNumbers,
    wrap: box.dataset.wrap,
    font: box.style.getPropertyValue("--code-font"),
    size: box.style.getPropertyValue("--code-font-size"),
    lineHeight: box.style.getPropertyValue("--code-line-height"),
    features: box.style.getPropertyValue("--code-font-features"),
  };
}

/** Draws the bar's end beside the look the tab's lines follow. */
function mount(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          "div",
          null,
          createElement(FileViewMenu, {
            path: PATH,
            ready: true,
            readText: () => Promise.resolve({ kind: WHOLE_TEXT.READ, text: "" }),
          }),
          createElement(DrawnLines),
        ),
      ),
    ),
  );
  return container;
}

/** Presses the button of a name in the bar. */
function press(container: HTMLElement, name: string): void {
  const button =
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
    assert.fail(`the bar offers ${name}`);
  act(() => button.click());
}

test("View settings on a File tab offers its lines' wrap, numbers, and type, no syntax theme, and each is drawn on its lines at once", async () => {
  const container = mount();
  press(container, "View settings");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();

  assert.deepEqual(
    [...popover.querySelectorAll("h3")].map((heading) => heading.textContent),
    ["Lines", "Text"],
  );
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      // A pop-up's name ends with the value it names, which is not the row's.
      (control) => control.getAttribute("aria-label")?.split(": ")[0],
    ),
    ["Word wrap", "Line numbers", "Font", "Font size", "Line height", "Ligatures"],
  );
  assert.deepEqual(drawnLines(container), {
    numbers: "true",
    wrap: "true",
    font: "var(--luke-font-mono)",
    size: "11.5px",
    lineHeight: "1.6",
    features: "'liga' 0, 'calt' 0",
  });

  const switches = (name: string) =>
    [...popover.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === name,
    );
  await act(async () => switches("Line numbers")?.click());
  await act(async () => switches("Ligatures")?.click());
  assert.equal(drawnLines(container).numbers, "false");
  assert.equal(drawnLines(container).features, "'liga' 1, 'calt' 1");
});

test("a File tab's ⋯ holds its actions alone, and Copy path copies the file's path from the repository's root", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const container = mount();
  press(container, "File actions");

  const items = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Copy file name", "Copy path", "Copy file contents", "Download file"],
  );
  await act(async () => items[1]?.click());
  assert.deepEqual(copied, [PATH]);
});
