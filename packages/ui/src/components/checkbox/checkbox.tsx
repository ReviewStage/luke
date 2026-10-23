import { type ReactNode, useRef } from "react";
import { cn } from "../../cn.js";
import { pulsePress } from "../../press-pulse.js";
import { Checkbox as ShadcnCheckbox } from "../../shadcn/checkbox.js";

/**
 * checkbox.tsx -- a yes-or-no choice beside the words that say what it is: a box drawn in the accent.
 *
 * The box is shadcn/ui's Base UI checkbox (`../../shadcn/checkbox.tsx`), a
 * `role="checkbox"` the reader is told is checked, unchecked, or mixed, with
 * a hidden native checkbox beside it that a form submits. It is checked and
 * unchecked by a press on it or on its words and by Space alike. It is controlled: the caller holds `checked` and answers every
 * change with the value it asks for, so a press and a key arrive as the same
 * value. A box standing for a group whose members are some checked and some
 * not is `mixed`, which a press resolves to checked. A box `readOnly` records
 * a choice made: drawn as it stands, in its words' own ink rather than an
 * unavailable box's faded one, its press and Space changing nothing. A box
 * whose words stand beside it already, a task item's marker, is named by a
 * `label` of its own and draws the box alone, which on a coarse pointer
 * takes a press a finger's width across, centred on it.
 */

/** How a box is named: by its words beside it, or by a label of its own where it stands alone. */
type Named =
  | {
      /** Its words, which name it and take a press for it. */
      children: ReactNode;
      label?: undefined;
    }
  | {
      children?: undefined;
      /** The accessible name of a box drawn without words. */
      label: string;
    };

/**
 * The words beside the box, in the body's type, the box standing on their
 * first line. Note that their ink is `checkbox.css`'s, which a stepped-back
 * region quiets from the components layer, where a utility would outrank it.
 */
const CHECKBOX =
  "luke-checkbox inline-flex items-start gap-icon-gap min-w-0 font-ui text-body cursor-pointer in-data-[luke-profile=desktop]:cursor-default";

/**
 * A box without words stands on no line of its own, and on a coarse
 * pointer takes a press a finger's width across, centred on it, while it
 * draws at its own size, as a compact button does.
 */
const BOX_ALONE =
  "relative pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']";

/** The box beside words, stood on their first line. */
const BOX_ON_LINE = "mt-[calc((var(--luke-type-body-leading)-14px)/2)]";

/** A box and its words, checked while `checked`, answering a change with the value asked for. */
export function Checkbox({
  checked,
  onChange,
  mixed = false,
  disabled,
  readOnly = false,
  name,
  id,
  "aria-describedby": describedBy,
  children,
  label,
}: Named & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Whether it stands for a group partly checked, drawn as a dash and read as mixed. */
  mixed?: boolean;
  disabled?: boolean | undefined;
  /** Whether it records a choice made, which no press or key changes. */
  readOnly?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
  /** The id of the words that say more of what checking it does. */
  "aria-describedby"?: string | undefined;
}): React.JSX.Element {
  const words = label === undefined;
  const box = useRef<HTMLElement | null>(null);
  return (
    <label
      className={cn(
        CHECKBOX,
        (disabled === true || readOnly) && "cursor-default",
        !words && BOX_ALONE,
      )}
      data-disabled={disabled === true}
      data-read-only={readOnly || undefined}
      data-words={words}
    >
      <ShadcnCheckbox
        ref={box}
        className={cn("luke-checkbox-box", words && BOX_ON_LINE)}
        id={id}
        name={name}
        checked={checked}
        indeterminate={mixed}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={label}
        aria-describedby={describedBy}
        // Note that a mixed box asks for checked whatever it would toggle
        // to under the dash, while the box itself keeps the caller's
        // `checked`, so a form it stands in still submits what the caller holds.
        // A read-only box hands nothing on, so it stays as its caller holds it.
        onCheckedChange={(next) => {
          if (readOnly) return;
          // Note that a box ticked springs up by its own tick, which outranks the pulse, so the pulse is an unticking's.
          if (box.current !== null) pulsePress(box.current);
          onChange(mixed ? true : next);
        }}
      />
      {words ? <span className="luke-checkbox-words min-w-0 wrap-anywhere">{children}</span> : null}
    </label>
  );
}
