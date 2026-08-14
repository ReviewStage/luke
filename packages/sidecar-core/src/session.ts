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

/** A provider-defined action that has been explicitly exposed for one session. */
export interface SessionControl {
  id: string;
  label: string;
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
 * Who wrote one line of a session's conversation. `TOOL` covers both halves of
 * a call — what the agent asked for and what came back — because the surface
 * treats them the same way: neither is a person or the agent talking.
 */
export const TRANSCRIPT_ROLE = {
  USER: "user",
  AGENT: "agent",
  TOOL: "tool",
} as const;

export type TranscriptRole = (typeof TRANSCRIPT_ROLE)[keyof typeof TRANSCRIPT_ROLE];

/**
 * One line of what a session actually said. This is transcript content — the
 * material every other field on a session is deliberately *about* rather than
 * made of — so it exists only for a user who asked for it, it never reaches an
 * attention evaluator, and it is bounded like everything else here.
 */
export interface SessionTranscriptEntry {
  role: TranscriptRole;
  text: string;
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
   * The newest lines of the session's own conversation, oldest first. Only an
   * adapter the user has turned transcripts on for reports any, so the usual
   * value is nothing at all.
   */
  transcript?: readonly SessionTranscriptEntry[];
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
  attention: AttentionDecision;
  /** Empty unless the user turned transcripts on for the observing adapter. */
  transcript: readonly SessionTranscriptEntry[];
}

export const maximumSessionTitleLength = 160;
export const maximumSessionSummaryLength = 500;
/** One line of context beside a title, not a paragraph. */
export const maximumSessionDetailLength = 120;
/** Long enough for any provider's session address without becoming a payload. */
export const maximumSessionLinkLength = 300;
/**
 * How much of a conversation a session carries. A transcript is kept to the
 * last few exchanges rather than the whole history: what a developer who
 * stepped away needs is the end of it, and everything held here is held in
 * memory for every session at once.
 */
export const maximumTranscriptEntries = 12;
export const maximumTranscriptEntryLength = 400;

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
    return {
      id,
      label: boundedText(control.label, maximumSessionTitleLength) ?? id,
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

/**
 * Bounds a transcript to its newest lines, drops anything empty or unattributed,
 * and leaves the wording exactly as the provider wrote it — this is the one
 * field whose value is the provider's own text rather than a fact about it.
 */
export function normalizeSessionTranscript(
  transcript: readonly SessionTranscriptEntry[] | undefined,
): readonly SessionTranscriptEntry[] {
  if (!transcript) return [];
  const entries: SessionTranscriptEntry[] = [];
  for (const entry of transcript.slice(-maximumTranscriptEntries)) {
    if (!Object.values(TRANSCRIPT_ROLE).includes(entry.role)) continue;
    const text = boundedText(entry.text, maximumTranscriptEntryLength);
    if (text) entries.push({ role: entry.role, text });
  }
  return entries;
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
    attention: normalizeAttention(attention),
    transcript: normalizeSessionTranscript(observation.transcript),
  };
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: NormalizedSession, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
