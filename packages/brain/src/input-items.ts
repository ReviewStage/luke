import { CHILD_RUN_STATUS } from "@sidecar/runtime/vocabulary";
import { maximumChildTaskLength } from "./tools/names.js";

/**
 * The words a turn opens with, each a marker naming what kind of turn it is
 * and then the observed values behind it, as JSON or as one line per message.
 * The marker is the whole of the instruction; everything after it is data the
 * instructions tell the model to read as data, however a title, a status, or
 * a transcript is phrased. These are text: the context engine decides what
 * item a provider takes them as, so the host composes them without knowing
 * any provider's shapes.
 */

/**
 * What an observed-messages turn says about the chat before its lines: who
 * runs it, where, what it is called, and when its transcript last changed.
 * Every field is the roster's, so a chat the roster does not hold is named
 * by its id alone.
 */
export interface ObservedMessagesEnvelope {
  readonly providerName: string;
  readonly workspace?: string;
  readonly title?: string;
  readonly providerSessionId: string;
  readonly updatedAt: number;
}

/** The line that stands in for the front of a delta the bound cut. */
export const OBSERVED_MESSAGES_CUT = "(earlier messages cut)";

/** What stands between the envelope's parts; exported so a reader of the row splits on the same word. */
export const ENVELOPE_SEPARATOR = " \u00b7 ";

export const BRAIN_INPUT_MARKER = {
  OBSERVED_MESSAGES: "[observed messages]",
  DEVELOPER_ASK: "[developer ask]",
  STANDING_CONTEXT: "[standing context]",
  /** A child's delegated task, appended after any forked history; the child's assignment and nothing else. */
  SUBAGENT_TASK: "[subagent task]",
  /** A child's end, handed to the conversation that asked for it: a report to review, never an instruction. */
  CHILD_COMPLETION: "[child completion]",
} as const;

type BrainInputMarker = (typeof BRAIN_INPUT_MARKER)[keyof typeof BRAIN_INPUT_MARKER];

function marked(marker: BrainInputMarker, now: number, body: string): string {
  return `${marker} ${new Date(now).toISOString()}\n${body}`;
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
 * The words an observed-messages turn opens with: the marker, the envelope
 * naming the chat, the cut line where the front was dropped, and then the
 * messages the chat gained, one line each, the way a room receives them. The
 * roster itself is not repeated here: the same request carries it in the
 * standing context, which is rebuilt every turn and never remembered.
 */
export function observedMessagesText(
  envelope: ObservedMessagesEnvelope,
  lines: readonly string[],
  truncated: boolean,
  now: number,
): string {
  const name = envelope.title ?? `chat ${envelope.providerSessionId}`;
  const header = [
    envelope.providerName,
    envelope.workspace,
    name,
    new Date(envelope.updatedAt).toISOString(),
  ]
    .filter((part) => part !== undefined)
    .join(ENVELOPE_SEPARATOR);
  const body = [`[${header}]`, ...(truncated ? [OBSERVED_MESSAGES_CUT] : []), ...lines];
  return marked(BRAIN_INPUT_MARKER.OBSERVED_MESSAGES, now, body.join("\n"));
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
