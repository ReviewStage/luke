/**
 * middle-press.ts -- a link's middle-button click, handed to the press its click is, so a middle-click opens where a click does.
 *
 * A middle-click fires `auxclick`, never `click`, so a link whose press
 * opens the address itself (`preventDefault`, then the window's opener)
 * would otherwise be followed by the browser: in a browser tab of its own
 * at the raw address on the web, rather than where the window opens it,
 * and nowhere at all in the desktop's window, which opens no window of its
 * own. Handed the same press, a middle-click opens where a click does. A
 * press that leaves the following to the browser, as one that answers a
 * plain left click alone does, lets the browser open its tab as before.
 * Only the middle button is handed on, since another button's `auxclick`,
 * a right-click's where a browser sends one, is its menu's.
 */

import type { MouseEvent } from "react";

/** `MouseEvent.button` for the middle button, the wheel's press. */
const MIDDLE_BUTTON = 1;

/** A link's `onAuxClick`: its `press`, heard for the middle button alone. */
export function middlePressOf<Target extends Element>(
  press: (event: MouseEvent<Target>) => void,
): (event: MouseEvent<Target>) => void {
  return (event) => {
    if (event.button === MIDDLE_BUTTON) press(event);
  };
}
