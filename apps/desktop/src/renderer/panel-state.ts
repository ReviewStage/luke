/**
 * What the surface is currently drawn as: the window always holds the panel,
 * and a dialog over it is drawn by the dialog rather than by a shape the
 * panel stands down to.
 */
export const PANEL_PRESENTATION = {
  PANEL: "panel",
} as const;

export type PanelPresentation = (typeof PANEL_PRESENTATION)[keyof typeof PANEL_PRESENTATION];
