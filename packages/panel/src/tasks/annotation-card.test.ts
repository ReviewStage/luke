// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DisclosureAction } from "@luke/ui";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";
import {
  ANNOTATION_TONE,
  AnnotationCard,
  AnnotationComment,
  AnnotationComments,
} from "./annotation-card.js";

/**
 * annotation-card.test.ts -- the card every annotation on code stands on: its
 * faces and its words each keep one column, the head's and every comment's
 * alike; folded, it is its head alone, counting its comments rather than
 * previewing any; and a narrow card says the age to a reader alone, draws
 * each state as its badge's dot that still says its word, and counts
 * without the word.
 *
 * jsdom lays nothing out, so the window's stylesheets are laid for a card
 * of each width (`testing/container-width.ts`) and the columns are read
 * from the lengths they set, every custom property and sum among them
 * resolved here as the browser would.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FIRST = "Can we use the constant in the resend copy too?";
const REPLY = "Yes, in the copy PR.";

const roots: Root[] = [];
/** The presses the head's name took. */
const pressed: string[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  pressed.length = 0;
});

/** A card of two comments, its fold its own, starting as `open` says, inside a box as wide as given. */
function Card({ startsOpen }: { startsOpen: boolean }): ReactNode {
  const [open, setOpen] = useState(startsOpen);
  return createElement(AnnotationCard, {
    label: "Review thread by charlespan",
    open,
    onOpenChange: setOpen,
    face: createElement("span", { className: "face" }, "C"),
    name: createElement(DisclosureAction, {
      children: createElement(
        "button",
        { type: "button", onClick: () => pressed.push("name") },
        "charlespan",
      ),
    }),
    time: createElement("span", { className: "annotation-card-time" }, "2h"),
    states: [{ word: "Outdated", tone: ANNOTATION_TONE.NEUTRAL }],
    count: 2,
    children: createElement(AnnotationComments, {
      children: [
        createElement(AnnotationComment, { key: "first", children: FIRST }),
        createElement(AnnotationComment, {
          key: "reply",
          reply: { face: "D", meta: "danak" },
          children: REPLY,
        }),
      ],
    }),
  });
}

function draw(startsOpen: boolean, width = 900): HTMLElement {
  laid?.remove();
  laid = layContainersAt({ annotation: width, "luke-room": width });
  const container = document.body.appendChild(document.createElement("div"));
  container.className = "pull-request-thread-slot";
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Card, { startsOpen })));
  return container;
}

/** A length as the browser resolves it: every custom property it names read on `element`, then its sum, in pixels. */
function pixels(element: Element, value: string): number {
  const style = getComputedStyle(element);
  let text = value.trim();
  for (let depth = 0; text.includes("var(") && depth < 20; depth += 1) {
    text = text.replace(/var\((--[a-z0-9-]+)\)/gu, (_, name: string) =>
      style.getPropertyValue(name).trim(),
    );
  }
  const terms = text.replaceAll(/calc|[()]/gu, "").split("+");
  return terms.reduce((sum, term) => {
    assert.match(term.trim(), /^\d+(?:\.\d+)?px$/u, `${value} resolves to a sum of pixels`);
    return sum + Number.parseFloat(term);
  }, 0);
}

/** The parts of a shorthand, split at the spaces between them and never inside a function's brackets. */
function parts(value: string): string[] {
  return value.trim().split(/\s+(?![^(]*\))/u);
}

/** A box's inline-start padding. */
function paddingStart(element: Element): number {
  return pixels(element, getComputedStyle(element).paddingLeft);
}

/** Where a box's own start stands from the card's, by the paddings, gaps, and columns before it. */
function columns(card: HTMLElement) {
  const head = card.querySelector(".annotation-card-head") ?? assert.fail("a head");
  const content = card.querySelector(".annotation-card-content") ?? assert.fail("a body");
  const comment = card.querySelector(".annotation-comment") ?? assert.fail("a comment");
  const headStyle = getComputedStyle(head);
  const turn = card.querySelector(".annotation-card-turn") ?? assert.fail("a chevron's seat");
  const face = card.querySelector(".annotation-card-face") ?? assert.fail("a face");
  const headGap = pixels(head, headStyle.getPropertyValue("gap"));
  const headFace = paddingStart(head) + pixels(turn, getComputedStyle(turn).width) + headGap;
  const headName = headFace + pixels(face, getComputedStyle(face).width) + headGap;
  const commentStyle = getComputedStyle(comment);
  const [faceColumn = ""] = parts(commentStyle.gridTemplateColumns);
  const bodyFace = paddingStart(content);
  const bodyWords =
    bodyFace + pixels(comment, faceColumn) + pixels(comment, commentStyle.columnGap);
  return { headFace, headName, bodyFace, bodyWords };
}

test("the head's face stands over every reply's face, and its name over every comment's words", () => {
  const card = draw(true).querySelector<HTMLElement>(".annotation-card") ?? assert.fail("a card");
  const { headFace, headName, bodyFace, bodyWords } = columns(card);
  assert.equal(bodyFace, headFace, "one column of faces");
  assert.equal(bodyWords, headName, "one column of words");
  const [first, reply] = card.querySelectorAll(".annotation-comment");
  assert.equal(first?.querySelector(".annotation-comment-face"), null, "the head names the first");
  assert.ok(reply?.querySelector(".annotation-comment-face"), "a reply wears its own face");
  for (const words of card.querySelectorAll(".annotation-comment-words")) {
    assert.equal(
      getComputedStyle(words).getPropertyValue("grid-column"),
      "2",
      "its words stand in the words' column",
    );
  }
});

test("folded, a card is its head alone, counting its comments and previewing none of their words", () => {
  const container = draw(false);
  assert.doesNotMatch(container.textContent ?? "", /resend copy|copy PR/u);
  assert.equal(container.querySelector(".annotation-card-count")?.textContent, "2 comments");
  act(() => container.querySelector<HTMLElement>("summary")?.click());
  assert.match(container.textContent ?? "", /resend copy.*copy PR/u);
  assert.equal(container.querySelector(".annotation-card-count"), null, "open, nothing is counted");
});

test("a narrow card says the age to a reader alone, draws a state as its dot that still says its word, and counts without the word", () => {
  const wide = draw(false, 900);
  const time = () =>
    wide.querySelector(".annotation-card-time")?.parentElement ?? assert.fail("an age");
  const word = () =>
    wide.querySelector(".annotation-card-state .luke-badge-words") ?? assert.fail("a word");
  const countWord = () =>
    wide.querySelector(".annotation-card-count .luke-visually-hidden") ??
    assert.fail("the count's word");
  assert.notEqual(getComputedStyle(time()).position, "absolute", "wide, the age is drawn");
  assert.notEqual(getComputedStyle(word()).position, "absolute", "wide, the state says its word");
  assert.notEqual(getComputedStyle(countWord()).position, "absolute");

  laid?.remove();
  laid = layContainersAt({ annotation: 360, "luke-room": 360 });
  assert.equal(getComputedStyle(time()).position, "absolute", "narrow, the age steps out");
  assert.equal(time().textContent, "2h", "and is still read");
  assert.equal(getComputedStyle(word()).position, "absolute", "its word is drawn nowhere");
  assert.equal(word().textContent, "Outdated", "and still names it");
  assert.equal(getComputedStyle(countWord()).position, "absolute", "the count drops its word");
});

test("a press on the writer's name opens what the name opens, and leaves the card as it stood", () => {
  const container = draw(true);
  const name = container.querySelector<HTMLElement>(".annotation-card-name button");
  act(() => name?.click());
  assert.deepEqual(pressed, ["name"]);
  assert.equal(container.querySelector("summary")?.getAttribute("aria-expanded"), "true");
  act(() => container.querySelector<HTMLElement>(".annotation-card-time")?.click());
  assert.equal(
    container.querySelector("summary")?.getAttribute("aria-expanded"),
    "false",
    "anywhere else on the head folds it",
  );
});
