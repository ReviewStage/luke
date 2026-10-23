import type { Ref } from "react";
import { TEXT_FIELD_SIZE, TextField } from "../text-field/text-field.js";

/**
 * address-field.tsx -- a Browser tab's address bar: one compact line for an address or a search, which every place that asks for a page's address draws alike.
 *
 * The field is controlled, as a TextField is: the caller owns what is typed
 * and reads it as an address (`@luke/features/browser-acts`'s
 * `browserAddressOf`), since what an address opens, and where, is the
 * caller's. It fills the room its row leaves, takes no correction or
 * capital the system would make of a host, and selects every word as the
 * caret arrives, so typing replaces the address as a browser's bar does.
 * It stands in a form of its own, so Enter, or a phone keyboard's Go,
 * submits it as the caller's open; Escape is its leaving the bar, and a
 * blur its putting back what the bar showed.
 */

/** What the field asks for while it is empty. */
export const ADDRESS_FIELD_PLACEHOLDER = "Search or type an address, like localhost:3000";

export function AddressField({
  value,
  onChange,
  onOpen,
  onEscape,
  onBlur,
  autoFocus,
  disabled,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Opens what is typed, as the form is submitted. */
  onOpen: () => void;
  onEscape?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  return (
    <form
      className="luke-address-field"
      onSubmit={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      <TextField
        ref={ref}
        label="Address"
        size={TEXT_FIELD_SIZE.COMPACT}
        placeholder={ADDRESS_FIELD_PLACEHOLDER}
        spellCheck={false}
        autoCorrect={false}
        selectOnFocus
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={onChange}
        onEscape={onEscape}
        onBlur={onBlur}
      />
    </form>
  );
}
