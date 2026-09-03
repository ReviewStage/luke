import type { Session } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import type { BrainDelivery, BrainWakeEvent } from "./brain-events.js";
import { type ResponsesInputItem, userMessageItem } from "./brain-openai.js";

/**
 * The items a turn opens with, each a marker naming what kind of turn it is
 * and then the observed values as JSON behind it. The marker is the whole of
 * the instruction; everything after it is data the instructions tell the
 * model to read as data, however a title, a hook, or a transcript is phrased.
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
    ...(event.previousStatus ? { previous_status: event.previousStatus } : undefined),
    ...(event.session ? { session: sessionSummary(event.session) } : undefined),
    ...(event.transcriptDelta
      ? {
          transcript_delta: {
            status: event.transcriptDelta.status,
            truncated: event.transcriptDelta.truncated,
            text: event.transcriptDelta.text,
          },
        }
      : undefined),
  };
}

/** The item an observed-events turn opens with. */
export function wakeInputItem(events: readonly BrainWakeEvent[], now: number): ResponsesInputItem {
  return markedItem(
    BRAIN_INPUT_MARKER.OBSERVED_EVENTS,
    now,
    JSON.stringify({ events: events.map(eventRecord) }),
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
    session_ids: delivery.sessionIds.map((identity) => ({
      provider_id: identity.providerId,
      provider_session_id: identity.providerSessionId,
    })),
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
