// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * fork-chip-line.test.ts -- a forked draft's chip over its box stands on one
 * line, as the docked to-do list's card does: what it forks, the source's
 * chip, and the quote are cut short rather than wrapped onto a second line
 * under them. jsdom lays nothing out, so the sheets are laid
 * (`testing/container-width.ts`) and the chip is built in the markup
 * `fork-action.tsx` draws.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A forked draft's chip in its dock, answering its parts. */
function forkChip() {
  laid = layContainersAt({});
  const dock = document.body.appendChild(document.createElement("div"));
  dock.className = "draft-fork-dock";
  const chip = dock.appendChild(document.createElement("div"));
  chip.className = "draft-fork-chip";
  chip.appendChild(document.createElement("span")).textContent = "Fork of";
  const source = chip.appendChild(document.createElement("span"));
  source.className = "luke-inline-ref";
  source.dataset.actorRef = "";
  source.textContent = "Admin dashboard design audit";
  chip.appendChild(document.createElement("span")).textContent = "at";
  const quote = chip.appendChild(document.createElement("span"));
  quote.className = "draft-fork-quote";
  quote.textContent = "“Merged: #4078 (charts and stat cards on app…”";
  chip.appendChild(document.createElement("span")).className = "draft-fork-drop";
  return { chip, source, quote };
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
  const todos = document.body.appendChild(document.createElement("details"));
  todos.className = "todos-dock";
  const head = todos.appendChild(document.createElement("summary"));
  head.className = "todos-dock-head";
  assert.equal(getComputedStyle(chip).backgroundColor, getComputedStyle(todos).backgroundColor);
  assert.equal(getComputedStyle(chip).height, getComputedStyle(head).height);
});
