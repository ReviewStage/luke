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

export interface SelectionToolbarProps {
  readonly "data-roving": "";
  readonly ref: RefCallback<HTMLDivElement>;
  readonly "aria-controls": string;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLDivElement>) => void;
}

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
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (count > 0 || !holding.current) return;
    holding.current = false;
    const fell = document.activeElement === null || document.activeElement === document.body;
    const list = document.getElementById(controls);
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
