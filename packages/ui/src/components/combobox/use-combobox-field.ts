import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isComposingKey } from "../../composing-key.js";
import { ROVING_ORIENTATION, rovingStep } from "../roving-keys/roving-keys.js";

export interface ComboboxFieldProps {
  readonly role: "combobox";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string | undefined;
  readonly "aria-autocomplete": "list";
  readonly "aria-activedescendant": string | undefined;
  readonly autoComplete: "off";
}

export type ComboboxKey = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;

export interface ComboboxField {
  readonly field: ComboboxFieldProps;
  readonly onKeyDown: (event: ComboboxKey) => boolean;
}

function steppedTo(
  key: string,
  at: number,
  count: number,
  skipped: ((index: number) => boolean) | undefined,
): number | undefined {
  const to = rovingStep(key, ROVING_ORIENTATION.VERTICAL, at, count, skipped);
  return to !== undefined && count === 0 ? 0 : to;
}

export function useComboboxField(input: {
  open: boolean;
  active: number;
  count: number;
  skipped?: ((index: number) => boolean) | undefined;
  controls: string | undefined;
  activeId: string | undefined;
  onActiveChange: (index: number) => void;
  onChoose: (index: number) => void;
  onEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  onKey?: ((event: ComboboxKey) => void) | undefined;
}): ComboboxField {
  const { open, active, count } = input;
  const onKeyDown = (event: ComboboxKey): boolean => {
    const ime = isComposingKey(event);
    if (event.key === "Escape" && (open || ime)) event.stopPropagation();
    if (ime) return false;
    const moved = open ? steppedTo(event.key, active, count, input.skipped) : undefined;
    if (moved !== undefined) {
      event.preventDefault();
      input.onActiveChange(moved);
      return true;
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      input.onEscape?.();
      return true;
    }
    if (event.key !== "Enter") {
      input.onKey?.(event);
      return false;
    }
    event.preventDefault();
    if (open && !event.metaKey && !event.ctrlKey) input.onChoose(active);
    else input.onEnter?.();
    return true;
  };
  return {
    field: {
      role: "combobox",
      "aria-expanded": open,
      "aria-controls": open ? input.controls : undefined,
      "aria-autocomplete": "list",
      "aria-activedescendant": open ? input.activeId : undefined,
      autoComplete: "off",
    },
    onKeyDown,
  };
}
