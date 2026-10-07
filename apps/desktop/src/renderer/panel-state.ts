import type { WindowMode } from "#shared/messages/session";

/**
 * What the surface is currently drawn as. The window always holds the panel;
 * the slot is the panel stood down to a single field, drawn in the same
 * window, so entering it costs no IPC. The feedback shape is the second thing
 * the panel stands down to: the composer for a note to the founders, asking
 * for one thing the way the slot does and morphing the same way. The capsule
 * is the pose the introduction's takeover lands in.
 */
export const PANEL_PRESENTATION = {
  CAPSULE: "capsule",
  PANEL: "panel",
  SLOT: "slot",
  FEEDBACK: "feedback",
} as const;

export type PanelPresentation = (typeof PANEL_PRESENTATION)[keyof typeof PANEL_PRESENTATION];

/** What takes the pointer, named so the test can tell one from another. */
export const HIT_REGION = {
  /** The black shape itself, whatever size it is drawn at. */
  SURFACE: "surface",
  CAPSULE: "capsule",
  PANEL: "panel",
  SLOT: "slot",
  FEEDBACK: "feedback",
} as const;

/**
 * Short: a panel that lingered after the pointer had gone felt like a
 * different object. A key or ask being typed opts the panel out of
 * pointer-driven closing entirely, which is what protects someone reaching for
 * the keyboard.
 */
export const LEAVE_DELAY_MS = 110;
/**
 * How long the panel stays open around a credential it has just taken. Saving
 * from the slot brings the whole panel back to show the provider connected, and
 * the pointer is usually still on the button that was pressed — where it is not,
 * nothing would ever ask the panel to close, so it reads its own answer and then
 * leaves. Saving is the only thing that restores a panel this way: giving up has
 * no answer to show, so what it returns to is left open like any other panel.
 */
export const SETTLE_DELAY_MS = 1_700;

export function presentationForMode(mode: WindowMode): PanelPresentation {
  return mode === "expanded" ? PANEL_PRESENTATION.PANEL : PANEL_PRESENTATION.CAPSULE;
}
