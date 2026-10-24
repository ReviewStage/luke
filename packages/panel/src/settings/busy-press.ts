/**
 * busy-press.ts -- a Settings button that waits on its press: busy from the press until the act it started settles.
 */

import { useState } from "react";

/** What a button that waits on its press hands the button: whether it is busy, and the press that makes it so. */
export interface BusyPress {
  busy: boolean;
  onPress: () => void;
}

/**
 * Wraps a press that may return the act it started. The button is busy from
 * the press until that act settles, however it settles, since a refusal is
 * the act door's to say (`pressAct`'s toast) and not this button's. Note that
 * a press that returns nothing never turns the button busy.
 */
export function useBusyPress(press: () => unknown): BusyPress {
  const [busy, setBusy] = useState(false);
  const onPress = () => {
    const started = press();
    if (!(started instanceof Promise)) return;
    setBusy(true);
    const settle = () => setBusy(false);
    started.then(settle, settle);
  };
  return { busy, onPress };
}
