export const SESSION_STATUS = {
  WORKING: "working",
  WAITING: "waiting",
  /**
   * The session stopped on something it cannot get past on its own. Providers
   * report this natively — a Conductor `error`, a Cursor `ERROR` run, a Claude
   * Code `api_error` — and it is kept distinct from `waiting` because the two
   * ask different things of the developer: one wants an answer, the other wants
   * a rescue.
   */
  ERROR: "error",
  COMPLETE: "complete",
  UNKNOWN: "unknown",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/**
 * Where a session's work is actually running. It is not the provider: the same
 * provider can hold a session on this machine and one in a datacentre, and only
 * the session knows which it is. Local is the default, so a session is only
 * reported as remote by an adapter that observed it over the network.
 */
export const SESSION_LOCATION = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

export type SessionLocation = (typeof SESSION_LOCATION)[keyof typeof SESSION_LOCATION];

export const ATTENTION_DISPOSITION = {
  SILENT: "silent",
  SPEAK_DURING_TURN: "speak-during-turn",
  SPEAK_AT_TURN_END: "speak-at-turn-end",
} as const;

export type AttentionDisposition =
  (typeof ATTENTION_DISPOSITION)[keyof typeof ATTENTION_DISPOSITION];

/**
 * A bounded, display-safe result from Luke's attention evaluation. The summary
 * must be a redacted synopsis, never a provider transcript.
 */
export interface AttentionDecision {
  disposition: AttentionDisposition;
  decidedAt: number;
  summary?: string;
}

/**
 * What a control does to the session, at the altitude a surface draws at: a
 * stop ends the turn that is running and is drawn as the stop glyph every chat
 * surface uses, while anything else is a provider-worded action drawn by its
 * label. The adapter says which its control is, because only it knows what the
 * endpoint behind the control means.
 */
export const SESSION_CONTROL_KIND = {
  ACTION: "action",
  STOP: "stop",
} as const;

export type SessionControlKind = (typeof SESSION_CONTROL_KIND)[keyof typeof SESSION_CONTROL_KIND];

/** A provider-defined action that has been explicitly exposed for one session. */
export interface SessionControl {
  id: string;
  label: string;
  /** Absent means a plain action, drawn by its label. */
  kind?: SessionControlKind;
}

/** A stable provider identity and the label that can be shown in the UI. */
export interface SessionProvider {
  id: string;
  displayName: string;
}

/** Identifies a session without conflating identifiers from different providers. */
export interface SessionIdentity {
  providerId: string;
  providerSessionId: string;
}

/**
 * The schemes Luke will hand a session's address to the operating system with:
 * `https` for a provider that keeps the session in its own cloud, and an app
 * scheme for one that registered a handler for its own windows on this machine.
 *
 * A link is the one observed field the surface does not merely draw — it acts on
 * it — and it arrives from provider-owned data like every other field. So the
 * set is fixed by this build and applied where every other bound is applied:
 * an address outside it never reaches a session at all, rather than being
 * checked again wherever something is about to open one.
 */
export const SESSION_LINK_SCHEME = {
  HTTPS: "https:",
  CODEX: "codex:",
  CONDUCTOR: "conductor:",
} as const;

export type SessionLinkScheme = (typeof SESSION_LINK_SCHEME)[keyof typeof SESSION_LINK_SCHEME];

const SESSION_LINK_SCHEMES: ReadonlySet<string> = new Set(Object.values(SESSION_LINK_SCHEME));

/** Whether an address is one Luke may ask the system to open. */
export function isOpenableSessionLink(link: string): boolean {
  try {
    return SESSION_LINK_SCHEMES.has(new URL(link).protocol);
  } catch {
    return false;
  }
}

/**
 * The context that makes one session tellable from another. Every field is
 * optional because no provider reports all of them, and every field is bounded
 * so a row stays a row. Adapters fill in whatever their provider actually
 * knows rather than composing a sentence, which leaves the wording to the
 * surface that renders it and the reasoning to the attention evaluator.
 */
export interface SessionDetail {
  /** What the session is doing right now, such as the tool it is running. */
  activity?: string;
  repository?: string;
  branch?: string;
  model?: string;
  /** Why the session stopped, when it stopped on something it cannot pass. */
  error?: string;
  /**
   * A provider-owned address that opens this session where it lives. Only a
   * provider that can address the session itself reports one: an address that
   * lands near a session rather than on it — its folder, or a fresh chat in the
   * same place — is worse than no address at all, because pressing a row would
   * then do something other than what it said.
   */
  link?: string;
  /** The work the session has published, such as a pull request. */
  change?: string;
}

/**
 * Provider-owned data observed for a session. Provider adapters are responsible
 * for observing without writing provider files, and for bounding every field
 * they report so one session cannot crowd out the rest of the panel.
 */
export interface ProviderSessionObservation {
  providerSessionId: string;
  title: string;
  status: SessionStatus;
  observedAt: number;
  /** Omitted by an adapter that reads sessions off this machine. */
  location?: SessionLocation;
  summary?: string;
  detail?: SessionDetail;
  controls?: readonly SessionControl[];
  /**
   * Set only by an adapter whose provider documents taking a message for this
   * session in its current state, through the provider's own API. Absent means
   * no: a session that cannot be messaged is reported as such rather than
   * offered a control that would have to be improvised.
   */
  canReceiveMessage?: boolean;
}

/**
 * The normalized model shared by observers, attention evaluation, the UI, and
 * any future capability-gated controls.
 */
export interface NormalizedSession extends SessionIdentity {
  provider: SessionProvider;
  title: string;
  status: SessionStatus;
  observedAt: number;
  location: SessionLocation;
  summary?: string;
  detail: SessionDetail;
  controls: readonly SessionControl[];
  /** Whether this session's provider will take a message for it right now. */
  canReceiveMessage: boolean;
  attention: AttentionDecision;
}

export const maximumSessionTitleLength = 160;
export const maximumSessionSummaryLength = 500;
/** One line of context beside a title, not a paragraph. */
export const maximumSessionDetailLength = 120;
/** Long enough for any provider's session address without becoming a payload. */
export const maximumSessionLinkLength = 300;
/** A reply typed into a row, not a document pasted through one. */
export const maximumSessionMessageLength = 4_000;

/**
 * The text of a message on its way to a session, or nothing. Unlike an observed
 * field this one is refused rather than cut when it runs long: a truncated
 * message says something its author did not.
 */
export function sessionMessageText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumSessionMessageLength) return undefined;
  return normalized;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

/**
 * A session's address, or nothing. Unlike every other bounded field this one is
 * dropped rather than cut when it runs long: a truncated address is a different
 * address, and this is the field something is opened from.
 */
function sessionLink(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumSessionLinkLength) return undefined;
  return isOpenableSessionLink(normalized) ? normalized : undefined;
}

function timestamp(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite timestamp`);
  }
  return value;
}

function normalizeStatus(status: SessionStatus): SessionStatus {
  if (!Object.values(SESSION_STATUS).includes(status)) {
    throw new Error(`Unknown session status: ${status}`);
  }
  return status;
}

function normalizeLocation(location: SessionLocation | undefined): SessionLocation {
  if (location === undefined) return SESSION_LOCATION.LOCAL;
  if (!Object.values(SESSION_LOCATION).includes(location)) {
    throw new Error(`Unknown session location: ${location}`);
  }
  return location;
}

function normalizeControls(
  controls: readonly SessionControl[] | undefined,
): readonly SessionControl[] {
  if (!controls) return [];

  const ids = new Set<string>();
  return controls.map((control) => {
    const id = requiredText(control.id, "control id");
    if (ids.has(id)) throw new Error(`Duplicate session control: ${id}`);
    ids.add(id);
    // A kind this build does not know is dropped rather than passed through:
    // the control still works, drawn as a plain action by its label.
    const kind = Object.values(SESSION_CONTROL_KIND).find(
      (candidate) => candidate === control.kind,
    );
    return {
      id,
      label: boundedText(control.label, maximumSessionTitleLength) ?? id,
      ...(kind ? { kind } : {}),
    };
  });
}

/**
 * Bounds every field a provider reported and drops the ones it left empty, so
 * a renderer can treat any present field as worth drawing.
 */
export function normalizeSessionDetail(detail: SessionDetail | undefined): SessionDetail {
  if (!detail) return {};

  const activity = boundedText(detail.activity, maximumSessionDetailLength);
  const repository = boundedText(detail.repository, maximumSessionDetailLength);
  const branch = boundedText(detail.branch, maximumSessionDetailLength);
  const model = boundedText(detail.model, maximumSessionDetailLength);
  const error = boundedText(detail.error, maximumSessionDetailLength);
  const link = sessionLink(detail.link);
  const change = boundedText(detail.change, maximumSessionLinkLength);

  return {
    ...(activity ? { activity } : {}),
    ...(repository ? { repository } : {}),
    ...(branch ? { branch } : {}),
    ...(model ? { model } : {}),
    ...(error ? { error } : {}),
    ...(link ? { link } : {}),
    ...(change ? { change } : {}),
  };
}

/** Normalizes the two-part identity used to locate a session in the registry. */
export function normalizeSessionIdentity(identity: SessionIdentity): SessionIdentity {
  return {
    providerId: requiredText(identity.providerId, "provider id"),
    providerSessionId: requiredText(identity.providerSessionId, "provider session id"),
  };
}

/** Creates the silent default used until an attention evaluator returns a decision. */
export function silentAttention(observedAt: number): AttentionDecision {
  return {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: timestamp(observedAt, "observedAt"),
  };
}

/** Ensures an attention decision is safe to share with the rest of the app. */
export function normalizeAttention(decision: AttentionDecision): AttentionDecision {
  if (!Object.values(ATTENTION_DISPOSITION).includes(decision.disposition)) {
    throw new Error(`Unknown attention disposition: ${decision.disposition}`);
  }
  const summary = boundedText(decision.summary, maximumSessionSummaryLength);
  return {
    disposition: decision.disposition,
    decidedAt: timestamp(decision.decidedAt, "attention decidedAt"),
    ...(summary ? { summary } : {}),
  };
}

/**
 * Normalizes a provider observation without retaining provider-specific shapes.
 * A supplied attention decision is used by the registry when an evaluator has
 * already made one for this session.
 */
export function normalizeSession(
  provider: SessionProvider,
  observation: ProviderSessionObservation,
  attention = silentAttention(observation.observedAt),
): NormalizedSession {
  const { providerId, providerSessionId } = normalizeSessionIdentity({
    providerId: provider.id,
    providerSessionId: observation.providerSessionId,
  });
  const observedAt = timestamp(observation.observedAt, "observedAt");
  const summary = boundedText(observation.summary, maximumSessionSummaryLength);

  return {
    providerId,
    providerSessionId,
    provider: {
      id: providerId,
      displayName: boundedText(provider.displayName, maximumSessionTitleLength) ?? providerId,
    },
    title: boundedText(observation.title, maximumSessionTitleLength) ?? "Untitled session",
    status: normalizeStatus(observation.status),
    observedAt,
    location: normalizeLocation(observation.location),
    ...(summary ? { summary } : {}),
    detail: normalizeSessionDetail(observation.detail),
    controls: normalizeControls(observation.controls),
    // Anything but an explicit yes is a no, so an adapter that has not thought
    // about messaging reports a session that cannot be messaged.
    canReceiveMessage: observation.canReceiveMessage === true,
    attention: normalizeAttention(attention),
  };
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: NormalizedSession, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
