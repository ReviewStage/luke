// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useWindowFullScreen } from "./window-full-screen.js";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.documentElement.removeAttribute("data-full-screen");
});

function Window({ fullScreen }: { fullScreen: boolean | undefined }): null {
  useWindowFullScreen(fullScreen);
  return null;
}

/** Draws the window as main last said it stands. */
function draw(fullScreen: boolean | undefined): void {
  root ??= createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Window, { fullScreen })));
}

test("the root says the window stands in full screen while main says so, which moves the title bar's buttons into the traffic lights' place, and says nothing once it leaves", () => {
  draw(undefined);
  assert.equal(document.documentElement.getAttribute("data-full-screen"), null);
  draw(true);
  assert.equal(document.documentElement.getAttribute("data-full-screen"), "true");
  draw(false);
  assert.equal(document.documentElement.getAttribute("data-full-screen"), null);
});
