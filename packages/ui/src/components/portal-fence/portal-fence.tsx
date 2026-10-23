import type { ReactNode, SyntheticEvent } from "react";

/**
 * portal-fence.tsx -- a fence around what is drawn in a portal, so its presses and keys stay inside rather than reaching the tree that drew it.
 *
 * React carries a portal's events up the tree it was drawn in, not the
 * page's, so a viewer opened over the window from inside a section that
 * opens to be edited at a press, or steps its blocks at an arrow, would do
 * both. The fence stops each press and key at itself. It takes nothing of
 * its own, lays nothing out (`display: contents`), and plays no pulse: the
 * controls inside it are the presses.
 */

/** Stops what the fence holds took from going further up the tree. */
function stopped(event: SyntheticEvent): void {
  event.stopPropagation();
}

/** What `children` take stays theirs. */
export function PortalFence({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the fence takes nothing itself; it keeps what the controls it holds took from reaching the tree around it.
    <span
      className="luke-portal-fence"
      onClick={stopped}
      onKeyDown={stopped}
      onPointerDown={stopped}
      onMouseDown={stopped}
    >
      {children}
    </span>
  );
}
