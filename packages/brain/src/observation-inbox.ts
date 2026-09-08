import type { Session, SessionIdentity } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  type ActResultStatus,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import {
  BRAIN_WAKE_KIND,
  type BrainTranscriptDelta,
  type BrainWakeEvent,
  type BrainWakeKind,
} from "./wake-events.js";

/**
 * The durable observation inbox. An observation — a provider's hook, or the
 * roster look's edge for a session — is captured before any turn is
 * scheduled: what the session's transcript gained since the capture cursor
 * is read, the entry and the advanced capture cursor are written in one
 * save, and only then is a turn opened. A turn consumes the entries it opens
 * with at its checkpoint boundary, and the consumed cursor moves there and
 * only there; so a throttled or failed inference leaves every entry standing
 * for the next turn, a crash between capture and run loses nothing and reads
 * nothing twice, and a launch finds what was captured and runs it. The
 * capture cursor and the consumed cursor are two cursors on purpose: the one
 * says what has been written down, the other what a model has read.
 */
export interface BrainObservationEntry {
  /** Minted by the host at capture; consumption names entries by it. */
  readonly id: string;
  readonly kind: BrainWakeKind;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly hookEvent?: string;
  /** When the observation happened, as the wake said. */
  readonly atMs: number;
  readonly capturedAt: number;
  /** The session as the roster showed it at capture, in the fields the turn's opening renders. */
  readonly session?: WireRecord;
  readonly delta?: BrainTranscriptDelta;
  /** The capture cursor after this entry's read; consumption moves the consumed cursor here. */
  readonly cursor?: string;
}

const WAKE_KIND_LIST: readonly BrainWakeKind[] = Object.values(BRAIN_WAKE_KIND);

function isWakeKind(value: UnparsedWireValue): value is BrainWakeKind {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && WAKE_KIND_LIST.includes(value as BrainWakeKind);
}

function instant(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

const ACT_RESULT_STATUS_LIST: readonly ActResultStatus[] = Object.values(ACT_RESULT_STATUS);

function isActResultStatus(value: UnparsedWireValue): value is ActResultStatus {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && ACT_RESULT_STATUS_LIST.includes(value as ActResultStatus);
}

function deltaFromWire(value: UnparsedWireValue): BrainTranscriptDelta | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isWireString(value.text) || !isWireBoolean(value.truncated)) return null;
  if (!isActResultStatus(value.status)) return null;
  return { text: value.text, truncated: value.truncated, status: value.status };
}

/** Reads a stored entry, or nothing for one this build cannot vouch for. */
export function brainObservationEntryFromWire(
  value: UnparsedWireValue,
): BrainObservationEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.id) || value.id.length === 0 || !isWakeKind(value.kind)) return undefined;
  if (!isWireString(value.providerId) || !isWireString(value.providerSessionId)) return undefined;
  if (!instant(value.atMs) || !instant(value.capturedAt)) return undefined;
  if (value.hookEvent !== undefined && !isWireString(value.hookEvent)) return undefined;
  if (value.session !== undefined && !isRecord(value.session)) return undefined;
  if (value.cursor !== undefined && !isWireString(value.cursor)) return undefined;
  const delta = deltaFromWire(value.delta);
  if (delta === null) return undefined;
  return {
    id: value.id,
    kind: value.kind,
    providerId: value.providerId,
    providerSessionId: value.providerSessionId,
    ...(value.hookEvent !== undefined ? { hookEvent: value.hookEvent } : undefined),
    atMs: value.atMs,
    capturedAt: value.capturedAt,
    ...(value.session !== undefined ? { session: value.session } : undefined),
    ...(delta !== undefined ? { delta } : undefined),
    ...(value.cursor !== undefined ? { cursor: value.cursor } : undefined),
  };
}

/** The session fields an entry keeps: what the turn's opening renders, and never a transcript. */
export function sessionSummary(session: Session): WireRecord {
  return {
    provider_name: session.provider.displayName,
    title: session.title,
    status: session.status,
    ...(session.workspace?.name ? { workspace: session.workspace.name } : undefined),
    ...(session.detail.error ? { error: session.detail.error } : undefined),
    ...(session.detail.activity ? { activity: session.detail.activity } : undefined),
    ...(session.detail.branch ? { branch: session.detail.branch } : undefined),
    updated_at: new Date(session.lastActivityAt).toISOString(),
  };
}

/** A wake as an entry, once its delta has been read from the capture cursor. */
export function entryFromEvent(
  event: BrainWakeEvent,
  id: string,
  capturedAt: number,
  delta: BrainTranscriptDelta | undefined,
  cursor: string | undefined,
): BrainObservationEntry {
  return {
    id,
    kind: event.kind,
    providerId: event.identity.providerId,
    providerSessionId: event.identity.providerSessionId,
    ...(event.hookEvent !== undefined ? { hookEvent: event.hookEvent } : undefined),
    atMs: event.atMs,
    capturedAt,
    ...(event.session
      ? { session: sessionSummary(event.session) }
      : event.sessionSummary
        ? { session: event.sessionSummary }
        : undefined),
    ...(delta ? { delta } : undefined),
    ...(cursor !== undefined ? { cursor } : undefined),
  };
}

/** An entry as the turn opens with it: the delta already attached, so nothing is read again. */
export function eventFromEntry(entry: BrainObservationEntry): BrainWakeEvent {
  const identity: SessionIdentity = {
    providerId: entry.providerId,
    providerSessionId: entry.providerSessionId,
  };
  return {
    kind: entry.kind,
    identity,
    ...(entry.hookEvent !== undefined ? { hookEvent: entry.hookEvent } : undefined),
    ...(entry.session ? { sessionSummary: entry.session } : undefined),
    transcriptDelta: entry.delta ?? {
      text: "",
      truncated: false,
      status: ACT_RESULT_STATUS.ACCEPTED,
    },
    atMs: entry.atMs,
    entryId: entry.id,
  };
}

/** Whether an entry already stands for the same observation: the same hook for the same session at the same instant. */
export function sameObservation(entry: BrainObservationEntry, event: BrainWakeEvent): boolean {
  return (
    entry.kind === event.kind &&
    entry.hookEvent === event.hookEvent &&
    entry.atMs === event.atMs &&
    entry.providerId === event.identity.providerId &&
    entry.providerSessionId === event.identity.providerSessionId
  );
}
