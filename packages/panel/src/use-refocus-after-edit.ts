import { type RefObject, useCallback, useEffect, useRef } from "react";

/**
 * use-refocus-after-edit.ts -- focus handed back to the control an in-place edit opened from, once the edit ended by a key.
 *
 * An `InlineEdit` drawn in place of a row's or a tab's press takes the press
 * away while it stands, so focus would fall to the page when it ends. An edit
 * ended by a key (Enter or Escape) hands focus back to the press, so the
 * keyboard goes on from where it was; one ended by a press elsewhere leaves
 * focus where that press put it.
 */

/**
 * Focuses `target` once `open` falls, where the edit was last ended by a key;
 * answers the door an edit's end reports whether it was.
 */
export function useRefocusAfterEdit(
  open: boolean,
  target: RefObject<HTMLElement | null>,
): (byKey: boolean) => void {
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    target.current?.focus();
  }, [open, target]);
  return useCallback((byKey: boolean) => {
    refocus.current = byKey;
  }, []);
}
