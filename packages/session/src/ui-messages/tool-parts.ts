import type { ToolUIPart, UIDataTypes, UIMessagePart, UITools } from "ai";
import { Schema } from "effect";

/**
 * The tool part of a stored assistant message is the journal: a call is
 * written in `input-available` before it executes and moved to
 * `output-available` or `output-error` after, so a row a writer died inside
 * still says which call was under way. The SDK names more states than these —
 * the approval exchange among them — and a stored row carries none of those,
 * so a part outside this set is refused at the door rather than read as one
 * of them.
 */
export const TOOL_PART_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolPartState = (typeof TOOL_PART_STATE)[keyof typeof TOOL_PART_STATE];

export const ToolPartStateSchema = Schema.Literal(...Object.values(TOOL_PART_STATE));

const readsToolPartState = Schema.is(ToolPartStateSchema);

export function isToolPartState(value: string): value is ToolPartState {
  return readsToolPartState(value);
}

/** The states a resume has nothing left to do for: the call answered or failed. */
export function isSettledToolPartState(state: ToolPartState): boolean {
  return state === TOOL_PART_STATE.OUTPUT_AVAILABLE || state === TOOL_PART_STATE.OUTPUT_ERROR;
}

/**
 * How the SDK spells a static tool part's type: the tool's name behind this
 * prefix. The SDK's own `isStaticToolUIPart` and `getToolName` say the same,
 * but this module sits on the session barrel, which reaches the SDK for its
 * types alone, so the two-character rule is restated here rather than
 * imported at run time.
 */
const TOOL_PART_TYPE_PREFIX = "tool-";

/** The tool a part's type names, or nothing for a part that is not a static tool call. */
export function toolPartName(type: string): string | undefined {
  return type.startsWith(TOOL_PART_TYPE_PREFIX)
    ? type.slice(TOOL_PART_TYPE_PREFIX.length)
    : undefined;
}

/** A tool part in one of the states a stored row may carry. */
export type StoredToolPart = Extract<ToolUIPart<UITools>, { state: ToolPartState }>;

/** The tool a stored tool part calls, whose type always carries the prefix. */
export function storedToolName(part: StoredToolPart): string {
  return part.type.slice(TOOL_PART_TYPE_PREFIX.length);
}

export function isStoredToolPart(
  part: UIMessagePart<UIDataTypes, UITools>,
): part is StoredToolPart {
  return (
    toolPartName(part.type) !== undefined &&
    "state" in part &&
    part.state !== undefined &&
    isToolPartState(part.state)
  );
}
