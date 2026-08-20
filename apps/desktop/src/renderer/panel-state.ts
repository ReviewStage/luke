import type { WindowMode } from "#shared/contracts";

/**
 * What the surface is currently drawn as. The capsule and the peek share one
 * window, so moving between them is pure CSS and never touches the main
 * process; only the panel needs a larger window to unfold into. The slot is
 * drawn in that same expanded window — it is the panel stood down to a single
 * field, so entering it costs no IPC either. The feedback shape is the second
 * thing the panel stands down to: the composer for a note to the founders,
 * asking for one thing the way the slot does and morphing the same way.
 */
export const PANEL_PRESENTATION = {
  CAPSULE: "capsule",
  PEEK: "peek",
  PANEL: "panel",
  SLOT: "slot",
  FEEDBACK: "feedback",
} as const;

export type PanelPresentation = (typeof PANEL_PRESENTATION)[keyof typeof PANEL_PRESENTATION];

/** How an element says which region it is, for whoever is asking. */
export const HIT_REGION_ATTRIBUTE = "data-hit-region";

/** What takes the pointer, named so the test can tell one from another. */
export const HIT_REGION = {
  /** The black shape itself, whatever size it is drawn at. */
  SURFACE: "surface",
  CAPSULE: "capsule",
  PANEL: "panel",
  SLOT: "slot",
  FEEDBACK: "feedback",
} as const;

export type HitRegion = (typeof HIT_REGION)[keyof typeof HIT_REGION];

/** Long enough that sweeping the pointer past the notch does not wake it. */
export const PEEK_ENTER_DELAY_MS = 60;
/**
 * Short, and the same whichever state is being left: a panel that lingered
 * after the pointer had gone felt like a different object from a peek that
 * did not. A key or ask being typed opts the panel out of pointer-driven
 * closing entirely, which is what protects someone reaching for the keyboard.
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

/**
 * Whether a presentation change is the panel standing down to a compact
 * shape. This is the one shrink that lands in states whose surface rules let
 * growth lead, so the renderer marks it and the stylesheet holds the shape
 * back behind the content it is still carrying. The slot and the composer
 * are not it: they keep the expanded window, and the base surface timing
 * already serves their shrink.
 */
export function leavesPanelForCompact(
  previous: PanelPresentation,
  next: PanelPresentation,
): boolean {
  return (
    previous === PANEL_PRESENTATION.PANEL &&
    (next === PANEL_PRESENTATION.CAPSULE || next === PANEL_PRESENTATION.PEEK)
  );
}

/**
 * Whether the collapse mark stands after a presentation change. Leaving the
 * panel for a compact shape raises it; a move between the compact shapes
 * keeps it, because a peek answering a hover mid-collapse is a width
 * retarget on the same journey down from the panel, and dropping the mark
 * there releases the surface from behind the content still riding. Any
 * other shape ends the journey — the panel leads its own growth, and the
 * slot and the composer run on the base timing.
 */
export function collapseMarkAfter(
  previous: PanelPresentation,
  next: PanelPresentation,
  marked: boolean,
): boolean {
  if (leavesPanelForCompact(previous, next)) return true;
  return marked && (next === PANEL_PRESENTATION.CAPSULE || next === PANEL_PRESENTATION.PEEK);
}
