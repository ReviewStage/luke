import { type ReactNode, useEffect, useRef } from "react";

/**
 * checkbox.tsx -- a yes-or-no choice beside the words that say what it is: the platform's own box, drawn in the accent.
 *
 * The box is a native checkbox, so it is checked and unchecked by a press on
 * it or on its words and by Space alike, and is the platform's own control to
 * a reader. It is controlled: the caller holds `checked` and answers every
 * change with the value it asks for, so a press and a key arrive as the same
 * value. A box standing for a group whose members are some checked and some
 * not is `mixed`, which a press resolves to checked.
 */

/** A box and its words, checked while `checked`, answering a change with the value asked for. */
export function Checkbox({
  checked,
  onChange,
  mixed = false,
  disabled,
  name,
  id,
  "aria-describedby": describedBy,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Whether it stands for a group partly checked, drawn as a dash and read as mixed. */
  mixed?: boolean;
  disabled?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
  /** The id of the words that say more of what checking it does. */
  "aria-describedby"?: string | undefined;
  /** Its words, which name it and take a press for it. */
  children: ReactNode;
}): React.JSX.Element {
  const box = useRef<HTMLInputElement>(null);
  // Mixed is a property of the element alone, with no attribute to render.
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className="luke-checkbox" data-disabled={disabled === true}>
      <input
        ref={box}
        className="luke-checkbox-box"
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        // Note that a mixed box asks for checked whatever its box toggled
        // to under the dash, while the box itself keeps the caller's
        // `checked`, so a form it stands in still submits what the caller holds.
        onChange={(event) => onChange(mixed ? true : event.target.checked)}
      />
      <span className="luke-checkbox-words">{children}</span>
    </label>
  );
}
