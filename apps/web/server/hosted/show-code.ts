import { CODE_PATH_MAX_CHARS, type CodeRef, codeRefSchema } from "@sidecar/hosted/plan-wire";
import { describeWire } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";

/**
 * show-code.ts -- the planning model's `show_code` tool: code of the plan's folder put on the developer's screen as Luke talks about it.
 *
 * Like `queue_question` beside it, the call does nothing when it runs: the
 * store journals its input before it runs, the voice's follow reads it off
 * the journal mid-turn (`projectTurnEvents`), and the voice service holds it
 * until Luke next starts to speak, then tells the developer's Mac, which
 * reads the lines from its own folder and draws them. Only the place travels:
 * the file's path and the lines, never what they say.
 */

const lineNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const SHOW_CODE_INPUT = Schema.Struct({
  path: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
    'The file, relative to the plan\'s folder root, such as "src/members/invite.ts".',
  ),
  startLine: Schema.optionalKey(
    describeWire(lineNumber, "The first line you are talking about, counted from 1."),
  ),
  endLine: Schema.optionalKey(
    describeWire(
      lineNumber,
      "The last line you are talking about; the same as startLine for one line. Leave both out to show the file from its top.",
    ),
  ),
});

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown, and that
// the wire's own reference is what is read, so a range out of order or too long is no reference at all.
const readShownCode = Schema.decodeUnknownResult(codeRefSchema);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const SHOW_CODE_TOOL = {
  name: "show_code",
  description:
    "Put lines of a file in the plan's folder on the developer's screen, lit, as Luke starts saying " +
    "your next words. Call it just before the queue_question or the return that talks about those " +
    "lines, with the lines you found through run_in_repository. Point at the few lines that matter, " +
    "at most 200. Answers `accepted`, or `rejected` for an unreadable call.",
  inputSchema: SHOW_CODE_INPUT,
} as const;

/**
 * The place a journaled call names, or nothing for a call whose input is
 * still streaming in or does not read; code is shown once its call is whole.
 */
export function shownCodeOf(part: StoredToolPart): CodeRef | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readShownCode(part.input));
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runShowCode(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readShownCode(input))
    ? {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason:
          "Not shown: name a path, and both lines or neither, the first no later than the last and at most 200 apart.",
      }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}
