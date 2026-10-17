import { describeWire } from "@luke/wire/effect";
import { Result, Schema } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";

/**
 * queue-question.ts -- the brain's `queue_question` tool: one question handed to the voice the moment it is ready.
 *
 * Note that the call does nothing when it runs. What carries the question is
 * the call itself: the store journals a tool call's input before it runs, so
 * the voice's follow reads it off the journal mid-turn
 * (`projectTurnEvents`) and hands it to GPT-Live as commentary, which the
 * voice says as the next question once the last one is answered.
 * The model goes on reading the repository and thinking while the developer
 * hears the questions it has already queued.
 *
 * The voice service holds the queue and hands the voice one question at a
 * time, the next once the developer has answered. `withdraw_question` takes
 * back one still waiting there, by its words.
 */

/** Each field under the 500 tokens one GPT-Live append carries, with room for the frame the voice service puts round them. */
const QUEUED_QUESTION_MAX_CHARS = 500;

const QUEUED_TEXT = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(QUEUED_QUESTION_MAX_CHARS),
);

const QUESTION_TEXT = describeWire(
  QUEUED_TEXT,
  'One decision to put to the developer, as Luke would ask it aloud, such as "Should a ' +
    'withdrawn invite tell the invitee who withdrew it?"',
);

const QUEUE_QUESTION_INPUT = Schema.Struct({
  question: QUESTION_TEXT,
  recommendation: describeWire(
    QUEUED_TEXT,
    'The answer you recommend, and why in a few words, such as "No: just say the invite is ' +
      'no longer valid, so nobody learns who removed them."',
  ),
});

/** A question the brain queued, read back off its journaled call. */
export type QueuedQuestion = typeof QUEUE_QUESTION_INPUT.Type;

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readQueuedQuestion = Schema.decodeUnknownResult(QUEUE_QUESTION_INPUT);

const WITHDRAW_QUESTION_INPUT = Schema.Struct({ question: QUESTION_TEXT });

const readWithdrawnQuestion = Schema.decodeUnknownResult(WITHDRAW_QUESTION_INPUT);

/** The tool as the brain is offered it: its name, its words, and its input schema. */
export const QUEUE_QUESTION_TOOL = {
  name: AGENT_TOOL.QUEUE_QUESTION,
  description:
    "Hand Luke one question for the developer the moment you have it, with your recommended " +
    "answer. Luke asks queued questions one at a time, in the order you queued them, the next " +
    "once the developer has answered, while you keep working. Call it once per question, " +
    "before reading the repository or thinking further. Answers `accepted`, or `rejected` for " +
    "an unreadable call.",
  inputSchema: QUEUE_QUESTION_INPUT,
} as const;

/**
 * The question a journaled call carries, or nothing for a call whose input
 * is still streaming in or does not read; a question is told once it is whole.
 */
export function queuedQuestionOf(part: StoredToolPart): QueuedQuestion | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readQueuedQuestion(part.input));
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runQueueQuestion(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readQueuedQuestion(input))
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not queued: the question is unreadable." }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}

/** The tool as the brain is offered it: its name, its words, and its input schema. */
export const WITHDRAW_QUESTION_TOOL = {
  name: AGENT_TOOL.WITHDRAW_QUESTION,
  description:
    "Take back a question you queued that an answer has made moot, in the words you queued it, " +
    "so Luke never asks it. A question Luke has already asked is not taken back. Answers " +
    "`accepted`, or `rejected` for an unreadable call.",
  inputSchema: WITHDRAW_QUESTION_INPUT,
} as const;

/** The words of the question a journaled call takes back, or nothing for a call still streaming in or unreadable. */
export function withdrawnQuestionOf(part: StoredToolPart): string | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readWithdrawnQuestion(part.input))?.question;
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runWithdrawQuestion(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readWithdrawnQuestion(input))
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not withdrawn: name the question." }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}
