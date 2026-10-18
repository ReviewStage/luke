import type { ComponentPropsWithRef, ReactNode } from "react";

/**
 * scroll-area.tsx -- the one box that scrolls: a pane's body, a list's column, a page under its bar, each scrolling the axis it names and no other.
 *
 * A screen gets its scrolling here rather than from an `overflow` of its
 * own, because a scroller written by hand scrolls sideways too unless it
 * says otherwise. The area owns:
 *
 * - its axis (`axis`): up and down by default, with nothing scrolling
 *   sideways; sideways alone; or both;
 * - its overscroll, held inside it, so a swipe that reaches its end never
 *   scrolls the page or the pane around it;
 * - how it fills the room its parent gives it (`size`): the rest of a flex
 *   column, or as tall as what it holds, shrinking to the room where that
 *   runs short; and
 * - its edge fade (`fade`): where content runs past an edge something
 *   pinned stands at, it dissolves over the profile's `--luke-scroll-fade`
 *   rather than being sliced there, the start edge alone or both. The fade
 *   eases in over the first stretch of scrolling, so an area at rest at its
 *   start, or one with nothing to scroll, is left whole.
 *
 * Note that it draws no padding and no inner layout of its own: the caller's
 * goes on one element of its own inside the area, as Radix's and shadcn's
 * do, so the scroll bar stays at the area's edge rather than standing in
 * from it by the caller's inset. It takes no class or style; the rest of a
 * div's attributes pass through (a ref, an id, a role and its names, a tab
 * index, key and scroll handlers, `data-*`), so a caller's scroll logic and
 * its accessibility reach the scroller itself.
 */

/** The axes an area scrolls: up and down, with nothing sideways; sideways alone; or both. */
export const SCROLL_AXIS = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
  BOTH: "both",
} as const;

export type ScrollAxis = (typeof SCROLL_AXIS)[keyof typeof SCROLL_AXIS];

/**
 * How an area fills the room its parent gives it: all of it, the rest of a
 * flex column or row, or the whole of a box; or as tall as what it holds,
 * shrinking to the room where that runs short.
 */
export const SCROLL_SIZE = {
  FILL: "fill",
  CONTENT: "content",
} as const;

export type ScrollSize = (typeof SCROLL_SIZE)[keyof typeof SCROLL_SIZE];

/** Which edges of the axis dissolve where content runs past them: none, the start alone, or both. */
export const SCROLL_FADE = {
  NONE: "none",
  START: "start",
  BOTH: "both",
} as const;

export type ScrollFade = (typeof SCROLL_FADE)[keyof typeof SCROLL_FADE];

export type ScrollAreaProps = {
  /** The axis it scrolls; up and down where none is named. */
  axis?: ScrollAxis | undefined;
  /** How it fills its parent's room; all of it where none is named. */
  size?: ScrollSize | undefined;
  /** Which edges fade where content runs past them; none where none is named. */
  fade?: ScrollFade | undefined;
  /** The caller's one element, which holds its padding and its layout. */
  children: ReactNode;
} & Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children" | "dangerouslySetInnerHTML"
>;

/** A box scrolling `axis`, filling its parent's room as `size` says, its edges fading as `fade` says. */
export function ScrollArea({
  axis = SCROLL_AXIS.VERTICAL,
  size = SCROLL_SIZE.FILL,
  fade = SCROLL_FADE.NONE,
  children,
  ...div
}: ScrollAreaProps): React.JSX.Element {
  return (
    <div {...div} className="luke-scroll-area" data-axis={axis} data-size={size} data-fade={fade}>
      {children}
    </div>
  );
}
