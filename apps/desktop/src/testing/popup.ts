/**
 * popup.ts -- whether a trigger opened the kind of popup it says it opens: its `aria-haspopup` is the role of what its `aria-controls` names.
 */

import assert from "node:assert/strict";

/** Fails unless the popup an open `trigger` controls has the role its `aria-haspopup` promised a reader. */
export function assertOpensWhatItNames(trigger: Element): void {
  const controlled = trigger.getAttribute("aria-controls");
  assert.ok(controlled, "the open trigger names what it controls");
  const popup = trigger.ownerDocument.getElementById(controlled);
  assert.ok(popup, "what the trigger controls is in the document");
  assert.equal(
    trigger.getAttribute("aria-haspopup"),
    popup.getAttribute("role"),
    "the trigger says it opens the kind of popup it opened",
  );
}
