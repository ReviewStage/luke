/**
 * The provider-independent lifecycle state Luke can present for a coding-agent
 * session. Attention is intentionally modeled separately because it is Luke's
 * decision, not a provider-owned lifecycle state.
 */
export type SessionStatus = "working" | "waiting" | "complete" | "unknown";

/**
 * The three possible outcomes of Luke's bounded attention evaluation.
 */
export type AttentionDisposition = "silent" | "speak-during-turn" | "speak-at-turn-end";

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
 * Provider-owned data observed for a session. Provider adapters are responsible
 * for observing without writing provider files and for supplying only bounded,
 * redacted summaries.
 */
export interface ProviderSessionObservation {
  providerSessionId: string;
  title: string;
  status: SessionStatus;
  observedAt: number;
  summary?: string;
  controls?: readonly SessionControl[];
}

/**
 * The normalized model shared by observers, attention evaluation, the UI, and
 * any future capability-gated controls.
 */
export interface NormalizedSession extends SessionIdentity {
  /** Stable across display-name changes and safe to use as a UI list key. */
  id: string;
  provider: SessionProvider;
  title: string;
  status: SessionStatus;
  observedAt: number;
  summary?: string;
  controls: readonly SessionControl[];
  attention: AttentionDecision;
}

export const maximumSessionTitleLength = 160;
export const maximumSessionSummaryLength = 500;

const knownSessionStatuses: readonly SessionStatus[] = [
  "working",
  "waiting",
  "complete",
  "unknown",
];
const knownAttentionDispositions: readonly AttentionDisposition[] = [
  "silent",
  "speak-during-turn",
  "speak-at-turn-end",
];

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

function timestamp(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite timestamp`);
  }
  return value;
}

function normalizeStatus(status: SessionStatus): SessionStatus {
  if (!knownSessionStatuses.includes(status)) throw new Error(`Unknown session status: ${status}`);
  return status;
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

/** Converts a provider-local identity into a collision-free, stable session key. */
export function sessionKey(identity: SessionIdentity): string {
  const providerId = requiredText(identity.providerId, "provider id");
  const providerSessionId = requiredText(identity.providerSessionId, "provider session id");
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(providerSessionId)}`;
}

/** Creates the silent default used until an attention evaluator returns a decision. */
export function silentAttention(observedAt: number): AttentionDecision {
  return {
    disposition: "silent",
    decidedAt: timestamp(observedAt, "observedAt"),
  };
}

/** Ensures an attention decision is safe to share with the rest of the app. */
export function normalizeAttention(decision: AttentionDecision): AttentionDecision {
  if (!knownAttentionDispositions.includes(decision.disposition)) {
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
  const providerId = requiredText(provider.id, "provider id");
  const providerSessionId = requiredText(observation.providerSessionId, "provider session id");
  const observedAt = timestamp(observation.observedAt, "observedAt");
  const summary = boundedText(observation.summary, maximumSessionSummaryLength);

  return {
    id: sessionKey({ providerId, providerSessionId }),
    providerId,
    providerSessionId,
    provider: {
      id: providerId,
      displayName: boundedText(provider.displayName, maximumSessionTitleLength) ?? providerId,
    },
    title: boundedText(observation.title, maximumSessionTitleLength) ?? "Untitled session",
    status: normalizeStatus(observation.status),
    observedAt,
    ...(summary ? { summary } : {}),
    controls: normalizeControls(observation.controls),
    attention: normalizeAttention(attention),
  };
}

/** Returns whether a provider explicitly exposed a given control for a session. */
export function supportsSessionControl(session: NormalizedSession, controlId: string): boolean {
  return session.controls.some((control) => control.id === controlId);
}
