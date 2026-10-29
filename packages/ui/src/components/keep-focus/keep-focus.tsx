import { createElement, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * keep-focus.tsx -- a box a press on leaves the focus where it stood, as a menu's heading leaves the caret in the editor whose keys steer it.
 *
 * It takes no press: a press within it still reaches the controls it holds,
 * and only the focus the press would move, onto a control or off the
 * caret, stays where it was, at a press anywhere in the box, its words
 * included, which selects nothing either. Its owner names, places, and
 * draws it by its own class.
 */

/** Leaves the focus where it stood at a press on any part of the box. */
function keepFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/** A box whose presses leave the focus where it stood. */
export function KeepFocus({
  className,
  children,
  ...rest
}: Omit<
  HTMLAttributes<HTMLDivElement>,
  "className" | "onClick" | "onPointerDown" | "onMouseDown" | "role"
> & {
  /** The owner's own class, which names, places, and draws it. */
  className?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return createElement(
    "div",
    {
      ...rest,
      className: className === undefined ? "luke-keep-focus" : `luke-keep-focus ${className}`,
      onMouseDown: keepFocus,
    },
    children,
  );
}
