import type * as React from "react";
import { cn } from "../cn.js";

/**
 * scroll-area.tsx -- shadcn/ui's scroll area (style `base-nova`), vendored as the one native scroller it wraps, without Base UI's parts.
 *
 * shadcn's source draws a Base UI `ScrollArea.Root` around a
 * `ScrollArea.Viewport` that scrolls, with Base UI's own scroll bar, thumb,
 * and corner over it. Luke keeps the browser's own scrolling and scroll bar,
 * so the vendored component is shadcn's `ScrollArea` with its root and
 * viewport folded into the one `<div>` that scrolls, and none of Base UI. Its
 * local changes, each because Base UI's part would change what a caller sees
 * or reaches:
 *
 * - No `ScrollArea.Root`: it is a second box around the scroller, so a
 *   caller's ref, id, role, and handlers would no longer land on the element
 *   that scrolls, and the panel's rules and lookups for an area that is a
 *   direct child of its pane (`.whole-file > …`, `.pull-request-view > …`)
 *   would miss it. Its `relative` is dropped with it, because a scroller that
 *   positions what it holds would carry along everything absolutely placed
 *   over it (a log's way back to its newest line).
 * - No `ScrollArea.Viewport`: it sets `overflow: scroll` inline on both axes,
 *   which no class outranks, so an area could no longer scroll one axis and
 *   hold the other; it hides the system's scroll bar (its
 *   `base-ui-disable-scrollbar` style, injected into the page) for its own;
 *   it sets a `tabIndex` of its own on the area, which only a caller sets
 *   today; and it measures the area on every scroll and resize to
 *   place its thumb.
 * - No `ScrollBar`, thumb, or corner: the Mac's overlay scroll bar and its
 *   momentum and the browser's on the web are what an area scrolls with.
 * - The viewport's `rounded-[inherit]`, `size-full`, colour transition, and
 *   outline and ring utilities are dropped: the area draws nothing of its
 *   own, sizes as its caller's `size` says, and leaves the keyboard's ring to
 *   the window (`shadcn-focus.test.ts`).
 *
 * `@luke/ui`'s `ScrollArea` (`components/scroll-area/scroll-area.tsx`) is
 * what an app draws, and its sheet keeps the edge fade; this is its inside.
 */

function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("box-border min-h-0 min-w-0", className)} {...props}>
      {children}
    </div>
  );
}

export { ScrollArea };
