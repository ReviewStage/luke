import assert from "node:assert/strict";
import test from "node:test";
import {
  PANEL_ENTRY_CANCEL,
  PANEL_ENTRY_REPLY,
  panelEntryCancel,
  panelEntryOpen,
  panelEntryReleased,
  panelEntryReply,
  panelEntrySettles,
} from "./use-panel-entry";

/** Nothing held, something held and idle, something held with a reply in flight. */
const HELD = [
  // A reply in flight is answering the entry underneath it, so nothing may
  // replace it but ending it outright.
  { entry: undefined, open: false },
  { entry: { busy: false }, open: true },
  { entry: { busy: true }, open: false },
] as const;

/** Where giving up from each shape goes. */
const CANCELS = [
  // Giving up from inside the panel has no shape to put away.
  { aside: false, restore: false, goes: PANEL_ENTRY_CANCEL.NONE },
  { aside: false, restore: true, goes: PANEL_ENTRY_CANCEL.NONE },
  // A key page that was opened, or a composer opened by voice, leaves entirely.
  { aside: true, restore: false, goes: PANEL_ENTRY_CANCEL.LEAVE },
  // A key started from the panel, or a note from settings, goes back there.
  { aside: true, restore: true, goes: PANEL_ENTRY_CANCEL.RESTORE },
] as const;

/** Whether a delivered send shows its answer and then takes the panel's leave. */
const SETTLES = [
  // Saved from inside the panel: no shape to restore, and no leave to schedule.
  { aside: false, pointerInside: false, settles: false },
  { aside: false, pointerInside: true, settles: false },
  // With the pointer away, nothing else would ever ask this panel to close.
  { aside: true, pointerInside: false, settles: true },
  // The pointer is still on the button that was pressed, and will close by leaving.
  { aside: true, pointerInside: true, settles: false },
] as const;

const REPLIES = [
  // A reply that outlived its own entry is spent, whatever it says.
  { stillHeld: false, rejection: undefined, means: PANEL_ENTRY_REPLY.IGNORE },
  { stillHeld: false, rejection: "taken", means: PANEL_ENTRY_REPLY.IGNORE },
  // Still that entry: refused or delivered, never both.
  { stillHeld: true, rejection: undefined, means: PANEL_ENTRY_REPLY.DELIVER },
  { stillHeld: true, rejection: "taken", means: PANEL_ENTRY_REPLY.REJECT },
] as const;

test("the entry's five decisions, exhaustively", () => {
  // Ending an entry is what releases the hold it had on the panel: an entry
  // that ends with the pointer already away leaves the panel held by nothing,
  // because the pointer cannot leave a second time.
  for (const { entry: previous } of HELD) {
    for (const { entry: next } of HELD) {
      assert.equal(
        panelEntryReleased(previous, next),
        previous !== undefined && next === undefined,
        `released ${previous?.busy} -> ${next?.busy}`,
      );
    }
  }

  for (const { entry, open } of HELD) {
    assert.equal(panelEntryOpen(entry), open, `open ${entry?.busy}`);
  }

  for (const { aside, restore, goes } of CANCELS) {
    assert.equal(panelEntryCancel({ aside, restore }), goes, `aside=${aside} restore=${restore}`);
  }

  for (const { aside, pointerInside, settles } of SETTLES) {
    assert.equal(
      panelEntrySettles({ aside, pointerInside }),
      settles,
      `aside=${aside} pointerInside=${pointerInside}`,
    );
  }

  for (const { stillHeld, rejection, means } of REPLIES) {
    assert.equal(
      panelEntryReply({ stillHeld, rejection }),
      means,
      `stillHeld=${stillHeld} rejection=${rejection}`,
    );
  }
});
