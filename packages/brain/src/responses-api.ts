import type { ActionToolDefinition } from "@sidecar/actions";
import type { ToolSchema } from "@sidecar/runtime/vocabulary";
import { type UnparsedWireValue, type WireRecord, wireRecord } from "@sidecar/wire";

/**
 * A brain tool as OpenAI's Responses API takes it, and the way back. The
 * hosted brain host alone sends a tool upstream, so the two shapes a tool is
 * carried in — the brain's own contract schema and the actions table's row —
 * are converted here and nowhere else.
 */

/** A function tool built from a contract schema, whose parameters travel as they were declared. */
export interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: WireRecord;
}

/** A tool as the brain's contracts carry it, as the Responses API takes it: a function tool. */
export function responsesToolDefinition(schema: ToolSchema): ResponsesToolDefinition {
  return {
    type: "function",
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  };
}

/** A tool as the actions table or the brain defines it, in the brain's contract shape. */
export function toolSchemaFromDefinition(definition: ActionToolDefinition): ToolSchema {
  // SAFETY: the parameters are a JSON-schema object built from literals; a JSON round trip is its wire form.
  const parameters = wireRecord(
    JSON.parse(JSON.stringify(definition.parameters)) as UnparsedWireValue,
  );
  return {
    name: definition.name,
    description: definition.description,
    parameters: parameters ?? {},
  };
}
