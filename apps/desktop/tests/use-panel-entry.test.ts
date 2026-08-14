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
} from "../src/renderer/use-panel-entry";

test("ending an entry is what releases the hold it had on the panel", () => {
  assert.equal(panelEntryReleased({ busy: false }, undefined), true);
  assert.equal(panelEntryReleased(undefined, { busy: false }), false);
  assert.equal(panelEntryReleased({ busy: false }, { busy: true }), false);
  assert.equal(panelEntryReleased(undefined, undefined), false);
});

test("a reply in flight is not a moment to change the entry underneath it", () => {
  assert.equal(panelEntryOpen(undefined), false);
  assert.equal(panelEntryOpen({ busy: true }), false);
  assert.equal(panelEntryOpen({ busy: false }), true);
});

test("giving up from the aside shape returns you where you were", () => {
  assert.equal(
    panelEntryCancel({ aside: true, restore: true }),
    PANEL_ENTRY_CANCEL.RESTORE,
    "a key started from the panel, or a note from settings, goes back there",
  );
  assert.equal(
    panelEntryCancel({ aside: true, restore: false }),
    PANEL_ENTRY_CANCEL.LEAVE,
    "a key page that was opened, or a composer from the tray, leaves entirely",
  );
  assert.equal(
    panelEntryCancel({ aside: false, restore: true }),
    PANEL_ENTRY_CANCEL.NONE,
    "giving up from inside the panel has no shape to put away",
  );
});

test("a reply that outlived its own entry is spent", () => {
  assert.equal(panelEntryReply({ stillHeld: false, rejection: "taken" }), PANEL_ENTRY_REPLY.IGNORE);
  assert.equal(panelEntryReply({ stillHeld: false }), PANEL_ENTRY_REPLY.IGNORE);
});

test("a send still held is refused or delivered, never both", () => {
  assert.equal(panelEntryReply({ stillHeld: true, rejection: "taken" }), PANEL_ENTRY_REPLY.REJECT);
  assert.equal(panelEntryReply({ stillHeld: true }), PANEL_ENTRY_REPLY.DELIVER);
});

test("a delivered send from the aside shape settles only with the pointer away", () => {
  assert.equal(panelEntrySettles({ aside: true, pointerInside: false }), true);
  assert.equal(
    panelEntrySettles({ aside: true, pointerInside: true }),
    false,
    "the pointer is still on the button that was pressed, and will close by leaving",
  );
  assert.equal(
    panelEntrySettles({ aside: false, pointerInside: false }),
    false,
    "saved from inside the panel: there is no shape to restore, and no leave to schedule",
  );
});
