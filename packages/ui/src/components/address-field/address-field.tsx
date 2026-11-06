import type { Ref } from "react";
import { TEXT_FIELD_SIZE, TextField } from "../text-field/text-field.js";

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
  onOpen: () => void;
  onEscape?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  return (
    <form
      className="flex min-w-0 flex-1"
      noValidate
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
