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
 * click and the keyboard, or a link where its press leaves the app; without
 * one it is words a reader reaches no press on, which take the focus while
 * they hang a card. A name drawn nowhere is still heard, its kind is heard
 * before it, and a gone subject keeps its name and is heard to be gone. What its hint is handed is its words or its card, and what the
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

test("a gone subject keeps its name and its press, and a reader hears that it is gone", () => {
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
  assert.equal(button.textContent, "Risks (gone)");
  act(() => button.click());
  assert.equal(pressed, 1);
});

test("a reader hears its kind before its name, where its glyph says it to the eye alone", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      glyph: createElement(DocumentIcon),
      kind: "pull request",
      label: "#42 Fix the refresh",
      state: "Open",
      onPress: () => {},
    }),
  );
  const button = view.querySelector("button") ?? assert.fail("the token is a button");
  assert.equal(button.querySelector(".luke-inline-ref-glyph")?.getAttribute("aria-hidden"), "true");
  assert.equal(button.textContent, "pull request #42 Fix the refreshOpen");
});

test("a press that leaves the app is a link to its address, which the press opens rather than the browser", () => {
  const opened: string[] = [];
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      label: "LUKE-142",
      linkHref: "https://linear.app/acme/issue/LUKE-142",
      leaves: true,
      onPress: (event) => {
        opened.push(event.defaultPrevented ? "by the press" : "by the browser");
      },
    }),
  );
  assert.equal(view.querySelector("button"), null);
  const link = view.querySelector("a") ?? assert.fail("the token is a link");
  assert.equal(link.getAttribute("href"), "https://linear.app/acme/issue/LUKE-142");
  act(() => link.click());
  assert.deepEqual(opened, ["by the press"]);
});

test("a press that opens in the app stays a button, though it names an address", () => {
  const view = draw(
    createElement(InlineRef, {
      look: INLINE_REF_LOOK.PILL,
      label: "Rollout",
      linkHref: "https://tryluke.dev/acme/plan/1",
      onPress: () => {},
    }),
  );
  assert.equal(view.querySelector("a"), null);
  assert.notEqual(view.querySelector("button"), null);
});

test("words that hang a card take the focus, so the keyboard reaches the card, and words that hang none take none", () => {
  const view = draw(
    createElement(
      "p",
      null,
      createElement(InlineRef, {
        look: INLINE_REF_LOOK.PILL,
        label: "Fix auth flow",
        hint: Hint,
        card: "The agent's card",
        "data-carded": "",
      }),
      createElement(InlineRef, {
        look: INLINE_REF_LOOK.WASH,
        label: "Charles Pan",
        "data-plain": "",
      }),
    ),
  );
  const carded =
    view.querySelector<HTMLElement>("[data-carded]") ?? assert.fail("the carded token");
  act(() => carded.focus());
  assert.equal(document.activeElement, carded);
  assert.equal(document.body.dataset.hinted, "Fix auth flow");
  const plain = view.querySelector<HTMLElement>("[data-plain]") ?? assert.fail("the plain token");
  act(() => plain.focus());
  assert.notEqual(document.activeElement, plain);
});

test("words that hang a card inside a control take no focus of their own, the control's being theirs", () => {
  const view = draw(
    createElement(
      "button",
      { type: "button" },
      createElement(InlineRef, {
        look: INLINE_REF_LOOK.PILL,
        label: "Fix auth flow",
        card: "The agent's card",
        "data-carded": "",
      }),
    ),
  );
  const carded =
    view.querySelector<HTMLElement>("[data-carded]") ?? assert.fail("the carded token");
  act(() => carded.focus());
  assert.notEqual(document.activeElement, carded);
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
