import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { type ChoiceRole, type ChoiceStop, choiceKeyTarget, choiceTabStop } from "./choice-keys.js";

/**
 * use-choice-keys.ts -- the keys and the one tab stop of a row of options where you choose one, which `Tabs` and `Segmented` share.
 *
 * The row is the caller's: it draws its options, in order, each carrying
 * `role` (a tab or a radio) inside the element the handler is put on, and
 * says which is chosen and what choosing one does. This decides the rest.
 * The row is one tab stop, on the chosen option or the first while none is,
 * so Tab lands on it and leaves the row in one press. A key that moves
 * (`choiceKeyTarget`) takes the keyboard to the option it lands on and
 * chooses it as it goes, selection following focus, stepping from the
 * option the keyboard is on, or the chosen one where it is on none. A
 * disabled row takes no key.
 */

/** What a row hands its element and each of its options. */
export interface ChoiceKeys<Value extends string> {
  /** The handler for the row's own element; none while the row is disabled. */
  readonly onKeyDown: ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined;
  /** The `tabIndex` of the option for `value`: 0 for the row's one tab stop, -1 for every other. */
  readonly tabIndexOf: (value: Value) => 0 | -1;
}

/** The keys and tab stop of a row of `options` in `role`, `value` chosen, `onChoose` answering an option a key lands on. */
export function useChoiceKeys<Value extends string>({
  options,
  value,
  role,
  disabled = false,
  onChoose,
}: {
  options: readonly (ChoiceStop & { readonly value: Value })[];
  value: Value | undefined;
  role: ChoiceRole;
  disabled?: boolean | undefined;
  onChoose: (value: Value) => void;
}): ChoiceKeys<Value> {
  const tabStop = choiceTabStop(options, value);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
    const focused =
      event.target instanceof Element ? event.target.closest(`[role="${role}"]`) : null;
    const on = focused instanceof HTMLElement ? elements.indexOf(focused) : -1;
    const from = on >= 0 ? on : options.findIndex((option) => option.value === value);
    const to = choiceKeyTarget(event, from, options, role);
    const next = to === undefined ? undefined : options[to];
    if (to === undefined || next === undefined) return;
    event.preventDefault();
    elements[to]?.focus();
    if (next.value !== value) onChoose(next.value);
  };
  return {
    onKeyDown: disabled ? undefined : onKeyDown,
    tabIndexOf: (each) => (each === tabStop ? 0 : -1),
  };
}
