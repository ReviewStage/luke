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

const BOTH = [false, true] as const;

test("the entry's five decisions, exhaustively", () => {
  // Ending an entry is what releases the hold it had on the panel: an entry
  // that ends with the pointer already away leaves the panel held by nothing,
  // because the pointer cannot leave a second time.
  for (const previous of [undefined, { busy: false }, { busy: true }]) {
    for (const next of [undefined, { busy: false }, { busy: true }]) {
      assert.equal(
        panelEntryReleased(previous, next),
        previous !== undefined && next === undefined,
        `released ${previous?.busy} -> ${next?.busy}`,
      );
    }
  }

  // A reply in flight is answering the entry underneath it, so nothing may
  // replace it but ending it outright.
  assert.equal(panelEntryOpen(undefined), false);
  for (const busy of BOTH) assert.equal(panelEntryOpen({ busy }), !busy, `open busy=${busy}`);

  for (const aside of BOTH) {
    for (const restore of BOTH) {
      assert.equal(
        panelEntryCancel({ aside, restore }),
        !aside
          ? // Giving up from inside the panel has no shape to put away.
            PANEL_ENTRY_CANCEL.NONE
          : restore
            ? // A key started from the panel, or a note from settings.
              PANEL_ENTRY_CANCEL.RESTORE
            : // A key page that was opened, or a composer opened by voice.
              PANEL_ENTRY_CANCEL.LEAVE,
        `cancel aside=${aside} restore=${restore}`,
      );
      assert.equal(
        panelEntrySettles({ aside, pointerInside: restore }),
        // Saved from inside the panel there is no shape to restore and no
        // leave to schedule; with the pointer still on the button that was
        // pressed, the leave it will make is what closes the panel.
        aside && !restore,
        `settles aside=${aside} pointerInside=${restore}`,
      );
    }
  }

  for (const stillHeld of BOTH) {
    for (const rejection of [undefined, "taken"]) {
      assert.equal(
        panelEntryReply({ stillHeld, rejection }),
        !stillHeld
          ? // A reply that outlived its own entry is spent.
            PANEL_ENTRY_REPLY.IGNORE
          : rejection
            ? PANEL_ENTRY_REPLY.REJECT
            : PANEL_ENTRY_REPLY.DELIVER,
        `reply stillHeld=${stillHeld} rejection=${rejection}`,
      );
    }
  }
});
