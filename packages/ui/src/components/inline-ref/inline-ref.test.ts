// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, cloneElement, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DocumentIcon } from "../../face/glyphs.js";
import { INLINE_REF_LOOK, INLINE_REF_NAME, InlineRef, type InlineRefHint } from "./inline-ref.js";

/**
 * inline-ref.test.ts -- a token handed a press is a button named by its
 * words, or by what its press does where the place says so, and answers a
 * click and the keyboard; without one it is words a reader reaches no
 * press on. A name drawn nowhere is still heard, and a gone subject keeps
 * its name. What its hint is handed is its words or its card, and what the
 * hint hands back lands on the token.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** A stand-in hint, saying beside the token what it was handed, and hearing focus arrive on the token. */
const Hint: InlineRefHint = ({ label, card, children }) =>
  createElement(
    "span",
    null,
    cloneElement(children, {
      onFocus: () => {
        document.body.dataset.hinted = label;
      },
    }),
    createElement("output", null, card ?? label),
  );

let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete document.body.dataset.hinted;
});

/** Draws `element` and answers its container. */
function draw(element: ReactNode): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

test("handed a press, it is a button named by its words that answers a click", () => {
  let pressed = 0;
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      glyph: createElement(DocumentIcon),
      label: "Rollout plan",
      state: "Open",
      onPress: () => {
        pressed += 1;
      },
    }),
  );
  const button = view.querySelector("button") ?? assert.fail("the token is a button");
  assert.equal(button.textContent, "Rollout planOpen");
  act(() => button.click());
  assert.equal(pressed, 1);
});

test("a press that says more than the name is named by what it does", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.LINK,
      label: "src/app.ts",
      name: INLINE_REF_NAME.PATH,
      state: "4–9",
      pressLabel: "Open src/app.ts, lines 4–9",
      onPress: () => {},
    }),
  );
  const button = view.querySelector("button") ?? assert.fail("the token is a button");
  assert.equal(button.getAttribute("aria-label"), "Open src/app.ts, lines 4–9");
  assert.equal(button.textContent, "src/app.ts4–9");
});

test("without a press it is words, with no button to reach", () => {
  const view = draw(createElement(InlineRef, { look: INLINE_REF_LOOK.WASH, label: "Charles Pan" }));
  assert.equal(view.querySelector("button"), null);
  assert.equal(view.textContent, "Charles Pan");
});

test("a name drawn nowhere is still heard, with the words after it, and a standing is dropped with it", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.WASH,
      glyph: createElement(DocumentIcon),
      label: "Lee Park",
      labelHidden: true,
      state: "bot",
      heard: " (former member)",
      onPress: () => {},
    }),
  );
  assert.equal(view.querySelector("button")?.textContent, "Lee Park (former member)");
});

test("a gone subject keeps its name and its press", () => {
  let pressed = 0;
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      label: "Risks",
      gone: true,
      onPress: () => {
        pressed += 1;
      },
    }),
  );
  const button = view.querySelector("button") ?? assert.fail("the token is a button");
  assert.equal(button.textContent, "Risks");
  act(() => button.click());
  assert.equal(pressed, 1);
});

test("its hint is handed its name, or its own words where the place gives them, and what the hint hands back lands on the token", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      label: "/feature-branch",
      hint: Hint,
      hintLabel: ".agents/skills/feature-branch/SKILL.md",
      onPress: () => {},
    }),
  );
  assert.equal(view.querySelector("output")?.textContent, ".agents/skills/feature-branch/SKILL.md");
  const button = view.querySelector("button") ?? assert.fail("the token is a button");
  act(() => button.focus());
  assert.equal(document.body.dataset.hinted, ".agents/skills/feature-branch/SKILL.md");
});

test("its hint is handed the card the place gives in place of its name", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.LINK,
      label: "Fix auth flow",
      hint: Hint,
      card: "The agent's card",
    }),
  );
  assert.equal(view.querySelector("output")?.textContent, "The agent's card");
});
