import type { ToolUIPart, UIDataTypes, UIMessagePart, UITools } from "ai";
import { Schema } from "effect";

export const TOOL_PART_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolPartState = (typeof TOOL_PART_STATE)[keyof typeof TOOL_PART_STATE];

export const ToolPartStateSchema = Schema.Literals(Object.values(TOOL_PART_STATE));

const readsToolPartState = Schema.is(ToolPartStateSchema);

export function isToolPartState(value: string): value is ToolPartState {
  return readsToolPartState(value);
}

export function isSettledToolPartState(state: ToolPartState): boolean {
  return state === TOOL_PART_STATE.OUTPUT_AVAILABLE || state === TOOL_PART_STATE.OUTPUT_ERROR;
}

const TOOL_PART_TYPE_PREFIX = "tool-";

export function toolPartName(type: string): string | undefined {
  return type.startsWith(TOOL_PART_TYPE_PREFIX)
    ? type.slice(TOOL_PART_TYPE_PREFIX.length)
    : undefined;
}

export type StoredToolPart = Extract<ToolUIPart<UITools>, { state: ToolPartState }>;

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
