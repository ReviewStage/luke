import type { HTMLAttributes, MouseEvent } from "react";

/**
 * skill-chip.tsx -- a chosen skill in a message box's words: its `/name` as a pill, a press on which opens the skill's file where the place can open it.
 *
 * The pill is a word of the box's text, an atom the editor writes and one
 * Backspace takes out whole, which the keyboard edits rather than presses,
 * so it is no button and no Tab stop: its press is the pointer's shortcut to
 * the file, as a sent message's chip, a button, opens it. Where it opens
 * (`onOpen`), the pointer turns to a hand over it and it washes under the
 * pointer. Its hint is the app's, which wraps it and hands it its handlers.
 */

/** What a hint hands the pill it wraps: when to show and go, and what it says of it. */
type SkillChipHintProps = Pick<
  HTMLAttributes<HTMLElement>,
  | "aria-describedby"
  | "aria-keyshortcuts"
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onClick"
  | "onFocus"
  | "onBlur"
>;

/** A chosen skill's pill in a box's words, opening its file where `onOpen` is given. */
export function SkillChip({
  label,
  onOpen,
  onClick,
  ...hint
}: SkillChipHintProps & {
  /** The skill's `/name`, as the box's words read it. */
  label: string;
  /** Opens the skill's file; none where the place cannot. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const press =
    onOpen === undefined && onClick === undefined
      ? undefined
      : (event: MouseEvent<HTMLElement>) => {
          onOpen?.();
          onClick?.(event);
        };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pill is a word of the box's text, which the keyboard edits rather than presses; its press is the pointer's shortcut to the file, as a sent message's chip button is.
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
    <span
      {...hint}
      className="luke-skill-chip"
      data-opens={onOpen === undefined ? undefined : ""}
      onClick={press}
    >
      {label}
    </span>
  );
}
