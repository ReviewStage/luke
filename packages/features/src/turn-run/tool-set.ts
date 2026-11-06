import {
  EXCESS_KEYS,
  jsonRoundTrip,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@repo/wire";
import { emitJsonSchema, readEither } from "@repo/wire/effect";
import { jsonSchema, type Tool, tool } from "ai";
import { Result, type Schema } from "effect";

function validatedInput(schema: Schema.Codec<unknown, UnparsedWireValue>) {
  return jsonSchema<unknown>(jsonRoundTrip(emitJsonSchema(schema)), {
    validate: (value) => {
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
  });
}

export function wireValidatedTool(
  description: string,
  inputSchema: Schema.Codec<unknown, UnparsedWireValue>,
): Tool {
  return tool({ description, inputSchema: validatedInput(inputSchema) });
}
