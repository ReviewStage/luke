// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DIALOG_SIZE, Dialog } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "./testing/container-width.js";

/**
 * dialog-foot-room.test.ts -- a card with no answers and no question stands
 * no foot, so no room is left under its last row (the ⌃Tab switcher's
 * cards), read through the sheets every app lays.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

test("a card with no answers keeps no margin or display under its last row", () => {
  laid = layContainersAt(
    {},
    { only: ["@luke/ui/tokens.css", "./base.css", "@luke/ui/styles.css", "tailwind.css"] },
  );
  const surface = document.body.appendChild(document.createElement("div"));
  const root = createRoot(surface);
  roots.push(root);
  act(() =>
    root.render(
      createElement(Dialog, {
        open: true,
        size: DIALOG_SIZE.MEDIA,
        title: "Recent tabs",
        onDismiss: () => undefined,
        children: "Cards",
      }),
    ),
  );
  const card = document.querySelector(".luke-dialog") ?? assert.fail("No card");
  const slot = card.lastElementChild ?? assert.fail("No foot slot");
  // Note that jsdom answers a `var()` as it is spelled, so the foot's margin would read as its calc.
  assert.match(getComputedStyle(slot).marginTop, /^(0|0px)?$/u);
});
