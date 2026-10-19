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
 * - its overscroll (`overscroll`): held inside it by default, so a swipe
 *   that reaches its end never scrolls the page or the pane around it; or
 *   handed on, for a short box inside something that scrolls (a tool
 *   call's block in a transcript, a grid on a page), so a swipe past its
 *   end, or up and down over a box that scrolls only sideways, moves what
 *   is around it as it would if the box were not there;
 * - how it fills the room its parent gives it (`size`): the rest of a flex
 *   column, or as tall as what it holds, shrinking to the room where that
 *   runs short; and
 * - its edge fade (`fade`): where content runs past an edge something
 *   pinned stands at, it dissolves over the profile's `--luke-scroll-fade`
 *   rather than being sliced there, the start edge alone or both. The fade
 *   eases in over the first stretch of scrolling, so an area at rest at its
 *   start, or one with nothing to scroll, is left whole. Where a band stands
 *   stuck at the area's start (`fadeInset`), a checkpoint's, the start fade
 *   begins beneath it, so the band stands whole; and
 * - its gutter (`gutter`): where the system draws a scroll bar that takes
 *   room, a stable gutter keeps that room while nothing scrolls yet, so what
 *   the area holds does not shift sideways the moment it first overflows.
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

/**
 * Where an up-and-down area's start fade begins: at its edge, or beneath a
 * band of the profile's `--luke-scroll-band` stuck at its start, which
 * stands whole while what scrolls under it dissolves just below it. What
 * the keys move to clears both.
 */
export const SCROLL_FADE_INSET = {
  NONE: "none",
  BAND: "band",
} as const;

export type ScrollFadeInset = (typeof SCROLL_FADE_INSET)[keyof typeof SCROLL_FADE_INSET];

/**
 * What a swipe that reaches the area's end does: stops there, or carries on
 * into whatever scrolls around the area, as it does past a box that does
 * not scroll.
 */
export const SCROLL_OVERSCROLL = {
  CONTAIN: "contain",
  CHAIN: "chain",
} as const;

export type ScrollOverscroll = (typeof SCROLL_OVERSCROLL)[keyof typeof SCROLL_OVERSCROLL];

/** Whether the room a scroll bar takes is kept while nothing scrolls: only once it does, or always. */
export const SCROLL_GUTTER = {
  AUTO: "auto",
  STABLE: "stable",
} as const;

export type ScrollGutter = (typeof SCROLL_GUTTER)[keyof typeof SCROLL_GUTTER];

export type ScrollAreaProps = {
  /** The axis it scrolls; up and down where none is named. */
  axis?: ScrollAxis | undefined;
  /** How it fills its parent's room; all of it where none is named. */
  size?: ScrollSize | undefined;
  /** Which edges fade where content runs past them; none where none is named. */
  fade?: ScrollFade | undefined;
  /** Where the start fade begins; at the edge where none is named. */
  fadeInset?: ScrollFadeInset | undefined;
  /** Whether the scroll bar's room is kept while nothing scrolls; only once it does where none is named. */
  gutter?: ScrollGutter | undefined;
  /** What a swipe past its end does; stops there where none is named. */
  overscroll?: ScrollOverscroll | undefined;
  /** The caller's one element, which holds its padding and its layout. */
  children: ReactNode;
} & Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children" | "dangerouslySetInnerHTML"
>;

/** A box scrolling `axis`, filling its parent's room as `size` says, its edges fading as `fade` and `fadeInset` say, a swipe past its end stopping or handed on as `overscroll` says. */
export function ScrollArea({
  axis = SCROLL_AXIS.VERTICAL,
  size = SCROLL_SIZE.FILL,
  fade = SCROLL_FADE.NONE,
  fadeInset = SCROLL_FADE_INSET.NONE,
  gutter = SCROLL_GUTTER.AUTO,
  overscroll = SCROLL_OVERSCROLL.CONTAIN,
  children,
  ...div
}: ScrollAreaProps): React.JSX.Element {
  return (
    <div
      {...div}
      className="luke-scroll-area"
      data-axis={axis}
      data-size={size}
      data-fade={fade}
      data-fade-inset={fadeInset}
      data-gutter={gutter}
      data-overscroll={overscroll}
    >
      {children}
    </div>
  );
}
