import type { WindowMode } from "../shared/contracts";

/**
 * What the surface is currently drawn as. The capsule and the peek share one
 * window, so moving between them is pure CSS and never touches the main
 * process; only the panel needs a larger window to unfold into.
 */
export const PANEL_PRESENTATION = {
  CAPSULE: "capsule",
  PEEK: "peek",
  PANEL: "panel",
} as const;

export type PanelPresentation = (typeof PANEL_PRESENTATION)[keyof typeof PANEL_PRESENTATION];

/** Long enough that sweeping the pointer past the notch does not wake it. */
export const PEEK_ENTER_DELAY_MS = 60;
/** Short: leaving the capsule should feel like letting go of it. */
export const PEEK_LEAVE_DELAY_MS = 110;
/**
 * Generous. The panel is opened deliberately with a click, so it should not
 * vanish the moment the pointer strays off it to reach for something.
 */
export const PANEL_LEAVE_DELAY_MS = 620;

export function presentationForMode(mode: WindowMode): PanelPresentation {
  return mode === "expanded" ? PANEL_PRESENTATION.PANEL : PANEL_PRESENTATION.CAPSULE;
}
