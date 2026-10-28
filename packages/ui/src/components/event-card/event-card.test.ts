// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { EventCard } from "./event-card.js";

/**
 * event-card.test.ts -- a card's notes past its first three wait behind
 * "Show 2 more", drawn hidden until found, and the card opens whole when a
 * find's match lands in one. Synthetic notes.
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

const NOTES = ["One.", "Two.", "Three.", "Four.", "Five."].map((body) => ({
  key: body,
  where: `src/${body.toLowerCase()}ts:1`,
  body,
}));

test("notes past the first three fold behind the foot, hidden until found, and a find landing in one opens the card", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(EventCard, { lead: "@octocat reviewed #42", notes: NOTES })));
  const foot = [...document.querySelectorAll("button")].find((button) =>
    /Show 2 more/u.test(button.textContent ?? ""),
  );
  expect(foot?.getAttribute("aria-expanded")).toBe("false");
  const folded = document.querySelector("[hidden]") ?? expect.fail("No folded notes");
  expect(folded.getAttribute("hidden")).toBe("until-found");
  expect(folded.textContent).toContain("Five.");
  act(() => {
    folded.dispatchEvent(new Event("beforematch", { bubbles: true }));
  });
  expect(document.querySelector("[hidden]")).toBeNull();
  expect(foot?.getAttribute("aria-expanded")).toBe("true");
});
