import type { Session, SessionFields } from "./session-shape.js";

/**
 * Every kind of act Luke can carry against a session or the workspace around
 * it. It is the one vocabulary: an observation advertises the kinds a
 * provider documents for a session now, and validation admits an ask only
 * against a kind that advertisement holds, so a name cannot be spelled one
 * way where an act is offered and another where it is checked.
 */
export const ACT_KIND = {
  MESSAGE: "message",
  CONTROL: "control",
  ADD_AGENT: "add-agent",
  RENAME_SESSION: "rename-session",
  RENAME_WORKSPACE: "rename-workspace",
  OPEN: "open",
  CREATE_WORKSPACE: "create-workspace",
} as const;

export type ActKind = (typeof ACT_KIND)[keyof typeof ACT_KIND];

/**
 * The five kinds an observation can advertise. The other two are not a
 * session's to offer: an open follows the address the observation already
 * reported and needs no endpoint at all, and a creation is validated against
 * the projects a provider listed rather than against any one session.
 */
export type AdvertisedActKind =
  | typeof ACT_KIND.MESSAGE
  | typeof ACT_KIND.CONTROL
  | typeof ACT_KIND.ADD_AGENT
  | typeof ACT_KIND.RENAME_SESSION
  | typeof ACT_KIND.RENAME_WORKSPACE;

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

/** The provider takes a message for this session in its current state. */
export interface AdvertisedMessage {
  kind: typeof ACT_KIND.MESSAGE;
}

/** One provider-defined action the provider exposed for this session. */
export interface AdvertisedControl {
  kind: typeof ACT_KIND.CONTROL;
  id: string;
  label: string;
  /** Absent means a plain action, drawn by its label. */
  controlKind?: SessionControlKind;
  /**
   * The provider-owned identifier of the thing this control acts on, when that
   * is not the session itself — the run a stop stops, or the workspace an
   * archive files away.
   */
  target?: string;
}

/**
 * The kinds of agent the provider documents starting alongside this session,
 * named exactly as its creation endpoint takes them, and the place a new one
 * lands when that is narrower than the session itself.
 */
export interface AdvertisedAddAgent {
  kind: typeof ACT_KIND.ADD_AGENT;
  agents: readonly string[];
  target?: string;
}

/** The provider documents renaming this session itself — the chat's own name. */
export interface AdvertisedRenameSession {
  kind: typeof ACT_KIND.RENAME_SESSION;
}

/**
 * The provider documents renaming the workspace around this session, whose
 * own identifier is what the rename lands on.
 */
export interface AdvertisedRenameWorkspace {
  kind: typeof ACT_KIND.RENAME_WORKSPACE;
  target: string;
}

/**
 * One act a session's provider documents for it now. Each entry carries what
 * that act needs and nothing else, so a target no act uses cannot ride along
 * unread, and every entry is replaced whole by the next observation.
 */
export type AdvertisedAct =
  | AdvertisedMessage
  | AdvertisedControl
  | AdvertisedAddAgent
  | AdvertisedRenameSession
  | AdvertisedRenameWorkspace;

export type AdvertisedActOf<Kind extends AdvertisedActKind> = Extract<
  AdvertisedAct,
  { kind: Kind }
>;

/** The advertisement a normalized session holds for one kind, or nothing. */
export function advertisedActFor<Kind extends AdvertisedActKind>(
  session: Pick<Session, "advertises">,
  kind: Kind,
): AdvertisedActOf<Kind> | undefined {
  return observedActFor(session, kind);
}

/**
 * The same read over an observation, whose advertisement has not been
 * normalized yet and may be absent altogether.
 */
export function observedActFor<Kind extends AdvertisedActKind>(
  fields: Pick<SessionFields, "advertises">,
  kind: Kind,
): AdvertisedActOf<Kind> | undefined {
  return fields.advertises?.find((act): act is AdvertisedActOf<Kind> => act.kind === kind);
}

/** Every control a session advertises, in the order its adapter listed them. */
export function advertisedControls(
  session: Pick<Session, "advertises">,
): readonly AdvertisedControl[] {
  return session.advertises.filter(
    (act): act is AdvertisedControl => act.kind === ACT_KIND.CONTROL,
  );
}

/** The control a session advertises under one id, or nothing. */
export function advertisedControl(
  session: Pick<Session, "advertises">,
  controlId: string,
): AdvertisedControl | undefined {
  return advertisedControls(session).find((control) => control.id === controlId);
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: Session, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
