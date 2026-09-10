import type { Session, SessionIdentity } from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  type ActionResultStatus,
  isInstant,
  isRecord,
  isWireBoolean,
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

/**
 * How many captured observations one turn opens with. It bounds what a
 * model reads, never what the store keeps: every capture stands in the inbox
 * until a turn consumes it, because each entry carries the transcript delta
 * read for it and the capture cursor has already moved past that text, so a
 * dropped entry would be words no later read could recover.
 */
export const INBOX_CAPACITY = 20;

/**
 * The captured observations a turn opens with, oldest first and at most the
 * inbox's turn depth. What stands beyond it waits, whole, for the next wake
 * or look, which opens a turn whenever the inbox holds anything.
 */
export function inboxEvents(inbox: readonly BrainObservationEntry[]): readonly BrainWakeEvent[] {
  return inbox.slice(0, INBOX_CAPACITY).map(eventFromEntry);
}

const WAKE_KIND_LIST: readonly BrainWakeKind[] = Object.values(BRAIN_WAKE_KIND);

function isWakeKind(value: UnparsedWireValue): value is BrainWakeKind {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && WAKE_KIND_LIST.includes(value as BrainWakeKind);
}

const ACTION_RESULT_STATUS_LIST: readonly ActionResultStatus[] =
  Object.values(ACTION_RESULT_STATUS);

function isActionResultStatus(value: UnparsedWireValue): value is ActionResultStatus {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && ACTION_RESULT_STATUS_LIST.includes(value as ActionResultStatus);
}

function deltaFromWire(value: UnparsedWireValue): BrainTranscriptDelta | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isWireString(value.text) || !isWireBoolean(value.truncated)) return null;
  if (!isActionResultStatus(value.status)) return null;
  return { text: value.text, truncated: value.truncated, status: value.status };
}

/** Reads a stored entry, or nothing for one this build cannot vouch for. */
export function brainObservationEntryFromWire(
  value: UnparsedWireValue,
): BrainObservationEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.id) || value.id.length === 0 || !isWakeKind(value.kind)) return undefined;
  if (!isWireString(value.providerId) || !isWireString(value.providerSessionId)) return undefined;
  if (!isInstant(value.atMs) || !isInstant(value.capturedAt)) return undefined;
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
    ...(session.holdingForDeveloper === true ? { holding_for_developer: true } : undefined),
    ...(session.completionCause ? { completion_cause: session.completionCause } : undefined),
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
function eventFromEntry(entry: BrainObservationEntry): BrainWakeEvent {
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
      status: ACTION_RESULT_STATUS.ACCEPTED,
    },
    atMs: entry.atMs,
    entryId: entry.id,
  };
}

/** What makes two observations the same one: the same hook for the same session at the same instant. */
export interface ObservationMark {
  readonly kind: BrainWakeKind;
  readonly hookEvent?: string;
  readonly atMs: number;
  readonly identity: SessionIdentity;
}

/** An inbox entry's mark; the entry keeps the session identity as two flat fields. */
export function entryMark(entry: BrainObservationEntry): ObservationMark {
  return {
    kind: entry.kind,
    hookEvent: entry.hookEvent,
    atMs: entry.atMs,
    identity: { providerId: entry.providerId, providerSessionId: entry.providerSessionId },
  };
}

/** Whether two observations are the one observation, so a hook delivered twice is captured once. */
export function sameObservation(first: ObservationMark, second: ObservationMark): boolean {
  return (
    first.kind === second.kind &&
    first.hookEvent === second.hookEvent &&
    first.atMs === second.atMs &&
    first.identity.providerId === second.identity.providerId &&
    first.identity.providerSessionId === second.identity.providerSessionId
  );
}
