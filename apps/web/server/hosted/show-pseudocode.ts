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
 * show-pseudocode.ts -- the planning model's `show_pseudocode` tool: pseudocode put in the plan so the developer can check logic they could not follow by ear.
 *
 * Note that the call does nothing when it runs, on the terms of
 * `queue_question`. What carries the pseudocode is the call itself: the
 * store journals a tool call's input before it runs, so the voice's follow
 * reads it off the journal mid-turn (`projectTurnEvents`), the plan's
 * notetaker writes it into the plan's Pseudocode field, and the voice points
 * the developer at it rather than reading it aloud. A new call replaces what
 * the field holds, so a correction is the model showing the steps again.
 */

const PSEUDOCODE_BOUNDS = {
  /** A title is one line naming the logic it shows. */
  MAX_TITLE_CHARS: 120,
  /** Short steps the developer reads in the panel, not a program. */
  MAX_BODY_CHARS: 4_000,
} as const;

const SHOW_PSEUDOCODE_INPUT = Schema.Struct({
  title: describeWire(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_TITLE_CHARS)),
    'What the pseudocode shows, in a few words, such as "Accepting an invite".',
  ),
  body: describeWire(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_BODY_CHARS)),
    "The steps as plain pseudocode, one step a line, indented under the step that holds " +
      "them, numbered where the developer will refer to a step. Not real code and no fences.",
  ),
});

/** Pseudocode the planning model showed, read back off its journaled call. */
export type ShownPseudocode = typeof SHOW_PSEUDOCODE_INPUT.Type;

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readShown = Schema.decodeUnknownResult(SHOW_PSEUDOCODE_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const SHOW_PSEUDOCODE_TOOL = {
  name: "show_pseudocode",
  description:
    "Put pseudocode in the plan, under Implementation, so the developer can read logic whose " +
    "order, branches, or loops are hard to follow by ear. A new call replaces the pseudocode " +
    "the plan holds. Luke points the developer at it and never reads it aloud. Answers " +
    "`accepted`, or `rejected` for an unreadable call.",
  inputSchema: SHOW_PSEUDOCODE_INPUT,
} as const;

/**
 * The pseudocode a journaled call carries, or nothing for a call whose input
 * is still streaming in or does not read; it is shown once it is whole.
 */
export function shownPseudocodeOf(part: StoredToolPart): ShownPseudocode | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  return Result.getOrUndefined(readShown(part.input));
}

/** Runs one call: accepted when its input reads, since the journal has already carried it. */
export function runShowPseudocode(input: UnparsedWireValue): WireRecord {
  return Result.isFailure(readShown(input))
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Not shown: the pseudocode is unreadable." }
    : { status: ACTION_RESULT_STATUS.ACCEPTED };
}

/**
 * Shown pseudocode as the plan's Pseudocode field: its title, then its steps
 * in one fence. Note that the fence is longer than any run of backticks in
 * the steps, because a run as long as the fence would close it and let the
 * rest of the steps out as Markdown.
 */
export function pseudocodeField(shown: ShownPseudocode): string {
  const longestRun = Math.max(0, ...(shown.body.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const title = shown.title.replace(/\s+/gu, " ");
  return `${title}\n\n${fence}text\n${shown.body}\n${fence}`;
}
