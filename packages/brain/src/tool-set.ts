import {
  EXCESS_KEYS,
  jsonRoundTrip,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { jsonSchema, type Tool, tool } from "ai";
import { Result, type Schema } from "effect";

/**
 * A tool as a reader of stored messages needs it, behind a door of its own
 * because the SDK's `tool()` is a run-time reach the barrel keeps to types
 * alone. A `ToolSet` of these is what a row is held to: every tool under its
 * name, its input read under the wire schema the model was offered, so a part
 * naming a tool this build does not register is refused and a part whose
 * input the schema refuses is refused with it.
 */

function validatedInput(schema: Schema.Codec<unknown, UnparsedWireValue>) {
  return jsonSchema<unknown>(
    // The wire schema's node is JSON Schema in the strict form a function tool takes; a
    // round trip is its plain-object form, which is what the SDK's schema type names.
    jsonRoundTrip(emitJsonSchema(schema)),
    {
      validate: (value) => {
        // SAFETY: the SDK hands the part's input back as it was stored, which is JSON; the read is the validation.
        // A key the tool's schema does not name is dropped rather than refused, so a row stored
        // under a wider schema than this build declares still reads as the call it was.
        const read = readEither(schema, { excess: EXCESS_KEYS.DROP })(
          unparsedWire(value as WireBoundaryInput),
        );
        return Result.match(read, {
          onSuccess: (value) => ({ success: true as const, value }),
          onFailure: (refused) => ({
            success: false as const,
            error: new Error(`${refused.refusal} at ${refused.path.map(String).join(".")}`),
          }),
        });
      },
    },
  );
}

/**
 * One tool as a stored row is held to it: its words, and its input read under
 * the wire schema the model was offered.
 */
export function wireValidatedTool(
  description: string,
  inputSchema: Schema.Codec<unknown, UnparsedWireValue>,
): Tool {
  return tool({ description, inputSchema: validatedInput(inputSchema) });
}
