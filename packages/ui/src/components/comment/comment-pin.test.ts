// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CommentPin } from "./comment-pin.js";

/**
 * comment-pin.test.ts -- a pin is named for the comments it opens and opens
 * them as pressed, tells its owner the pointer came onto it and went, and
 * draws a count only where more than one thread stands on what it is on.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The pin drawn, and what it told its owner. */
function drawn(count: number) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const told: string[] = [];
  act(() =>
    root.render(
      createElement(CommentPin, {
        author: { name: "Ada Lovelace", id: "user-ada" },
        count,
        label: `${count} comments`,
        preview: "Can the retry wait?",
        open: false,
        onPress: () => told.push("pressed"),
        onHover: (over) => told.push(over ? "over" : "gone"),
      }),
    ),
  );
  const pin = container.querySelector("button");
  assert.ok(pin);
  return { pin, told };
}

test("a pin is named for its comments, opens them as pressed, and tells the pointer coming onto it and going", () => {
  const { pin, told } = drawn(3);

  act(() => {
    pin.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    pin.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    pin.click();
  });

  assert.equal(pin.getAttribute("aria-label"), "3 comments");
  assert.deepEqual(told, ["over", "gone", "pressed"]);
  // The face stands its writer's letter where no picture is given, the count after it.
  assert.equal(pin.textContent, "A3");
});

test("a pin of one thread draws no count", () => {
  assert.equal(drawn(1).pin.textContent, "A");
});
