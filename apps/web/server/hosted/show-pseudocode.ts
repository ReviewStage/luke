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
 *
 * The steps are typed rather than free text: each is one keyword from a
 * fixed set and one short line, nested under a branch or a loop at most
 * three levels deep. Note that this is what makes the field pseudocode,
 * because a free-text body let the model write prose there, and a call that
 * carries prose now fails to read and is refused.
 */

const PSEUDOCODE_BOUNDS = {
  /** A title is one line naming the logic it shows. */
  MAX_TITLE_CHARS: 120,
  /** A step is one action on one line, short enough to name in a sentence. */
  MAX_STEP_CHARS: 100,
  /** The most top-level steps, which is as long as a developer will read in the panel. */
  MAX_STEPS: 20,
  /** The most steps nested under one step. */
  MAX_NESTED_STEPS: 10,
} as const;

/** What one step does, drawn as its keyword; the fixed set is what keeps the steps pseudocode rather than prose. */
const PSEUDOCODE_STEP_KIND = {
  DO: "do",
  IF: "if",
  ELSE: "else",
  FOR_EACH: "for_each",
  WHILE: "while",
  RETURN: "return",
  FAIL: "fail",
} as const;

type PseudocodeStepKind = (typeof PSEUDOCODE_STEP_KIND)[keyof typeof PSEUDOCODE_STEP_KIND];

const STEP_KEYWORD = {
  [PSEUDOCODE_STEP_KIND.DO]: "DO",
  [PSEUDOCODE_STEP_KIND.IF]: "IF",
  [PSEUDOCODE_STEP_KIND.ELSE]: "ELSE",
  [PSEUDOCODE_STEP_KIND.FOR_EACH]: "FOR EACH",
  [PSEUDOCODE_STEP_KIND.WHILE]: "WHILE",
  [PSEUDOCODE_STEP_KIND.RETURN]: "RETURN",
  [PSEUDOCODE_STEP_KIND.FAIL]: "FAIL",
} as const satisfies Record<PseudocodeStepKind, string>;

const stepFields = {
  kind: describeWire(
    Schema.Literals(Object.values(PSEUDOCODE_STEP_KIND)),
    "What the step does: do an action, branch (if, else), loop (for_each, while), " +
      "return a result, or fail.",
  ),
  text: describeWire(
    Schema.Trim.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_STEP_CHARS),
      Schema.isPattern(/^[^\r\n]*$/u),
    ),
    'The step after its keyword, one short line in plain words, such as "the invite is ' +
      'older than 7 days" for an if. Not code and not a sentence of explanation.',
  ),
};

/** The steps nested under one step, each of the same shape. */
function nestedSteps<S extends Schema.Top>(step: S) {
  return Schema.optionalKey(
    describeWire(
      Schema.Array(step).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_NESTED_STEPS),
      ),
      "The steps inside a branch or a loop.",
    ),
  );
}

// Note that the nesting is spelled out three levels deep rather than recursive, because three
// levels is all a developer can follow in the panel and the schema the model is shown stays flat.
const innermostStep = Schema.Struct(stepFields);
const middleStep = Schema.Struct({ ...stepFields, steps: nestedSteps(innermostStep) });
const outerStep = Schema.Struct({ ...stepFields, steps: nestedSteps(middleStep) });

const SHOW_PSEUDOCODE_INPUT = Schema.Struct({
  title: describeWire(
    Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_TITLE_CHARS)),
    'What the pseudocode shows, in a few words, such as "Accepting an invite".',
  ),
  steps: describeWire(
    Schema.Array(outerStep).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(PSEUDOCODE_BOUNDS.MAX_STEPS),
    ),
    "The steps in order. Nest the steps of a branch or a loop under it, at most three levels.",
  ),
});

/** One step as the call carries it, at whatever depth. */
interface PseudocodeStep {
  readonly kind: PseudocodeStepKind;
  readonly text: string;
  readonly steps?: readonly PseudocodeStep[];
}

/** Pseudocode the planning model showed: its title, and its steps drawn as numbered lines. */
export interface ShownPseudocode {
  readonly title: string;
  readonly body: string;
}

// Note that a journaled call's input is the stored row's, which the AI SDK types as unknown.
const readShown = Schema.decodeUnknownResult(SHOW_PSEUDOCODE_INPUT);

/**
 * The steps as numbered lines, each nested step indented under its parent
 * and numbered within it (2, 2.1, 2.1.1), so Luke can name any step.
 */
function stepLines(steps: readonly PseudocodeStep[], parent: string, depth: number): string[] {
  return steps.flatMap((step, index) => {
    const number = `${parent}${index + 1}`;
    const line = `${"  ".repeat(depth)}${number}. ${STEP_KEYWORD[step.kind]} ${step.text}`;
    return [line, ...stepLines(step.steps ?? [], `${number}.`, depth + 1)];
  });
}

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const SHOW_PSEUDOCODE_TOOL = {
  name: "show_pseudocode",
  description:
    "Put pseudocode in the plan, under Implementation, so the developer can read logic whose " +
    "order, branches, or loops are hard to follow by ear. Each step is one keyword and one " +
    "short line; the plan numbers them. A new call replaces the pseudocode the plan holds. " +
    "Luke points the developer at it and never reads it aloud. Answers `accepted`, or " +
    "`rejected` for an unreadable call.",
  inputSchema: SHOW_PSEUDOCODE_INPUT,
} as const;

/**
 * The pseudocode a journaled call carries, its steps drawn as numbered
 * lines, or nothing for a call whose input is still streaming in or does not
 * read; it is shown once it is whole.
 */
export function shownPseudocodeOf(part: StoredToolPart): ShownPseudocode | undefined {
  if (part.state === TOOL_PART_STATE.INPUT_STREAMING) return undefined;
  const shown = Result.getOrUndefined(readShown(part.input));
  if (shown === undefined) return undefined;
  return { title: shown.title, body: stepLines(shown.steps, "", 0).join("\n") };
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
