// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { builtStylesheet, cssRules } from "#testing/css-rules";
import { GLYPH_STATE, type GlyphState, StateGlyph } from "./state-glyph";
import { WORKING_MARK_SIZE, WorkingMark, type WorkingMarkSize } from "./working-mark";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function drawn(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A glyph wearing `state` as a reader and an eye meet it: what it says, and what stands in its footprint. */
function glyphSeen(state: GlyphState) {
  const glyph = createElement("svg", { className: "own-glyph" });
  const container = drawn(createElement(StateGlyph, { glyph, state }));
  const footprint = container.querySelector(".state-glyph");
  return {
    said: footprint?.getAttribute("aria-label") ?? undefined,
    glyph: footprint?.querySelector(".own-glyph") !== null,
    working: footprint?.querySelector("svg.working-mark") !== null,
    alert: footprint?.querySelector("svg.lucide-circle-alert") !== null,
  };
}

/** The track's cells of the mark at `size`, as the eye meets them: where each starts and how wide it is. */
function trackOf(size: WorkingMarkSize) {
  const container = drawn(createElement(WorkingMark, { size }));
  const mark = container.querySelector("svg.working-mark");
  const cells = [...(mark?.querySelectorAll(".working-mark-track") ?? [])].map((cell) => ({
    x: Number(cell.getAttribute("x")),
    y: Number(cell.getAttribute("y")),
    side: Number(cell.getAttribute("width")),
  }));
  return { side: Number(mark?.getAttribute("width")), cells };
}

/** Every gap between two neighbouring columns or rows of `cells`, so a grid's empty middle is no gap. */
function gapsIn(cells: readonly { x: number; y: number; side: number }[]): number[] {
  return (["x", "y"] as const).flatMap((axis) => {
    const starts = [...new Set(cells.map((cell) => cell[axis]))].sort((a, b) => a - b);
    return starts
      .slice(1)
      .map((start, index) => start - (starts[index] ?? 0) - (cells[0]?.side ?? 0));
  });
}

/** The seconds a declaration like `-1.9s` names. */
function seconds(value: string | undefined): number {
  assert.ok(value !== undefined, "a time is declared");
  assert.ok(value.endsWith("s"), `a time in seconds, not ${value}`);
  return Number(value.slice(0, -1));
}

test("a glyph at work says Working and wears the working mark in its own place, failed says Failed with the alert in its place, and at rest it stands alone and says nothing", () => {
  assert.deepEqual(glyphSeen(GLYPH_STATE.WORKING), {
    said: "Working",
    glyph: false,
    working: true,
    alert: false,
  });
  assert.deepEqual(glyphSeen(GLYPH_STATE.FAILED), {
    said: "Failed",
    glyph: false,
    working: false,
    alert: true,
  });
  assert.deepEqual(glyphSeen(GLYPH_STATE.REST), {
    said: undefined,
    glyph: true,
    working: false,
    alert: false,
  });
});

test("the mark standing alone is said in its label, and beside words that say it is hidden from a reader", () => {
  const labelled = drawn(createElement(WorkingMark, { label: "Starting" }));
  assert.equal(labelled.querySelector('[role="img"]')?.getAttribute("aria-label"), "Starting");
  const quiet = drawn(createElement(WorkingMark));
  assert.equal(quiet.querySelector("svg")?.getAttribute("aria-hidden"), "true");
  assert.equal(quiet.querySelector('[role="img"]'), null);
});

test("the badge is the glyph's grid with fewer cells, never the glyph shrunk: every cell and every gap is the same whole 2px at both sizes", () => {
  const glyph = trackOf(WORKING_MARK_SIZE.GLYPH);
  const badge = trackOf(WORKING_MARK_SIZE.BADGE);

  assert.deepEqual([glyph.side, glyph.cells.length], [12, 8], "eight cells round a 3×3 grid");
  assert.deepEqual([badge.side, badge.cells.length], [8, 4], "four round a 2×2");
  for (const { side, cells } of [glyph, badge]) {
    assert.deepEqual(new Set(cells.map((cell) => cell.side)), new Set([2]));
    assert.deepEqual(new Set(gapsIn(cells)), new Set([2]));
    for (const cell of cells) {
      assert.ok(Number.isInteger(cell.x) && Number.isInteger(cell.y), "on whole pixels");
      assert.ok(cell.x >= 1 && cell.x + cell.side <= side - 1, "inside the mark with a margin");
    }
  }
});

test("held still, as reduced motion and a capture run hold it, the glyph stands mid-lap: each chaser a cell past its tail and the two chasers opposite, rather than all on the first cell", async () => {
  const rules = cssRules(await builtStylesheet());
  const declared = (selector: string, property: string) =>
    rules.find((rule) => rule.selectors.includes(selector))?.declarations.get(property);
  const moving = ".working-mark-dot";
  assert.match(declared(moving, "animation") ?? "", /\bworking-lap\b.*\b1\.6s\b.*\bstep-end\b/u);
  assert.equal(declared(moving, "animation-play-state"), "var(--loop-motion)");

  // The glyph laps its eight cells in 1.6s, a cell to each 0.2s beat; a held pixel stands on the cell its delay puts it at.
  const cellHeld = (dot: string) => {
    const delay = seconds(declared(`.working-mark-dot[data-dot="${dot}"]`, "animation-delay"));
    assert.ok(delay < 0, "held past its first frame");
    return Math.floor(((-delay % 1.6) + 1e-9) / 0.2) % 8;
  };
  const [lead, leadTail, trail, trailTail] = ["lead", "lead-tail", "trail", "trail-tail"].map(
    cellHeld,
  );
  assert.ok(lead !== undefined && leadTail !== undefined && trail !== undefined);
  assert.equal((lead - leadTail + 8) % 8, 1, "the lead a cell past its tail");
  assert.equal((trail - (trailTail ?? 0) + 8) % 8, 1, "the trail a cell past its tail");
  assert.equal((trail - lead + 8) % 8, 4, "the two chasers opposite");
  assert.notEqual(lead, 0, "not the first frame");
});
