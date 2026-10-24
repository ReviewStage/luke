import { useCallback, useState } from "react";

/**
 * use-held-through-exit.ts -- what a dialog's owner keeps drawn for the fade that takes it away.
 *
 * A dialog fades out as its owner's `open` falls (`@luke/ui`'s `Dialog`), so
 * an owner whose card holds state, or reads data while it is drawn, must not
 * unmount it in the render that closes it. This holds what it was opened
 * with from the opening until the dialog says it is gone (`onExited`), and
 * lets go then, so each opening starts afresh, as an unmounted card did.
 * Note that `shown` is compared by identity, so it is a value that stands
 * between renders (a string, a state's object), never one built in the render.
 */

/** What an owner draws the card from while it is shown or fading, and what to hand its dialog's `onExited`. */
interface HeldThroughExit<T> {
  /** What the card was last opened with, until its fade has run; nothing before it opens and once it is gone. */
  held: T | undefined;
  onExited: () => void;
}

/** `shown` while it is anything but nothing, held after it goes until `onExited`. */
export function useHeldThroughExit<T>(shown: T | undefined): HeldThroughExit<T> {
  const [last, setLast] = useState(shown);
  if (shown !== undefined && last !== shown) setLast(shown);
  const onExited = useCallback(() => setLast(undefined), []);
  return { held: shown ?? last, onExited };
}

/** Whether the card is drawn, from `open` until its fade has run, and what to hand its dialog's `onExited`. */
export function useDrawnThroughExit(open: boolean): { drawn: boolean; onExited: () => void } {
  const { held, onExited } = useHeldThroughExit(open ? true : undefined);
  return { drawn: held !== undefined, onExited };
}
