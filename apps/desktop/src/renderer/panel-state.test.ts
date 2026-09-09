import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseMarkAfter,
  leavesPanelForCompact,
  PANEL_PRESENTATION,
  type PanelPresentation,
} from "./panel-state";

const SHAPES: readonly PanelPresentation[] = Object.values(PANEL_PRESENTATION);

/**
 * The two decisions are one truth table over every ordered pair of shapes and
 * both marks, so a shape added to the vocabulary is answered for here rather
 * than falling through whichever pairs someone thought to write down.
 */
const COMPACT = new Set<PanelPresentation>([PANEL_PRESENTATION.CAPSULE, PANEL_PRESENTATION.PEEK]);

test("the collapse mark follows the panel standing down to a compact shape, and nothing else", () => {
  for (const previous of SHAPES) {
    for (const next of SHAPES) {
      const leaves = previous === PANEL_PRESENTATION.PANEL && COMPACT.has(next);
      const where = `${previous} -> ${next}`;
      assert.equal(
        leavesPanelForCompact(previous, next),
        leaves,
        // The slot and the composer keep the expanded window, so their shrink
        // runs on the base surface timing and is not this collapse.
        `${where}: only the panel standing down to the capsule or the peek is the collapse`,
      );
      for (const marked of [false, true]) {
        assert.equal(
          collapseMarkAfter(previous, next, marked),
          // A move between the compact shapes keeps the mark: a peek answering
          // a hover mid-collapse is a width retarget on the same journey down.
          leaves || (marked && COMPACT.has(next)),
          `${where} (${marked ? "marked" : "unmarked"})`,
        );
      }
    }
  }
});
