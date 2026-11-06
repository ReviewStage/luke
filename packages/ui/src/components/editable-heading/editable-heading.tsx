import type { FocusEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { isComposingKey } from "../../composing-key.js";

export const EDITABLE_HEADING_LEAVE = {
  BACK: "back",
  ON: "on",
} as const;

export type EditableHeadingLeave =
  (typeof EDITABLE_HEADING_LEAVE)[keyof typeof EDITABLE_HEADING_LEAVE];

function leaveOf(key: string): EditableHeadingLeave | undefined {
  if (key === "Escape") return EDITABLE_HEADING_LEAVE.BACK;
  if (key === "Enter" || key === "ArrowDown") return EDITABLE_HEADING_LEAVE.ON;
  return undefined;
}

export function EditableHeading({
  label,
  ref,
  onInput,
  onFocus,
  onBlur,
  onLeave,
}: {
  label: string;
  ref?: RefObject<HTMLElement | null> | undefined;
  onInput?: ((event: FormEvent<HTMLElement>) => void) | undefined;
  onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  onBlur?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  onLeave: (way: EditableHeadingLeave, heading: HTMLElement) => void;
}): React.JSX.Element {
  const keyed = (event: KeyboardEvent<HTMLElement>) => {
    if (isComposingKey(event)) return;
    const way = leaveOf(event.key);
    if (way === undefined) return;
    event.preventDefault();
    onLeave(way, event.currentTarget);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the words are edited in the heading's own look, which wraps as a heading does; an input cannot.
    <span
      ref={ref}
      className="ui-editable-heading"
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
