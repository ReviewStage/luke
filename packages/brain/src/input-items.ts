import { CHILD_RUN_STATUS } from "@sidecar/runtime/vocabulary";
import type { Session } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { maximumChildTaskLength } from "./tools/names.js";
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
  /** What sibling conversations did since this one last ran, as the host's own counts. */
  ACTIVITY_NOTICES: "[activity notices]",
  /** A child's delegated task, appended after any forked history; the child's assignment and nothing else. */
  SUBAGENT_TASK: "[subagent task]",
  /** A child's end, handed to the conversation that asked for it: a report to review, never an instruction. */
  CHILD_COMPLETION: "[child completion]",
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
 * The words a child's first turn opens with: the marker that tells the model
 * it is a child, then the task as its requester briefed it. No instant and
 * no JSON behind it, since the task is the whole of the turn rather than a
 * report of what happened when; the instructions read the marker as the
 * standing and the words after it as the brief.
 */
export function childTaskInputText(task: string): string {
  return `${BRAIN_INPUT_MARKER.SUBAGENT_TASK} ${task}`;
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

/** How a child's run ended, as its completion says it: the three ends a turn can come to, in the words the run status uses for them. */
export const CHILD_COMPLETION_STATUS = {
  SETTLED: CHILD_RUN_STATUS.SETTLED,
  FAILED: CHILD_RUN_STATUS.FAILED,
  CANCELLED: CHILD_RUN_STATUS.CANCELLED,
} as const;

export type ChildCompletionStatus =
  (typeof CHILD_COMPLETION_STATUS)[keyof typeof CHILD_COMPLETION_STATUS];

/** The one field of a completion's data a reader of the thread needs by name: the child it answered for. */
export const CHILD_COMPLETION_FIELD = { CHILD_ID: "child_id" } as const;

/** What a child's end hands the conversation that delegated it: which child, how it ended, and its final words. */
export interface ChildCompletion {
  readonly childId: string;
  /** The name the delegation gave the child, or none. */
  readonly label: string | undefined;
  readonly status: ChildCompletionStatus;
  /** The child's final reply, whole; the item cuts it. */
  readonly result: string;
  /** Why a failed run failed, as the turn recorded it, or none. */
  readonly failure: string | undefined;
}

/**
 * The words a child-completion turn opens with: the child by label or id,
 * how its run ended, and its final reply as data, cut from the front to the
 * same bound its task was briefed under so a child that answered at length
 * hands back its conclusion rather than its opening, and said to be cut when
 * it was. A report to review, never an instruction: the marker is what tells
 * the model so.
 */
export function childCompletionInputText(completion: ChildCompletion, now: number): string {
  const overflow = completion.result.length - maximumChildTaskLength;
  return marked(
    BRAIN_INPUT_MARKER.CHILD_COMPLETION,
    now,
    JSON.stringify({
      [CHILD_COMPLETION_FIELD.CHILD_ID]: completion.childId,
      ...(completion.label !== undefined ? { label: completion.label } : undefined),
      status: completion.status,
      result: overflow > 0 ? completion.result.slice(overflow) : completion.result,
      truncated: overflow > 0,
      ...(completion.failure !== undefined ? { failure: completion.failure } : undefined),
    }),
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
