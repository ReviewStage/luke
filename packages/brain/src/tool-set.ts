import {
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewToolKinds,
  type NamedConversationViewToolKind,
} from "@sidecar/session";
import {
  EXCESS_KEYS,
  jsonRoundTrip,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { jsonSchema, type Tool, type ToolSet, tool } from "ai";
import { Result, type Schema } from "effect";
import { brainToolCatalog, brainToolRegistry, TOOL_GROUP } from "./tools.js";

/**
 * The brain's catalog as the two things a reader of stored messages needs
 * from it, behind a door of its own because the SDK's `tool()` is a run-time
 * reach the barrel keeps to types alone. The registry is the `ToolSet` a row
 * is held to: every catalog tool under its name, its input read under the
 * wire schema the model was offered, so a part naming a tool this build does
 * not register is refused and a part whose input the schema refuses is
 * refused with it. The kinds are the Conversation view's classification: the
 * speak group's tool is the announcement, the actions group's are the
 * actions, and every other tool is a detail of its turn. Both are fixed by
 * the build, so a caller builds each once and holds it.
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
 * the wire schema the model was offered. The catalog's tools are built this
 * way, and so is a tool a hosted conversation is offered from outside the
 * catalog, so a row naming either reads back the same way.
 */
export function wireValidatedTool(
  description: string,
  inputSchema: Schema.Codec<unknown, UnparsedWireValue>,
): Tool {
  return tool({ description, inputSchema: validatedInput(inputSchema) });
}

/** The registry stored rows are read under: the catalog's tools by name, inputs validated by their wire schemas. */
export function catalogToolSet(): ToolSet {
  const tools: Record<string, Tool> = {};
  for (const [name, registration] of brainToolRegistry()) {
    tools[name] = wireValidatedTool(registration.description, registration.inputSchema);
  }
  return tools;
}

/** Which catalog tools the Conversation view draws as announcements and which as actions. */
export function catalogViewToolKinds(): ConversationViewToolKinds {
  const kinds = new Map<string, NamedConversationViewToolKind>();
  for (const descriptor of brainToolCatalog()) {
    if (descriptor.groups.includes(TOOL_GROUP.SPEAK)) {
      kinds.set(descriptor.schema.name, CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE);
    } else if (descriptor.groups.includes(TOOL_GROUP.ACTIONS)) {
      kinds.set(descriptor.schema.name, CONVERSATION_VIEW_TOOL_KIND.ACTION);
    }
  }
  return kinds;
}
