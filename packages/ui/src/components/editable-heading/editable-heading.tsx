import type { FocusEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { isComposingKey } from "../../composing-key.js";
import { MARKDOWN_CLASS } from "../../markdown/markdown-class.js";

/**
 * editable-heading.tsx -- a heading's words edited where they are drawn, in the heading's own look, which wraps as a heading does where a field could not.
 *
 * It is plain text in a heading's type, its caret in the accent and no box
 * around it, so editing it moves no word. It takes the focus only when its
 * owner puts it there, as a press into its words or a document's keys do,
 * and is no Tab stop of its own. Esc leaves it back onto what holds it, and
 * Return or ↓ leaves it on into what follows; either is its owner's to
 * carry out, `onLeave` hearing which, after the key's default is held back.
 */

/** Which way a key left the heading: back onto what holds it, or on into what follows it. */
export const EDITABLE_HEADING_LEAVE = {
  BACK: "back",
  ON: "on",
} as const;

export type EditableHeadingLeave =
  (typeof EDITABLE_HEADING_LEAVE)[keyof typeof EDITABLE_HEADING_LEAVE];

/** The heading levels it is drawn at, as a note's headings are. */
export type EditableHeadingLevel = 1 | 2 | 3;

/** The way out a key asks for, or none for a key that types. */
function leaveOf(key: string): EditableHeadingLeave | undefined {
  if (key === "Escape") return EDITABLE_HEADING_LEAVE.BACK;
  if (key === "Enter" || key === "ArrowDown") return EDITABLE_HEADING_LEAVE.ON;
  return undefined;
}

/** A heading edited in place; `onInput`, `onFocus`, and `onBlur` hear its typing and its focus. */
export function EditableHeading({
  label,
  level,
  ref,
  onInput,
  onFocus,
  onBlur,
  onLeave,
}: {
  label: string;
  level: EditableHeadingLevel;
  ref?: RefObject<HTMLDivElement | null> | undefined;
  onInput?: ((event: FormEvent<HTMLDivElement>) => void) | undefined;
  onFocus?: ((event: FocusEvent<HTMLDivElement>) => void) | undefined;
  onBlur?: ((event: FocusEvent<HTMLDivElement>) => void) | undefined;
  onLeave: (way: EditableHeadingLeave, heading: HTMLDivElement) => void;
}): React.JSX.Element {
  const keyed = (event: KeyboardEvent<HTMLDivElement>) => {
    // Note that a key an input method took is left alone entirely, even
    // its default, because its Enter confirms a composition rather than
    // leaving the heading, and its Escape cancels one.
    if (isComposingKey(event)) return;
    const way = leaveOf(event.key);
    if (way === undefined) return;
    event.preventDefault();
    onLeave(way, event.currentTarget);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the words are edited in the heading's own look, which wraps as a heading does; an input cannot.
    <div
      ref={ref}
      className={`${MARKDOWN_CLASS.HEADING} luke-editable-heading`}
      data-level={level}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      tabIndex={-1}
      spellCheck
      onFocus={onFocus}
      onInput={onInput}
      onBlur={onBlur}
      onKeyDown={keyed}
    />
  );
}
