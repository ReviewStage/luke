// @vitest-environment jsdom

import { act, createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { PortalFence } from "./portal-fence.js";

/**
 * portal-fence.test.ts -- a press or a key on a control drawn in a portal
 * inside the fence is that control's alone: the tree that drew it hears
 * neither, though React carries a portal's events up through it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("what a portaled control in the fence takes never reaches the tree around it", () => {
  const heard: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const elsewhere = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const viewer = createPortal(
    createElement(Button, { onClick: () => heard.push("viewer"), children: "Close" }),
    elsewhere,
  );
  act(() =>
    root.render(
      createElement(
        "section",
        {
          onClick: () => heard.push("section pressed"),
          onKeyDown: () => heard.push("section keyed"),
          onPointerDown: () => heard.push("section pointer"),
          onMouseDown: () => heard.push("section mouse"),
        },
        createElement(PortalFence, null, viewer),
      ),
    ),
  );
  const close = elsewhere.querySelector("button");
  if (close === null) throw new Error("the viewer is drawn");
  act(() => {
    close.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    close.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    close.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    close.click();
  });
  expect(heard).toEqual(["viewer"]);
});
