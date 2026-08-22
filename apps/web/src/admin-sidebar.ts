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
 * Each row leads with an icon slot exactly the collapsed rail's width. That one
 * choice carries both halves of a clean fold: the icon centred in the slot sits
 * on the rail's own centre, and the label that follows the slot begins at the
 * rail's edge — so when the rail is collapsed the label starts past the clip
 * and no fragment of it shows, without the label ever leaving the flow (which
 * is what would re-flow the row and flicker). A slot narrower than the rail
 * would leave a sliver of the next label inside it; a wider one would push the
 * icon off centre. Tying it to the collapsed width keeps both true at once.
 */
export const SIDEBAR_ICON_SLOT = SIDEBAR_WIDTH.COLLAPSED;

export function collapsedIconCenterOffset(): number {
  return SIDEBAR_ICON_SLOT / 2 - SIDEBAR_WIDTH.COLLAPSED / 2;
}

/**
 * Where a label begins, measured from the rail's left edge: the slot's far
 * edge. It must be at least the collapsed width so the collapsed rail clips the
 * label entirely rather than revealing its first characters.
 */
export function labelStartOffset(): number {
  return SIDEBAR_ICON_SLOT;
}

/**
 * The hover and active fill cannot be the row's own background: the row is
 * laid out at the expanded width and clipped by the rail, so its background
 * would be sliced mid-pill by the moving clip edge. Each row instead layers a
 * pill of its own, inset by this margin from the rail's left edge and sized by
 * `sidebarPillWidth`, whose width moves between the same two endpoints as the
 * rail's under the same transition. The two width deltas are therefore equal,
 * which is what keeps the pill's rounded right end exactly this margin inside
 * the clip edge at every intermediate width, not only at rest.
 */
export const SIDEBAR_PILL_INSET = 8;

export function sidebarPillWidth(collapsed: boolean): number {
  return sidebarRailWidth(collapsed) - SIDEBAR_PILL_INSET * 2;
}
