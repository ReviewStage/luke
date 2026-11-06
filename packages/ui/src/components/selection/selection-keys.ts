import { selectedWords } from "@repo/features/words";
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { ANNOUNCE, useAnnounce } from "../announcer/announcer.js";
import { focusRovingStop, ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { focusChoosable } from "./list-selection.js";

/**
 * selection-keys.ts -- what every toolbar of a list's chosen rows does with the keys and the focus, whether it stands at the list's foot (`SelectionBar`) or in its head (`SelectionToolbar`).
 *
 * The toolbar says how many rows are chosen, politely through the window's
 * `Announcer`, as the count changes. Tab stops on it once and ←→ walk its
 * buttons (`useRovingKeys`); Esc chooses none. It names the list it acts on
 * (`controls`), and where it held the focus as the last row left the
 * selection, by Clear, Esc, or an act that took the rows away, it hands the
 * focus to that list's Tab stop, or a `SelectionRegion`'s first row, rather
 * than let it fall to the page as its buttons go.
 */

/** What a selection's toolbar spreads on its own element, which says itself a `toolbar`. */
export interface SelectionToolbarProps {
  readonly "data-roving": "";
  readonly ref: RefCallback<HTMLDivElement>;
  readonly "aria-controls": string;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLDivElement>) => void;
}

/** The keys, the focus, and the count's announcement of a toolbar acting on `count` chosen rows of the list `controls` names. */
export function useSelectionKeys({
  count,
  controls,
  onClear,
}: {
  count: number;
  controls: string;
  onClear: () => void;
}): SelectionToolbarProps {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });
  useAnnounce(ANNOUNCE.POLITE, count > 0 ? selectedWords(count) : "");
  // Whether the focus stands in the toolbar, or stood there as its buttons went.
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (count > 0 || !holding.current) return;
    holding.current = false;
    // Note that only a focus fallen to the page is handed on, never one something else took.
    const fell = document.activeElement === null || document.activeElement === document.body;
    const list = document.getElementById(controls);
    // Note that a region of the app's own rows keeps no roving Tab stop, so its first row takes the focus instead.
    if (fell && list !== null && !focusRovingStop(list)) focusChoosable(list);
  }, [count, controls]);
  return {
    "data-roving": roving["data-roving"],
    ref: roving.ref,
    "aria-controls": controls,
    onFocus: (event) => {
      holding.current = true;
      roving.onFocus(event);
    },
    // Note that a button taken away blurs with nowhere to go, so only a focus moved somewhere lets go.
    onBlur: (event) => {
      const to = event.relatedTarget;
      if (to instanceof Node && !event.currentTarget.contains(to)) holding.current = false;
    },
    onKeyDown: (event) => {
      if (roving.onKeyDown(event) || event.defaultPrevented) return;
      if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClear();
    },
  };
}
