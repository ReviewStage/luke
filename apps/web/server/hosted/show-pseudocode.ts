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
 * show-pseudocode.ts -- the planning model's `show_pseudocode` tool: a quick sketch of logic put in the plan so the developer can see what Luke means.
 *
 * Note that the call does nothing when it runs, on the terms of
 * `queue_question`. What carries the pseudocode is the call itself: the
 * store journals a tool call's input before it runs, so the voice's follow
 * reads it off the journal mid-turn (`projectTurnEvents`), the plan's
 * notetaker writes it into the plan's Pseudocode field, and the voice points
 * the developer at it rather than reading it aloud. A new call replaces what
 * the field holds.
 *
 * Note that the pseudocode is free text in whatever style fits, bounded only
 * in size, because it is a sketch for one developer to read, and a typed
 * step grammar made it read as a form filled in rather than as an idea.
 */

const PSEUDOCODE_BOUNDS = {
  /** A title is one line naming what the pseudocode shows. */
  MAX_TITLE_CHARS: 120,
  /** A sketch the developer reads in the panel, not a program. */
  MAX_CODE_CHARS: 4_000,
} as const;

const SHOW_PSEUDOCODE_INPUT = Schema.Struct({
  title: describeWire(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_TITLE_CHARS)),
    'What the pseudocode shows, in a few words, such as "Accepting an invite".',
  ),
  code: describeWire(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_CODE_CHARS)),
    "The pseudocode, in whatever style reads best, without a fence.",
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
    "Put a quick pseudocode sketch in the plan, under Implementation, for the developer to " +
    "read while Luke asks about it. A new call replaces the sketch the plan holds. Answers " +
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
 * Shown pseudocode as the plan's Pseudocode field: its title, then the code
 * in one fence. Note that the fence is longer than any run of backticks in
 * the code, because a run as long as the fence would close it and let the
 * rest out as Markdown.
 */
export function pseudocodeField(shown: ShownPseudocode): string {
  const longestRun = Math.max(0, ...(shown.code.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const title = shown.title.replace(/\s+/gu, " ");
  return `${title}\n\n${fence}\n${shown.code}\n${fence}`;
}
