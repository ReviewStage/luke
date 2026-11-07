import { FIELD_WORDS } from "@repo/features/words";
import { type ReactNode, type Ref, useState } from "react";
import { HideSecretIcon, ShowSecretIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import {
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_END,
  TEXT_FIELD_TYPE,
  TextField,
} from "../text-field/text-field.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * secret-field.tsx -- a field a secret is pasted into: a token, an API key, a password a service gave. Masked as it is typed, shown on a press, and never filled or kept by the system.
 *
 * It is a `FormField` (its label above it, its description and its error
 * under it, Optional where it may be left empty) whose control is a one-line
 * field masked as a password is, with a press inside its end that shows what
 * was typed and masks it again, so its edges line up with the fields around
 * it. The system neither offers to fill it nor to keep what it holds, checks
 * its spelling, or corrects it.
 *
 * A secret already kept somewhere (`saved`) is never handed back to the
 * window, so the field cannot show it: while nothing new is typed it says
 * Saved where its characters would stand, and what is typed replaces the
 * kept one. There is nothing to show while nothing is typed, so the press
 * waits for typing, and a field emptied, as a caller empties one once its
 * secret is saved, is masked again before it takes the next.
 */

/** A field a secret is typed or pasted into, masked until its press shows it. */
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
  /** What is wrong with the secret, or what refused it, and the failure beneath; nothing while it is fine. */
  error?: ShownError | undefined;
  /** Whether the field may be left empty, which its label then says. */
  optional?: boolean | undefined;
  /** Whether a secret is already kept, which the field says without showing it. */
  saved?: boolean | undefined;
  /** What is typed: never a secret already kept. */
  value: string;
  onChange: (value: string) => void;
  /** An example of what is pasted, where nothing is kept yet. */
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  onEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  /** What a paste does once it lands, handed what the field then holds: a secret is pasted far more than typed, so a form may save on it. */
  onPasted?: ((value: string) => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const typed = value !== "";
  // Note that a field emptied is masked again in the render that sees it,
  // because the next secret typed must not arrive in plain sight.
  if (shown && !typed) setShown(false);
  const toggle = shown ? FIELD_WORDS.HIDE : FIELD_WORDS.SHOW;
  return (
    <FormField label={label} description={description} error={error} optional={optional}>
      {(control) => (
        <div className="relative">
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
            end={TEXT_FIELD_END.PRESS}
          />
          <span className="absolute inset-y-0 end-1.5 flex items-center">
            <Tooltip label={toggle}>
              <IconButton
                icon={shown ? <HideSecretIcon /> : <ShowSecretIcon />}
                label={toggle}
                size={BUTTON_SIZE.COMPACT}
                disabled={disabled || !typed}
                onClick={() => setShown((now) => !now)}
              />
            </Tooltip>
          </span>
        </div>
      )}
    </FormField>
  );
}
