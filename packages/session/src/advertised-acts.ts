import type { Session } from "./session-shape.js";

/**
 * What a control does to the session, at the altitude a surface draws at: a
 * stop ends the turn that is running and is drawn as the stop glyph every chat
 * surface uses, an archive files the settled thing away — whether the provider
 * scopes that to the session, the agent, or the whole workspace — and anything
 * else is a provider-worded action drawn by its label. The adapter says which
 * its control is, because only it knows what the endpoint behind the control
 * means; a surface that keyed on the id or the label instead would be reading
 * the provider's own words as a contract they never made.
 */
export const SESSION_CONTROL_KIND = {
  ACTION: "action",
  ARCHIVE: "archive",
  STOP: "stop",
} as const;

export type SessionControlKind = (typeof SESSION_CONTROL_KIND)[keyof typeof SESSION_CONTROL_KIND];

/** A provider-defined action that has been explicitly exposed for one session. */
export interface SessionControl {
  id: string;
  label: string;
  /** Absent means a plain action, drawn by its label. */
  kind?: SessionControlKind;
  /**
   * The provider-owned identifier of the thing this control acts on, when that
   * is not the session itself — the run a stop stops, or the workspace an
   * archive files away. It rides the advertisement so it is replaced with
   * every observation and can never outlive the snapshot that promised it,
   * the way state an adapter kept on the side could.
   */
  target?: string;
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: Session, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
