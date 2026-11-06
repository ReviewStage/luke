import { FIELD_WORDS } from "@repo/features/words";
import { type ReactNode, type Ref, useState } from "react";
import { HideSecretIcon, ShowSecretIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { IconButton } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import { GAP, Inline } from "../layout/layout.js";
import { TEXT_FIELD_AUTO_COMPLETE, TEXT_FIELD_TYPE, TextField } from "../text-field/text-field.js";
import { Tooltip } from "../tooltip/hint.js";

export function SecretField({
  label,
  description,
  error,
  optional = false,
  saved = false,
  value,
  onChange,
  placeholder,
  disabled = false,
  autoFocus,
  onEnter,
  onEscape,
  onPasted,
  ref,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ShownError | undefined;
  optional?: boolean | undefined;
  saved?: boolean | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  onEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  onPasted?: ((value: string) => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const typed = value !== "";
  if (shown && !typed) setShown(false);
  const toggle = shown ? FIELD_WORDS.HIDE : FIELD_WORDS.SHOW;
  return (
    <FormField label={label} description={description} error={error} optional={optional}>
      {(control) => (
        <Inline wrap={false} gap={GAP.TIGHT} growFirst>
          <TextField
            ref={ref}
            field={control}
            type={shown ? TEXT_FIELD_TYPE.TEXT : TEXT_FIELD_TYPE.PASSWORD}
            autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
            autoCorrect={false}
            spellCheck={false}
            placeholder={saved ? FIELD_WORDS.SAVED : placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            value={value}
            onChange={onChange}
            onEnter={onEnter}
            onEscape={onEscape}
            onPasted={onPasted}
          />
          <Tooltip label={toggle}>
            <IconButton
              icon={shown ? <HideSecretIcon /> : <ShowSecretIcon />}
              label={toggle}
              disabled={disabled || !typed}
              onClick={() => setShown((now) => !now)}
            />
          </Tooltip>
        </Inline>
      )}
    </FormField>
  );
}
