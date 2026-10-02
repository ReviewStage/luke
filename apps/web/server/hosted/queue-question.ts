import { describeWire, readEither } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";

/**
 * queue-question.ts -- the planning model's `queue_question` tool: one question handed to the voice the moment it is ready.
 *
 * Note that the call does nothing when it runs. What carries the question is
 * the call itself: the store journals a tool call's input before it runs, so
 * the voice's follow reads it off the journal mid-turn
 * (`projectTurnEvents`) and hands it to GPT-Live as a thinking append, held
 * to be asked when the conversation reaches it rather than said on arrival.
 * The model goes on reading the repository and thinking while the developer
 * hears the questions it has already queued.
 */

/** Each field under the 500 tokens one GPT-Live append carries, with room for the frame the voice service puts round them. */
const QUEUED_QUESTION_MAX_CHARS = 500;

const QUEUED_TEXT = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(QUEUED_QUESTION_MAX_CHARS),
);

const QUEUE_QUESTION_INPUT = Schema.Struct({
  question: describeWire(
    QUEUED_TEXT,
    'One decision to put to the developer, as Luke would ask it aloud, such as "Should a ' +
      'withdrawn invite tell the invitee who withdrew it?"',
  ),
  recommendation: describeWire(
    QUEUED_TEXT,
    'The answer you recommend, and why in a few words, such as "No: just say the invite is ' +
      'no longer valid, so nobody learns who removed them."',
  ),
});

/** A question the planning model queued, read back off its journaled call. */
export type QueuedQuestion = typeof QUEUE_QUESTION_INPUT.Type;

const readQueueQuestionInput = readEither(QUEUE_QUESTION_INPUT);

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readJournaledInput = Schema.decodeUnknownResult(QUEUE_QUESTION_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const QUEUE_QUESTION_TOOL = {
  name: "queue_question",
  description:
    "Hand Luke one question for the developer the moment you have it, with your recommended " +
    "answer. Luke holds every queued question and asks them one at a time, in the order you " +
    "queued them, while you keep working. Call it once per question, before reading the " +
    "repository or thinking further. Answers `accepted`, or `rejected` for an unreadable call.",
  inputSchema: QUEUE_QUESTION_INPUT,
} as const;

/**
 * The question a journaled call carries, or nothing for a call whose input
 * is still streaming in or does not read; a question is told once it is whole.
 */
export function queuedQuestionOf(part: StoredToolPart): QueuedQuestion | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readJournaledInput(part.input));
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runQueueQuestion(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readQueueQuestionInput(input))
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not queued: the question is unreadable." }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}
