import { codeRefSchema } from "@sidecar/hosted/plan-wire";
import { describeWire } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";
import { SHOW_CODE_INPUT } from "./show-code.js";

/**
 * queue-question.ts -- the planning model's `queue_question` tool: one question handed to the voice the moment it is ready.
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
 * time, the next once the developer has answered, so a question's code rides
 * with it and goes on screen as Luke asks it rather than when it was queued.
 * `withdraw_question` takes back one still waiting there, by its words.
 */

/**
 * How long a question and its recommendation may be, and how many options
 * of what length it may offer: about one breath each, because a question
 * read out longer than that is one the developer has forgotten the start of
 * by its end, and three options are as many as a listener holds.
 */
const QUEUED_QUESTION_BOUNDS = {
  TEXT_CHARS: 200,
  OPTIONS: 3,
  OPTION_CHARS: 60,
} as const;

const QUEUED_TEXT = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(QUEUED_QUESTION_BOUNDS.TEXT_CHARS),
);

const QUEUED_OPTIONS = Schema.Array(
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(QUEUED_QUESTION_BOUNDS.OPTION_CHARS)),
).check(Schema.isMinLength(2), Schema.isMaxLength(QUEUED_QUESTION_BOUNDS.OPTIONS));

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
  options: Schema.optionalKey(
    describeWire(
      QUEUED_OPTIONS,
      "Where the developer chooses between directions, the two or three to choose from, a few words each.",
    ),
  ),
  code: Schema.optionalKey(
    describeWire(
      SHOW_CODE_INPUT,
      "Code the question is about, shown on the developer's screen as Luke asks it.",
    ),
  ),
});

// Note that the wire's own code reference is what is read, so a range out of order or too long
// makes the whole question unreadable rather than a question with no code.
const QUEUED_QUESTION = Schema.Struct({
  question: QUEUED_TEXT,
  recommendation: QUEUED_TEXT,
  options: Schema.optionalKey(QUEUED_OPTIONS),
  code: Schema.optionalKey(codeRefSchema),
});

/** A question the planning model queued, read back off its journaled call. */
export type QueuedQuestion = typeof QUEUED_QUESTION.Type;

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readQueuedQuestion = Schema.decodeUnknownResult(QUEUED_QUESTION);

const WITHDRAW_QUESTION_INPUT = Schema.Struct({ question: QUESTION_TEXT });

const readWithdrawnQuestion = Schema.decodeUnknownResult(WITHDRAW_QUESTION_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const QUEUE_QUESTION_TOOL = {
  name: "queue_question",
  description:
    "Hand Luke one question for the developer the moment you have it, with your recommended " +
    "answer and, where it is about specific code, that code. Luke asks queued questions one at " +
    "a time, in the order you queued them, the next once the developer has answered, while you " +
    "keep working. Call it once per question, before reading the repository or thinking " +
    "further. Answers `accepted`, or `rejected` for an unreadable call.",
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
    ? {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason:
          "Not queued: give a question and a recommendation of at most 200 characters each, two or three options of at most 60 characters if any, and code with both lines or neither, the first no later than the last and at most 200 apart.",
      }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const WITHDRAW_QUESTION_TOOL = {
  name: "withdraw_question",
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
