import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * use-combobox-field.ts -- the keys and the names of a field that steers a list while the caret stays in it, which `Combobox` and the desktop's searchable menu share.
 *
 * The caller owns the list: how many rows stand, which is active, which are
 * passed over, and what choosing one does. This decides what a key does to
 * them, and names the field to a reader as the combobox it is. While the list
 * is open, ↑ and ↓ move the active row a step, wrapping at either end and on
 * past any row the caller skips, Home and End take it to the first and the
 * last that is not skipped, Enter chooses it, and Escape is handed to the
 * caller and kept from the surface behind the field. An Enter held with
 * Command or Control, or one pressed while the list is shut, chooses no row
 * and answers `onEnter` instead. A key the field does not steer by goes to
 * `onKey`, for a caller with keys of its own. The handler says whether it
 * took the key, for an editor that owns the caret and forwards its keys
 * (an `@` list's), which hands the key on to its own text where it did not.
 *
 * Keys an input method is composing with are its own: none of them reaches
 * the list or `onKey`, though an Escape is still kept from the surface behind.
 */

/** What the field is named to a reader by, spread onto it. */
export interface ComboboxFieldProps {
  readonly role: "combobox";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string | undefined;
  readonly "aria-autocomplete": "list";
  readonly "aria-activedescendant": string | undefined;
  readonly autoComplete: "off";
}

/** A key as the field hears it: React's, on a field it is spread onto, or the page's, forwarded by an editor that owns the caret. */
export type ComboboxKey = ReactKeyboardEvent<HTMLElement> | KeyboardEvent;

/** The field's names, and the key handler for it or a box around it, which says whether it took the key. */
export interface ComboboxField {
  readonly field: ComboboxFieldProps;
  readonly onKeyDown: (event: ComboboxKey) => boolean;
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: ComboboxKey): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || event.keyCode === 229;
}

/**
 * Where a key takes the active row among `count`: the arrows a step on,
 * wrapping at either end, and on past any row skipped; from nowhere, to the
 * first or the last; Home and End to the first or the last not skipped.
 * Where every row is skipped, it stays; a key that moves none answers undefined.
 */
function steppedTo(
  key: string,
  at: number,
  count: number,
  skipped: (index: number) => boolean,
): number | undefined {
  const down = key === "ArrowDown" || key === "Home";
  if (!down && key !== "ArrowUp" && key !== "End") return undefined;
  if (count === 0) return 0;
  const edge = key === "Home" || key === "End";
  const step = down ? 1 : -1;
  let next = at < 0 || edge ? (down ? 0 : count - 1) : (at + step + count) % count;
  for (let steps = 1; steps < count && skipped(next); steps += 1) {
    next = (next + step + count) % count;
  }
  return skipped(next) ? at : next;
}

const NONE_SKIPPED = () => false;

/** The field's names and its key handler, over a list of `count` rows whose active one is `active`. */
export function useComboboxField(input: {
  /** Whether the list stands, so the keys steer it. */
  open: boolean;
  /** The active row, or below zero for none. */
  active: number;
  count: number;
  /** Rows the keys pass over: those that cannot be chosen now. */
  skipped?: ((index: number) => boolean) | undefined;
  /** The id, or the space-separated ids, of what the field controls while the list stands. */
  controls: string | undefined;
  /** The id of the row the field names active, while the list stands. */
  activeId: string | undefined;
  onActiveChange: (index: number) => void;
  /** What Enter does for the active row. */
  onChoose: (index: number) => void;
  /** What an Enter that chooses no row does: one held with Command or Control, or pressed while the list is shut. */
  onEnter?: (() => void) | undefined;
  /** What an Escape does while the list stands: shutting it, as a rule. */
  onEscape?: (() => void) | undefined;
  /** What a key the field does not steer by does. */
  onKey?: ((event: ComboboxKey) => void) | undefined;
}): ComboboxField {
  const { open, active, count } = input;
  const onKeyDown = (event: ComboboxKey): boolean => {
    // Note that an Escape an input method is composing with is kept from the
    // surface behind even with the list shut, because it cancels candidates.
    const ime = composing(event);
    if (event.key === "Escape" && (open || ime)) event.stopPropagation();
    if (ime) return false;
    const moved = open
      ? steppedTo(event.key, active, count, input.skipped ?? NONE_SKIPPED)
      : undefined;
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
