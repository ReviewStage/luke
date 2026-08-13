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
/**
 * Short, and the same whichever state is being left: a panel that lingered
 * after the pointer had gone felt like a different object from a peek that
 * did not. The settings tab opts out of pointer-driven closing entirely,
 * which is what protects someone reaching for the keyboard.
 */
export const LEAVE_DELAY_MS = 110;

export function presentationForMode(mode: WindowMode): PanelPresentation {
  return mode === "expanded" ? PANEL_PRESENTATION.PANEL : PANEL_PRESENTATION.CAPSULE;
}
