/**
 * What the surface is currently drawn as. The window always holds the panel;
 * the feedback shape is the panel stood down to the composer for a note to
 * the founders, drawn in the same window, so entering it costs no IPC.
 */
export const PANEL_PRESENTATION = {
  PANEL: "panel",
  FEEDBACK: "feedback",
} as const;

export type PanelPresentation = (typeof PANEL_PRESENTATION)[keyof typeof PANEL_PRESENTATION];
