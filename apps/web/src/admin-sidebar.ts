/**
 * The admin sidebar's fold, held apart from the component that draws it so the
 * one invariant it rests on can be asserted without a DOM.
 *
 * The rail folds by moving a single property — its own width — over an inner
 * panel that is always laid out at the expanded width and clipped, never by
 * swapping the panel's contents. That is what keeps the fold from flickering:
 * a label is clipped by the moving rail, never removed and re-inserted, so it
 * cannot pop in, wrap, or shove the icon beside it as the width animates, and
 * nothing inside the panel re-flows while the rail moves.
 */

/**
 * The rail's two widths, in pixels, kept here as the single source the drawn
 * `style` reads so the fold's geometry is one value a test can pin rather than
 * a Tailwind class literal it cannot.
 */
export const SIDEBAR_WIDTH = {
  EXPANDED: 224,
  COLLAPSED: 62,
} as const;

export type SidebarWidth = (typeof SIDEBAR_WIDTH)[keyof typeof SIDEBAR_WIDTH];

export function sidebarRailWidth(collapsed: boolean): SidebarWidth {
  return collapsed ? SIDEBAR_WIDTH.COLLAPSED : SIDEBAR_WIDTH.EXPANDED;
}

/**
 * What the fold toggle names for a reader, distinct from the chevron it draws:
 * collapsed it offers to expand, expanded to collapse. The icon carries the
 * direction; this carries the word.
 */
export const SIDEBAR_TOGGLE_LABEL = {
  EXPAND: "Expand sidebar",
  COLLAPSE: "Collapse sidebar",
} as const;

export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? SIDEBAR_TOGGLE_LABEL.EXPAND : SIDEBAR_TOGGLE_LABEL.COLLAPSE;
}

/**
 * The collapsed rail centers each icon by arithmetic rather than by
 * re-centering the row once its label is gone. The inner panel's left inset —
 * its own padding plus each item's — places a 16px icon so its centre sits
 * within a pixel of the collapsed rail's centre; while this holds the label
 * can stay in the flow, clipped by the rail, without the fold needing to
 * restructure the row and flicker.
 */
export const SIDEBAR_ICON_SIZE = 16;
export const SIDEBAR_ITEM_INSET = 22;

export function collapsedIconCenterOffset(): number {
  const iconCenter = SIDEBAR_ITEM_INSET + SIDEBAR_ICON_SIZE / 2;
  const railCenter = SIDEBAR_WIDTH.COLLAPSED / 2;
  return iconCenter - railCenter;
}
