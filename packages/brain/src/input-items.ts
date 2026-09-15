import type { Session } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import type { BrainDelivery, BrainWakeEvent } from "./wake-events.js";

/**
 * The words a turn opens with, each a marker naming what kind of turn it is
 * and then the observed values as JSON behind it. The marker is the whole of
 * the instruction; everything after it is data the instructions tell the
 * model to read as data, however a title, a status, or a transcript is phrased.
 * These are text: the context engine decides what item a provider takes them
 * as, so the host composes them without knowing any provider's shapes.
 */

/** The session fields an entry keeps: what the turn's opening renders, and never a transcript. */
function sessionSummary(session: Session): WireRecord {
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

export const BRAIN_INPUT_MARKER = {
  OBSERVED_EVENTS: "[observed events]",
  DEVELOPER_ASK: "[developer ask]",
  HOLD_RELEASED: "[hold released]",
  STANDING_CONTEXT: "[standing context]",
  /** What the memory provider recalled for the turn, as data: the facts every turn, the recent notes once into a fresh conversation. */
  RECALLED_MEMORY: "[recalled memory]",
  /** What sibling conversations did since this one last ran, as the host's own counts. */
  ACTIVITY_NOTICES: "[activity notices]",
  /** A child's delegated task, appended after any forked history; the child's assignment and nothing else. */
  SUBAGENT_TASK: "[subagent task]",
  /** A child's end, handed to the conversation that asked for it: a report to review, never an instruction. */
  CHILD_COMPLETION: "[child completion]",
  /** The developer's ask as far as it has been said, with the sessions on the desk, for the planner that reads ahead of it. */
  ANTICIPATED_ASK: "[anticipated ask]",
  /** What the reads made ahead of an ask answered, as data for the summary the voice is handed. */
  PREFETCHED_READS: "[prefetched reads]",
} as const;

type BrainInputMarker = (typeof BRAIN_INPUT_MARKER)[keyof typeof BRAIN_INPUT_MARKER];

function marked(marker: BrainInputMarker, now: number, body: string): string {
  return `${marker} ${new Date(now).toISOString()}\n${body}`;
}

function eventRecord(event: BrainWakeEvent): WireRecord {
  return {
    kind: event.kind,
    at: new Date(event.atMs).toISOString(),
    provider_id: event.identity.providerId,
    provider_session_id: event.identity.providerSessionId,
    ...(event.session
      ? { session: sessionSummary(event.session) }
      : event.sessionSummary
        ? { session: event.sessionSummary }
        : undefined),
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

/**
 * The words an observed-events turn opens with. The roster itself is not
 * repeated here: the same request carries it in the standing context, which
 * is rebuilt every turn and never remembered.
 */
export function wakeInputText(events: readonly BrainWakeEvent[], now: number): string {
  return marked(
    BRAIN_INPUT_MARKER.OBSERVED_EVENTS,
    now,
    JSON.stringify({ events: events.map(eventRecord) }),
  );
}

/**
 * The words a developer-ask turn opens with. Events that arrived since the
 * last turn ride along rather than waiting for their own, so the reply is
 * given knowing what just changed and the memory never skips them.
 */
export function askInputText(
  question: string,
  eventsSinceLastTurn: readonly BrainWakeEvent[],
  now: number,
): string {
  return marked(
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

/** The words a hold-released turn opens with: the briefings that waited, for one re-decision. */
export function holdReleasedInputText(held: readonly BrainDelivery[], now: number): string {
  return marked(
    BRAIN_INPUT_MARKER.HOLD_RELEASED,
    now,
    JSON.stringify({ held_briefings: held.map(deliveryRecord) }),
  );
}

/**
 * The standing context, rebuilt every turn and never remembered: the roster
 * as the host rendered it, then whatever else the host renders — today the
 * projects a workspace can be created in, and nothing of the conversation,
 * which is the session's own history, or of the developer, which is USER.md
 * in the prompt. It rides after the history so the instructions-plus-history
 * prefix stays cacheable.
 */
export function standingContextText(
  rosterText: string,
  standingContext: string,
  now: number,
): string {
  const context = standingContext.trim();
  return marked(
    BRAIN_INPUT_MARKER.STANDING_CONTEXT,
    now,
    context ? `${rosterText.trim()}\n\n${context}` : rosterText.trim(),
  );
}
