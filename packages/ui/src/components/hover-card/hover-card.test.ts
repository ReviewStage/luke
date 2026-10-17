// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardRule } from "./hover-card.js";

/**
 * hover-card.test.ts -- a card reads its subject's name, the line under it,
 * and its corner, then its notes, in that order; a part left out says
 * nothing; and the rule before what it lists is a separator to a reader.
 * Synthetic plans.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
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
