// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DISCLOSURE_LOOK, DISCLOSURE_SUMMARY, Disclosure, DisclosureSummary } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * fork-chip-line.test.ts -- a forked draft's chip over its box stands on one
 * line, as the docked to-do list's card does: what it forks, the source's
 * chip, and the quote are cut short rather than wrapped onto a second line
 * under them; the line stands at least the card's height, and taller where
 * the profile's × does; and a narrow dock, a side panel at its narrowest,
 * says Fork of by its glyph alone, so the source's name keeps that room.
 * jsdom lays nothing out, so the sheets are laid
 * (`testing/container-width.ts`), the chip is built in the markup
 * `fork-action.tsx` draws, and the card is the `Disclosure` the dock draws.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let laid: HTMLStyleElement | undefined;
const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A length with every `var()` in it read off the root, which jsdom leaves unresolved. */
function resolved(length: string): string {
  const root = getComputedStyle(document.documentElement);
  const once = length.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
    root.getPropertyValue(name).trim(),
  );
  return once === length ? once : resolved(once);
}

/** A forked draft's chip in a dock of the width given, answering its parts. */
function forkChip(width = 528) {
  laid = layContainersAt({ "fork-dock": width });
  const dock = document.body.appendChild(document.createElement("div"));
  dock.className = "draft-fork-dock";
  const chip = dock.appendChild(document.createElement("div"));
  chip.className = "luke-card draft-fork-chip";
  chip.dataset.look = "tint";
  chip.dataset.corner = "control";
  chip.dataset.padding = "none";
  const lead = chip.appendChild(document.createElement("span"));
  lead.className = "draft-fork-lead";
  lead.textContent = "Fork of";
  const source = chip.appendChild(document.createElement("span"));
  source.className = "luke-inline-ref";
  source.dataset.actorRef = "";
  source.textContent = "Admin dashboard design audit";
  chip.appendChild(document.createElement("span")).textContent = "at";
  const quote = chip.appendChild(document.createElement("span"));
  quote.className = "luke-one-line draft-fork-quote";
  quote.dataset.end = "ellipsis";
  quote.textContent = "“Merged: #4078 (charts and stat cards on app…”";
  chip.appendChild(document.createElement("span")).className = "draft-fork-drop";
  return { chip, lead, source, quote };
}

test("a forked draft's chip stands on one line, its source and its quote cut short rather than wrapped", () => {
  const { chip, source, quote } = forkChip();
  const line = getComputedStyle(chip);
  assert.notEqual(line.flexWrap, "wrap");
  assert.equal(line.whiteSpace, "nowrap");
  assert.equal(getComputedStyle(source).minWidth, "0px");
  assert.equal(getComputedStyle(quote).overflow, "hidden");
  assert.equal(getComputedStyle(quote).textOverflow, "ellipsis");
});

test("a forked draft's chip is drawn on the docked to-do list's card", () => {
  const { chip } = forkChip();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(Disclosure, {
        look: DISCLOSURE_LOOK.CARD,
        children: createElement(DisclosureSummary, {
          look: DISCLOSURE_SUMMARY.HEAD,
          children: "To-dos",
        }),
      }),
    ),
  );
  const todos = host.querySelector("details") ?? assert.fail("the to-do list's card is drawn");
  const head = host.querySelector("summary") ?? assert.fail("its head is drawn");
  assert.equal(getComputedStyle(chip).backgroundColor, getComputedStyle(todos).backgroundColor);
  assert.equal(resolved(getComputedStyle(chip).minHeight), resolved(getComputedStyle(head).height));
});

test("a forked draft's chip is not held to a height, so a profile's taller × stands inside it", () => {
  const { chip } = forkChip();
  assert.ok(["", "auto"].includes(getComputedStyle(chip).height));
});

test("a narrow dock says Fork of by its glyph alone, the words still read to assistive tech", () => {
  const wide = forkChip(528);
  assert.notEqual(getComputedStyle(wide.lead).position, "absolute");
  laid?.remove();
  document.body.replaceChildren();
  const narrow = forkChip(248);
  assert.equal(getComputedStyle(narrow.lead).position, "absolute");
  assert.equal(getComputedStyle(narrow.lead).clipPath, "inset(50%)");
  assert.equal(narrow.lead.textContent, "Fork of");
});
