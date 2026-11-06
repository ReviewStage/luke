import type { ComponentPropsWithRef, ReactNode } from "react";
import { ScrollArea as ShadcnScrollArea } from "../../shadcn/scroll-area.js";

export const SCROLL_AXIS = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
  BOTH: "both",
} as const;

export type ScrollAxis = (typeof SCROLL_AXIS)[keyof typeof SCROLL_AXIS];

export const SCROLL_SIZE = {
  FILL: "fill",
  CONTENT: "content",
} as const;

export type ScrollSize = (typeof SCROLL_SIZE)[keyof typeof SCROLL_SIZE];

export const SCROLL_FADE = {
  NONE: "none",
  START: "start",
  BOTH: "both",
} as const;

export type ScrollFade = (typeof SCROLL_FADE)[keyof typeof SCROLL_FADE];

export const SCROLL_FADE_INSET = {
  NONE: "none",
  BAND: "band",
} as const;

export type ScrollFadeInset = (typeof SCROLL_FADE_INSET)[keyof typeof SCROLL_FADE_INSET];

export const SCROLL_OVERSCROLL = {
  CONTAIN: "contain",
  CHAIN: "chain",
} as const;

export type ScrollOverscroll = (typeof SCROLL_OVERSCROLL)[keyof typeof SCROLL_OVERSCROLL];

export const SCROLL_GUTTER = {
  AUTO: "auto",
  STABLE: "stable",
} as const;

export type ScrollGutter = (typeof SCROLL_GUTTER)[keyof typeof SCROLL_GUTTER];

export type ScrollAreaProps = {
  axis?: ScrollAxis | undefined;
  size?: ScrollSize | undefined;
  fade?: ScrollFade | undefined;
  fadeInset?: ScrollFadeInset | undefined;
  gutter?: ScrollGutter | undefined;
  overscroll?: ScrollOverscroll | undefined;
  children: ReactNode;
} & Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children" | "dangerouslySetInnerHTML"
>;

const SIZE_CLASS = {
  [SCROLL_SIZE.FILL]: "flex-1 block-full",
  [SCROLL_SIZE.CONTENT]: "flex-initial max-block-full",
} as const satisfies Record<ScrollSize, string>;

const OVERSCROLL_CLASS = {
  [SCROLL_OVERSCROLL.CONTAIN]: "overscroll-contain",
  [SCROLL_OVERSCROLL.CHAIN]: "",
} as const satisfies Record<ScrollOverscroll, string>;

const GUTTER_CLASS = {
  [SCROLL_GUTTER.AUTO]: "",
  [SCROLL_GUTTER.STABLE]: "scrollbar-gutter-stable",
} as const satisfies Record<ScrollGutter, string>;

export function scrollFadeMarks(
  fade: ScrollFade,
  axis: ScrollAxis = SCROLL_AXIS.VERTICAL,
): {
  className: string;
  "data-axis": ScrollAxis;
  "data-fade": ScrollFade;
} {
  return { className: "ui-scroll-area", "data-axis": axis, "data-fade": fade };
}

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
    <ShadcnScrollArea
      {...div}
      className={`ui-scroll-area ${SIZE_CLASS[size]} ${OVERSCROLL_CLASS[overscroll]} ${GUTTER_CLASS[gutter]}`}
      data-axis={axis}
      data-size={size}
      data-fade={fade}
      data-fade-inset={fadeInset}
      data-gutter={gutter}
      data-overscroll={overscroll}
    >
      {children}
    </ShadcnScrollArea>
  );
}
