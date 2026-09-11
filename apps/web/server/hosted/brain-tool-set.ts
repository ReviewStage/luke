import { jsonSchema, type Tool, type ToolSet, tool } from "ai";
import {
  brainToolCatalog,
  brainToolRegistry,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewToolKinds,
  type NamedConversationViewToolKind,
  type Schema,
  TOOL_GROUP,
  unparsedWire,
  type WireBoundaryInput,
} from "../core.js";

/**
 * The brain's catalog as the two things a read of stored messages needs from
 * it. The registry is the `ToolSet` a row is held to: every catalog tool
 * under its name, its input read under the wire schema the model was offered,
 * so a part naming a tool this build does not register is refused and a part
 * whose input the schema refuses is refused with it. The kinds are the view's
 * classification: the speak group's tool is the announcement, the actions
 * group's are the actions, and every other tool is a detail of its turn. Both
 * are fixed by the build, so they are built once.
 */

function validatedInput(schema: Schema<unknown>) {
  return jsonSchema<unknown>(
    // SAFETY: the wire schema's node is JSON Schema in the strict form a function tool takes; a
    // round trip is its plain-object form, which is what the SDK's schema type names.
    JSON.parse(JSON.stringify(schema.jsonSchema())),
    {
      validate: (value) => {
        // SAFETY: the SDK hands the part's input back as it was stored, which is JSON; the read is the validation.
        const read = schema.read(unparsedWire(value as WireBoundaryInput));
        return read.ok
          ? { success: true, value: read.value }
          : {
              success: false,
              error: new Error(`${read.refusal} at ${read.path.map(String).join(".")}`),
            };
      },
    },
  );
}

function buildToolSet(): ToolSet {
  const tools: Record<string, Tool> = {};
  for (const [name, registration] of brainToolRegistry()) {
    tools[name] = tool({
      description: registration.description,
      inputSchema: validatedInput(registration.inputSchema),
    });
  }
  return tools;
}

function buildViewToolKinds(): ConversationViewToolKinds {
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

/** The registry stored rows are read under: the catalog's tools by name, inputs validated by their wire schemas. */
export const CATALOG_TOOL_SET: ToolSet = buildToolSet();

/** Which catalog tools the view draws as announcements and which as actions. */
export const CATALOG_VIEW_TOOL_KINDS: ConversationViewToolKinds = buildViewToolKinds();
