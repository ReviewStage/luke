// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { useWindowReady } from "./window-ready.js";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function Window({ ready }: { ready: boolean }): null {
  useWindowReady(ready);
  return null;
}

test("the window reports it painted once, and only from the moment it is ready", () => {
  let reports = 0;
  fakeAppBridge({
    notifyReady: () => {
      reports += 1;
    },
  });
  const draw = (ready: boolean) => {
    root ??= createRoot(document.createElement("div"));
    act(() => root?.render(createElement(Window, { ready })));
  };

  draw(false);
  assert.equal(reports, 0);
  draw(true);
  assert.equal(reports, 1);
  draw(false);
  draw(true);
  assert.equal(reports, 1);
});
