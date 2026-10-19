/**
 * file-view-menu.test.ts -- the end of a File tab's bar as the developer meets it: View settings offering only the two settings a File tab's lines follow, each drawn at once, and a ⋯ of actions alone, its Copy path copying the file's path. Synthetic files only.
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
import { useLinesLook } from "./code-lines.js";
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

/** What a File tab's lines are drawn with, as the tab reads it. */
function DrawnLook(): React.JSX.Element {
  const look = useLinesLook();
  return createElement("output", null, `numbers:${look.lineNumbers} wrap:${look.wrap}`);
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
          createElement(DrawnLook),
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

test("View settings on a File tab offers Word wrap and Line numbers alone, and each is drawn on its lines at once", async () => {
  const container = mount();
  press(container, "View settings");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();

  const switches = [...popover.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      (control) => control.getAttribute("aria-label"),
    ),
    ["Word wrap", "Line numbers"],
  );
  assert.equal(container.querySelector("output")?.textContent, "numbers:true wrap:true");

  await act(async () => switches[1]?.click());
  assert.equal(container.querySelector("output")?.textContent, "numbers:false wrap:true");
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
