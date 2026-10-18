import { PopoverPanel as SharedPopoverPanel } from "@luke/ui";
import type { ComponentProps } from "react";
import { Tooltip } from "./tooltip";

/**
 * popover-panel.tsx -- the panel a button opens inside its anchored popover, drawn with `@luke/ui`'s, its × named by the window's pill.
 *
 * The panel, its focus, its Escape, and its leaving are the shared one's.
 * What is the window's own is the hint over its ×: the window's pill, on
 * its wait and warm spell (`tooltip.tsx`).
 */

/** A hung panel, its × under the window's pill. */
export function PopoverPanel(
  props: Omit<ComponentProps<typeof SharedPopoverPanel>, "hint">,
): React.JSX.Element {
  return <SharedPopoverPanel {...props} hint={Tooltip} />;
}
