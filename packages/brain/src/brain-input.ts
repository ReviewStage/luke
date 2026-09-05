import type { Session } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import type { BrainDelivery, BrainTranscriptDigest, BrainWakeEvent } from "./brain-events.js";
import { type ResponsesInputItem, userMessageItem } from "./brain-openai.js";

/**
 * The items a turn opens with, each a marker naming what kind of turn it is
 * and then the observed values as JSON behind it. The marker is the whole of
 * the instruction; everything after it is data the instructions tell the
 * model to read as data, however a title, a hook, or a digest is phrased.
 */

export const BRAIN_INPUT_MARKER = {
  OBSERVED_EVENTS: "[observed events]",
  DEVELOPER_ASK: "[developer ask]",
  HOLD_RELEASED: "[hold released]",
  STANDING_CONTEXT: "[standing context]",
} as const;

export type BrainInputMarker = (typeof BRAIN_INPUT_MARKER)[keyof typeof BRAIN_INPUT_MARKER];

function markedItem(marker: BrainInputMarker, now: number, body: string): ResponsesInputItem {
  return userMessageItem(`${marker} ${new Date(now).toISOString()}\n${body}`);
}

function sessionSummary(session: Session): WireRecord {
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

function eventRecord(event: BrainWakeEvent): WireRecord {
  return {
    kind: event.kind,
    at: new Date(event.atMs).toISOString(),
    ...(event.hookEvent ? { hook: event.hookEvent } : undefined),
    provider_id: event.identity.providerId,
    provider_session_id: event.identity.providerSessionId,
    ...(event.session ? { session: sessionSummary(event.session) } : undefined),
    ...(event.digest ? { transcript_digest: digestRecord(event.digest) } : undefined),
  };
}

/**
 * The digest as the brain reads it: the read's status and cut beside the
 * form's fields, each field present only when the digest carries it. No
 * transcript text has a slot here, which is the whole point of the digest.
 */
function digestRecord(digest: BrainTranscriptDigest): WireRecord {
  return {
    status: digest.status,
    truncated: digest.truncated,
    source: digest.source,
    stop_state: digest.digest.stopState,
    ...(digest.digest.lastAsk ? { last_ask: digest.digest.lastAsk } : undefined),
    ...(digest.digest.didSince ? { did_since: digest.digest.didSince } : undefined),
    ...(digest.digest.waitingOn ? { waiting_on: digest.digest.waitingOn } : undefined),
  };
}

/**
 * The item an observed-events turn opens with. A scheduled roster wake also
 * carries the whole roster as `list_sessions` would answer it, so the look is
 * at everything observed, not only the sessions whose transcripts grew.
 */
export function wakeInputItem(
  events: readonly BrainWakeEvent[],
  now: number,
  roster?: string,
): ResponsesInputItem {
  return markedItem(
    BRAIN_INPUT_MARKER.OBSERVED_EVENTS,
    now,
    JSON.stringify({
      ...(roster !== undefined ? { scheduled_roster_look: true, roster } : undefined),
      events: events.map(eventRecord),
    }),
  );
}

/**
 * The item a developer-ask turn opens with. Events that arrived since the
 * last turn ride along rather than waiting for their own, so the reply is
 * given knowing what just changed and the memory never skips them.
 */
export function askInputItem(
  question: string,
  eventsSinceLastTurn: readonly BrainWakeEvent[],
  now: number,
): ResponsesInputItem {
  return markedItem(
    BRAIN_INPUT_MARKER.DEVELOPER_ASK,
    now,
    JSON.stringify({
      question,
      events_since_last_turn: eventsSinceLastTurn.map(eventRecord),
    }),
  );
}

function deliveryRecord(delivery: BrainDelivery): WireRecord {
  return {
    briefing: delivery.briefing,
    decided_at: new Date(delivery.decidedAt).toISOString(),
  };
}

/** The item a hold-released turn opens with: the briefings that waited, for one re-decision. */
export function holdReleasedInputItem(
  held: readonly BrainDelivery[],
  now: number,
): ResponsesInputItem {
  return markedItem(
    BRAIN_INPUT_MARKER.HOLD_RELEASED,
    now,
    JSON.stringify({ held_briefings: held.map(deliveryRecord) }),
  );
}

/**
 * The standing context, rebuilt every turn and never remembered: the roster
 * as the host rendered it, then whatever else the host renders — projects,
 * remembered facts, the recent conversation, the app guide. It rides after
 * the history so the instructions-plus-history prefix stays cacheable.
 */
export function standingContextItem(
  rosterText: string,
  standingContext: string,
  now: number,
): ResponsesInputItem {
  const context = standingContext.trim();
  return markedItem(
    BRAIN_INPUT_MARKER.STANDING_CONTEXT,
    now,
    context ? `${rosterText.trim()}\n\n${context}` : rosterText.trim(),
  );
}
