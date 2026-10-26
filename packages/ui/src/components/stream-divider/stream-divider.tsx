import { createElement, type ReactNode, type Ref } from "react";

/**
 * stream-divider.tsx -- a line across a stream of messages that says where it stands: a day begins, or what is new to the reader begins.
 *
 * A day's divider (`DAY`) says the day in the muted ink between two
 * hairlines, as a channel's stream says Today or Yesterday. The New line
 * (`NEW`) leads with its word in the accent's ink and runs an accent rule
 * to the stream's end, before the first message the reader has not seen.
 * It stands as a list's item (`as`) where the stream is a list, and takes a
 * ref, for an owner that scrolls the stream to it.
 */

/** Which line it is. */
export const STREAM_DIVIDER = {
  DAY: "day",
  NEW: "new",
} as const;

export type StreamDivider = (typeof STREAM_DIVIDER)[keyof typeof STREAM_DIVIDER];

/** The element it stands as. */
export const STREAM_DIVIDER_ELEMENT = {
  DIV: "div",
  LI: "li",
} as const;

export type StreamDividerElement =
  (typeof STREAM_DIVIDER_ELEMENT)[keyof typeof STREAM_DIVIDER_ELEMENT];

const LOOK = {
  [STREAM_DIVIDER.DAY]:
    "luke-stream-divider my-luke-8 flex items-center gap-control-gap text-caption-inline text-muted-foreground before:flex-1 before:border-t before:border-border before:content-[''] after:flex-1 after:border-t after:border-border after:content-['']",
  [STREAM_DIVIDER.NEW]:
    "luke-stream-divider my-control-gap flex scroll-mt-luke-16 items-center gap-control-gap text-caption-inline font-luke-semibold text-accent-ink before:flex-1 before:border-t before:border-accent-fill before:content-['']",
} as const satisfies Record<StreamDivider, string>;

/** One divider: `kind`'s line, saying `children`. */
export function StreamDivider({
  kind,
  as = STREAM_DIVIDER_ELEMENT.DIV,
  ref,
  children,
}: {
  kind: StreamDivider;
  as?: StreamDividerElement;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return createElement(as, { ref, className: LOOK[kind], "data-kind": kind }, children);
}
