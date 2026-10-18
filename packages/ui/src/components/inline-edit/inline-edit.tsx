import type { KeyboardEvent, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

/**
 * inline-edit.tsx -- words edited where they are drawn: shown as they stand, and, while the caller says, a field over them in their place.
 *
 * The caller holds whether it is editing, as a list holds which row it is
 * renaming, and draws the words itself (`children`) where it shows them in
 * more than plain text. The field opens with all of them selected. Return
 * or the focus leaving keeps what was typed, and Escape keeps the words it
 * opened on; words left empty or unchanged change nothing. The field is
 * uncontrolled, so the caller hears only how the edit ended, once, by
 * whichever of those came first, and whether a key ended it, so it can hand
 * focus back to what it draws while not editing.
 *
 * Text arriving through an input method is composed in place before it is
 * committed, so the Return that commits a composition, and the Escape that
 * dismisses its candidates, are the input method's and end nothing. Note
 * that every Escape goes no further than the field, a composing one too,
 * because the surface behind it would otherwise answer it, leaving the page
 * the field stands on.
 */

/**
 * How the field is drawn: on a field's own ground inside a hairline, or
 * bare in the type around it, where what it stands in is a well that rings
 * it, as a tab's is.
 */
export const INLINE_EDIT_LOOK = {
  FIELD: "field",
  WELL: "well",
} as const;

export type InlineEditLook = (typeof INLINE_EDIT_LOOK)[keyof typeof INLINE_EDIT_LOOK];

/** How an edit ended: the words to keep, if any changed, and whether a key ended it. */
export interface InlineEditEnd {
  readonly value: string | undefined;
  readonly byKey: boolean;
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** The field, opened over `value`; it ends once, by Return, Escape, or the focus leaving. */
function InlineEditField({
  value,
  label,
  maxLength,
  look,
  onEnd,
}: {
  value: string;
  label: string;
  maxLength: number | undefined;
  look: InlineEditLook;
  onEnd: (end: InlineEditEnd) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const ended = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const end = (keep: boolean, byKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const typed = field.current?.value.trim() ?? "";
    onEnd({ value: keep && typed !== "" && typed !== value ? typed : undefined, byKey });
  };

  return (
    <input
      ref={field}
      type="text"
      className="luke-inline-edit"
      data-look={look}
      aria-label={label}
      defaultValue={value}
      maxLength={maxLength}
      spellCheck={false}
      onBlur={() => end(true, false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!composing(event)) end(false, true);
        }
        if (event.key === "Enter" && !composing(event)) {
          event.preventDefault();
          end(true, true);
        }
      }}
    />
  );
}

/** `value` shown, or drawn as `children`, until `editing`, and then a field named `label` editing it in place. */
export function InlineEdit({
  value,
  label,
  editing,
  maxLength,
  look = INLINE_EDIT_LOOK.FIELD,
  onEnd,
  children,
}: {
  value: string;
  /** What the field is called for a reader. */
  label: string;
  editing: boolean;
  maxLength?: number | undefined;
  look?: InlineEditLook | undefined;
  /** How the edit ended; the caller stops editing here. */
  onEnd: (end: InlineEditEnd) => void;
  /** What stands in the field's place while not editing; `value` in plain text where none is given. */
  children?: ReactNode;
}): React.JSX.Element {
  if (!editing) return <>{children ?? value}</>;
  return (
    <InlineEditField value={value} label={label} maxLength={maxLength} look={look} onEnd={onEnd} />
  );
}
