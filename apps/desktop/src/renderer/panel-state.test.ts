import assert from "node:assert/strict";
import { test } from "vitest";
import {
  collapseMarkAfter,
  leavesPanelForCompact,
  PANEL_PRESENTATION,
  type PanelPresentation,
} from "./panel-state";

const SHAPES: readonly PanelPresentation[] = Object.values(PANEL_PRESENTATION);

/**
 * The two moves that are the collapse, named as pairs. The slot and the
 * composer keep the expanded window, so their shrink runs on the base surface
 * timing and is not one of them.
 */
const COLLAPSES: readonly (readonly [PanelPresentation, PanelPresentation])[] = [
  [PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.CAPSULE],
  [PANEL_PRESENTATION.PANEL, PANEL_PRESENTATION.PEEK],
];

/**
 * The shapes a mark already raised survives into: a peek answering a hover
 * mid-collapse is a width retarget on the same journey down from the panel.
 */
const KEEPS_THE_MARK: readonly PanelPresentation[] = [
  PANEL_PRESENTATION.CAPSULE,
  PANEL_PRESENTATION.PEEK,
];

test("the collapse mark follows the panel standing down to a compact shape, and nothing else", () => {
  for (const previous of SHAPES) {
    for (const next of SHAPES) {
      const collapses = COLLAPSES.some(([from, to]) => from === previous && to === next);
      const where = `${previous} -> ${next}`;
      assert.equal(leavesPanelForCompact(previous, next), collapses, where);
      assert.equal(collapseMarkAfter(previous, next, false), collapses, `${where} unmarked`);
      assert.equal(
        collapseMarkAfter(previous, next, true),
        collapses || KEEPS_THE_MARK.includes(next),
        `${where} marked`,
      );
    }
  }
});
