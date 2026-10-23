// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { COMPOSER_ELEMENT, COMPOSER_LOOK, ComposerFrame } from "./composer-frame.js";

/**
 * composer-frame.test.ts -- a composer's frame holds what it is handed at
 * every look, and as a form it sends what its submit presses, named by its
 * owner's class.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` on the page and hands back what it was drawn into. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a frame shows what it holds at every look", () => {
  for (const look of Object.values(COMPOSER_LOOK)) {
    const container = draw(
      createElement(ComposerFrame, { look, children: createElement("p", null, "Ask Luke") }),
    );
    expect(container.textContent).toBe("Ask Luke");
  }
});

test("a frame that is a form sends when its submit is pressed", () => {
  const sent: string[] = [];
  const container = draw(
    createElement(ComposerFrame, {
      as: COMPOSER_ELEMENT.FORM,
      className: "message-box",
      onSubmit: (event: React.FormEvent) => {
        event.preventDefault();
        sent.push("sent");
      },
      children: createElement("button", { type: "submit" }, "Send"),
    }),
  );
  act(() => container.querySelector("button")?.click());
  expect(sent).toEqual(["sent"]);
  expect(container.querySelector("form.message-box")).not.toBeNull();
});
