// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
} from "./hover-card.js";

/**
 * hover-card.test.ts -- a card reads its subject's name, the line under it,
 * and its corner, then its notes, in that order; a part left out says
 * nothing; the rule before what it lists is a separator to a reader; and
 * its rows open what they name where they can, in a list named and counted,
 * their words fading out at their end only while the card cuts them short.
 * Synthetic plans.
 */

const roots: Root[] = [];

/** The measurement each observed box was handed, fired as a resize; jsdom lays nothing out, so nothing reports one of its own accord. */
const resizes: (() => void)[] = [];

class StandInResizeObserver {
  readonly #fire: () => void;
  constructor(fire: () => void) {
    this.#fire = fire;
  }
  observe(): void {
    resizes.push(this.#fire);
  }
  disconnect(): void {}
}

/** Stands every box's words `wide` pixels in a box 100px wide, and fires every observed box's measurement, as a resize would. */
function resize(wide: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(wide);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  act(() => {
    for (const fire of resizes) fire();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  resizes.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The element `card` draws, mounted in the document. */
function drawn(card: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(card));
  return container;
}

test("a card reads its name, the line under it, its corner, and then its notes", () => {
  const card = drawn(
    createElement(HoverCard, {
      children: [
        createElement(HoverCardHead, {
          key: "head",
          name: "Teammate invitations",
          sub: "acme/relay",
          corner: "3h",
        }),
        createElement(HoverCardNote, {
          key: "note",
          children: "Expire an invitation after a week.",
        }),
      ],
    }),
  );
  assert.equal(
    card.textContent,
    "Teammate invitationsacme/relay3hExpire an invitation after a week.",
  );
});

test("a head with no line under its name and no corner says its name alone", () => {
  const card = drawn(
    createElement(HoverCard, {
      children: createElement(HoverCardHead, { name: "/release" }),
    }),
  );
  assert.equal(card.textContent, "/release");
});

test("the rule before what a card lists is a separator to a reader", () => {
  const card = drawn(
    createElement(HoverCard, {
      children: [
        createElement(HoverCardHead, { key: "head", name: "Teammate invitations" }),
        createElement(HoverCardRule, { key: "rule" }),
        createElement("button", { key: "open", type: "button" }, "Open Invite flow"),
      ],
    }),
  );
  const separator = card.querySelector("hr");
  assert.ok(separator, "the rule is drawn");
  assert.equal(separator.nextElementSibling?.textContent, "Open Invite flow");
});

test("a row with a press opens what it names, and one without is text a reader reads", () => {
  let opened = 0;
  const card = drawn(
    createElement(HoverCard, {
      children: [
        createElement(HoverCardRow, {
          key: "repository",
          look: HOVER_CARD_ROW_LOOK.DETAIL,
          glyph: null,
          label: "acme/relay",
          onPress: () => (opened += 1),
        }),
        createElement(HoverCardRow, {
          key: "creator",
          look: HOVER_CARD_ROW_LOOK.DETAIL,
          glyph: null,
          label: "Created by you",
        }),
      ],
    }),
  );
  const buttons = [...card.querySelectorAll("button")];
  assert.deepEqual(
    buttons.map((each) => each.textContent),
    ["acme/relay"],
  );
  act(() => buttons[0]?.click());
  assert.equal(opened, 1);
  assert.equal(card.textContent, "acme/relayCreated by you");
});

test("a list is named, reads its rows and their ends, and counts what it leaves out last", () => {
  const card = drawn(
    createElement(HoverCardList, {
      label: "Pull requests",
      more: "2 more",
      children: createElement(
        "li",
        null,
        createElement(HoverCardRow, { glyph: null, label: "#42 Invite flow", end: "+12 −3" }),
      ),
    }),
  );
  const list = card.querySelector("ul") ?? assert.fail("the list");
  assert.equal(list.getAttribute("aria-label"), "Pull requests");
  assert.deepEqual(
    [...list.querySelectorAll("li")].map((each) => each.textContent),
    ["#42 Invite flow+12 −3", "2 more"],
  );
});

test("a row's words fade out at their end only while the card cuts them short", () => {
  const card = drawn(
    createElement(HoverCard, {
      children: createElement(HoverCardRow, {
        look: HOVER_CARD_ROW_LOOK.DETAIL,
        glyph: null,
        label: "acme/relay-service-monorepo",
      }),
    }),
  );
  const label = () => card.querySelector(".luke-hover-card-row-label");
  resize(80);
  assert.equal(label()?.getAttribute("data-end"), "fade");
  assert.equal(label()?.getAttribute("data-overflow"), "false");
  resize(160);
  assert.equal(label()?.getAttribute("data-overflow"), "true");
});
