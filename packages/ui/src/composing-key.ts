/**
 * composing-key.ts -- whether a key went to an input method composing text rather than to the field it was typed in.
 *
 * Every field that answers a key (Enter, Escape, an arrow) first asks this,
 * so a key that picks a candidate in an input method never submits, closes,
 * or moves anything.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Whether a key, React's or the DOM's own, went to an input method composing text rather than to the field. */
export function isComposingKey(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || event.keyCode === 229;
}
