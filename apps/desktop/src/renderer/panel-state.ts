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

/**
 * Short: a panel that lingered after the pointer had gone felt like a
 * different object. A search being typed opts the panel out of pointer-driven
 * closing entirely, which is what protects someone reaching for the keyboard.
 */
export const LEAVE_DELAY_MS = 110;
/**
 * How long the panel stays open around a note it has just sent. Sending from
 * the composer brings the whole panel back to show the thank-you, and the
 * pointer is usually still on the button that was pressed — where it is not,
 * nothing would ever ask the panel to close, so it reads its own answer and
 * then leaves. Sending is the only thing that restores a panel this way:
 * giving up has no answer to show, so what it returns to is left open like
 * any other panel.
 */
export const SETTLE_DELAY_MS = 1_700;
