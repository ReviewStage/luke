import { createElement, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * keep-focus.tsx -- a box a press on leaves the focus where it stood, as a menu's heading leaves the caret in the editor whose keys steer it.
 *
 * It takes no press: a press within it still reaches the controls it holds,
 * and only the focus the press would move, onto a control or off the
 * caret, stays where it was. `WHOLE` keeps it at a press anywhere in the
 * box, its words included, which selects nothing either; `CONTROLS` keeps
 * it only at a press on a control, so its words can still be selected, as
 * a call's floating card keeps its next drag from finding a button holding
 * the focus. Its owner names, places, and draws it by its own class.
 */

/** Which presses in the box leave the focus where it stood. */
export const KEEP_FOCUS = {
  /** A press anywhere in it. */
  WHOLE: "whole",
  /** A press on a button in it alone. */
  CONTROLS: "controls",
  /** None, for a box that keeps the focus only where it stands in some places. */
  NONE: "none",
} as const;

export type KeepFocusScope = (typeof KEEP_FOCUS)[keyof typeof KEEP_FOCUS];

/** The elements a focus keeper may be, by the box it is. */
export const KEEP_FOCUS_ELEMENT = {
  DIV: "div",
  SECTION: "section",
} as const;

export type KeepFocusElement = (typeof KEEP_FOCUS_ELEMENT)[keyof typeof KEEP_FOCUS_ELEMENT];

/** Leaves the focus where it stood at a press on any part of the box. */
function keepWhole(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/** Leaves the focus where it stood at a press on a button in the box. */
function keepOnControls(event: MouseEvent<HTMLElement>): void {
  if (event.target instanceof Element && event.target.closest("button") !== null) {
    event.preventDefault();
  }
}

/** What a press in the box does to the focus, by the scope it keeps it across. */
const KEEPER = {
  [KEEP_FOCUS.WHOLE]: keepWhole,
  [KEEP_FOCUS.CONTROLS]: keepOnControls,
  [KEEP_FOCUS.NONE]: undefined,
} as const satisfies Record<KeepFocusScope, ((event: MouseEvent<HTMLElement>) => void) | undefined>;

/** A box whose presses leave the focus where it stood, across `scope`. */
export function KeepFocus({
  as: Element = KEEP_FOCUS_ELEMENT.DIV,
  scope = KEEP_FOCUS.WHOLE,
  className,
  children,
  ...rest
}: Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "onClick" | "onPointerDown" | "onMouseDown" | "role"
> & {
  as?: KeepFocusElement;
  /** Which presses keep the focus. */
  scope?: KeepFocusScope;
  /** The owner's own class, which names, places, and draws it. */
  className?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const keep = KEEPER[scope];
  return createElement(
    Element,
    {
      ...rest,
      className: className === undefined ? "luke-keep-focus" : `luke-keep-focus ${className}`,
      onMouseDown: keep,
    },
    children,
  );
}
