import type { ToolResult } from "@sidecar/runtime/vocabulary";
import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * A tool's output as the runtime carries it: the record serialized, with the
 * status lifted beside it so the journal and the loop can read what became of
 * an act without parsing the body again.
 */
export function answer(output: WireRecord): ToolResult {
  const status = text(output.status);
  return { outputJson: JSON.stringify(output), ...(status ? { status } : undefined) };
}

/** The status a serialized tool output carries, for a reader holding only the JSON. */
export function outputStatus(outputJson: string): string | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the record and string guards are the validation.
    const parsed = JSON.parse(outputJson) as UnparsedWireValue;
    return isRecord(parsed) && isWireString(parsed.status) ? parsed.status : undefined;
  } catch {
    return undefined;
  }
}
