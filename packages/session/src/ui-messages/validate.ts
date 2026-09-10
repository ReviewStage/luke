import {
  ASSISTANT_MESSAGE_METADATA,
  type AssistantMessageMetadata,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  type UnparsedWireValue,
  USER_MESSAGE_METADATA,
  type UserMessageMetadata,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import {
  isStaticToolUIPart,
  safeValidateUIMessages,
  type ToolSet,
  type ToolUIPart,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import { isToolPartState, type ToolPartState } from "./tool-parts.js";

/**
 * A stored message as this build reads it back: the SDK's `UIMessage`, with
 * the row's role deciding which metadata it carries. Reading rows back is
 * where a stored shape is held to the vocabulary, and it goes through the
 * SDK's own `validateUIMessages` so the structure a row must have is the
 * SDK's own statement of it, not a second one kept here. What this wrapper
 * adds is what the SDK leaves to its caller: the metadata schema for each
 * role, the refusal of a tool name the catalog did not register, and the
 * refusal of a tool state a stored row never carries.
 */
export type StoredUIMessage =
  | StoredMessageOf<typeof MESSAGE_ROLE.USER, UserMessageMetadata>
  | StoredMessageOf<typeof MESSAGE_ROLE.ASSISTANT, AssistantMessageMetadata>
  | (Omit<UIMessage<never>, "role" | "metadata"> & { role: typeof MESSAGE_ROLE.SYSTEM });

type StoredMessageOf<Role extends UIMessage["role"], Metadata> = Omit<
  UIMessage<Metadata>,
  "role" | "metadata"
> & { role: Role; metadata: Metadata };

/** A tool part in one of the states a stored row may carry. */
export type StoredToolPart = Extract<ToolUIPart<UITools>, { state: ToolPartState }>;

export function isStoredToolPart(
  part: UIMessagePart<UIDataTypes, UITools>,
): part is StoredToolPart {
  return isStaticToolUIPart(part) && isToolPartState(part.state);
}

/**
 * What the SDK hands back before the metadata is read: a row it validated
 * structurally, whose metadata it passed through as it came off the wire.
 */
type ValidatedMessage = UIMessage<WireBoundaryInput>;

type ValidationOptions = Parameters<typeof safeValidateUIMessages<ValidatedMessage>>[0];

/** How the SDK spells a static tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

/**
 * The type the SDK gives a tool part that names no registered tool. The SDK
 * converts an unregistered part that already answered into one of these
 * rather than refusing it, so a stored row is held to the registry before
 * the SDK sees it; one found afterwards is a registered tool whose input the
 * registered schema refused.
 */
const DYNAMIC_TOOL_PART_TYPE = "dynamic-tool";

function refuse(refusal: SchemaRefusal, path: SchemaPath): SchemaRead<never> {
  return { ok: false, refusal, path };
}

/** The first tool part, as the rows arrived, whose name the registry does not hold. */
function unregisteredToolPart(
  messages: readonly UnparsedWireValue[],
  tools: ToolSet,
): SchemaPath | undefined {
  for (const [messageIndex, message] of messages.entries()) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const [partIndex, part] of message.parts.entries()) {
      if (!isRecord(part) || !isWireString(part.type)) continue;
      const path: SchemaPath = [messageIndex, "parts", partIndex, "type"];
      if (part.type === DYNAMIC_TOOL_PART_TYPE) return path;
      if (!part.type.startsWith(TOOL_PART_TYPE_PREFIX)) continue;
      if (!Object.hasOwn(tools, part.type.slice(TOOL_PART_TYPE_PREFIX.length))) return path;
    }
  }
  return undefined;
}

/** The first part a stored row may not carry: a converted dynamic part, or a tool state outside the set. */
function refusedPart(
  parts: readonly UIMessagePart<UIDataTypes, UITools>[],
): SchemaPath | undefined {
  for (const [partIndex, part] of parts.entries()) {
    if (part.type === DYNAMIC_TOOL_PART_TYPE) return ["parts", partIndex, "input"];
    if (isStaticToolUIPart(part) && !isStoredToolPart(part)) return ["parts", partIndex, "state"];
  }
  return undefined;
}

/** A validated row typed by its role, its metadata read under that role's schema. */
function readStoredMessage(message: ValidatedMessage): SchemaRead<StoredUIMessage> {
  const part = refusedPart(message.parts);
  if (part) return refuse(SCHEMA_REFUSAL.MALFORMED, part);
  const { id, parts } = message;
  const metadata = unparsedWire(message.metadata);
  switch (message.role) {
    case MESSAGE_ROLE.USER: {
      const read = USER_MESSAGE_METADATA.read(metadata);
      if (!read.ok) return refuse(read.refusal, ["metadata", ...read.path]);
      return { ok: true, value: { id, role: message.role, parts, metadata: read.value } };
    }
    case MESSAGE_ROLE.ASSISTANT: {
      const read = ASSISTANT_MESSAGE_METADATA.read(metadata);
      if (!read.ok) return refuse(read.refusal, ["metadata", ...read.path]);
      return { ok: true, value: { id, role: message.role, parts, metadata: read.value } };
    }
    case MESSAGE_ROLE.SYSTEM:
      if (metadata !== undefined) return refuse(SCHEMA_REFUSAL.MALFORMED, ["metadata"]);
      return { ok: true, value: { id, role: message.role, parts } };
  }
}

/**
 * Reads stored rows back under the vocabulary: the SDK's own structural
 * validation and the registered tools' schemas, then this build's metadata by
 * role and its tool-state set. The registry is the catalog's `tool()`
 * declarations keyed by the name a part spells. Nothing here throws at a
 * value; a refusal is the same word and path a wire schema answers with, so a
 * store can tell a malformed row from one naming a tool this build no longer
 * registers.
 */
export async function readStoredUIMessages(
  messages: UnparsedWireValue,
  tools: ToolSet,
): Promise<SchemaRead<StoredUIMessage[]>> {
  if (!Array.isArray(messages)) return refuse(SCHEMA_REFUSAL.MALFORMED, []);
  const unregistered = unregisteredToolPart(messages, tools);
  if (unregistered) return refuse(SCHEMA_REFUSAL.NOT_REGISTERED, unregistered);
  const validated = await safeValidateUIMessages<ValidatedMessage>({
    messages,
    // SAFETY: the SDK types this option for a message whose tool set is known statically, and a
    // concrete `tool()` is not assignable to its `Tool<unknown, unknown>` (vercel/ai#9147); the
    // validation itself reads each registered tool's schemas by name, which is what a `ToolSet` is.
    tools: tools as ValidationOptions["tools"],
  });
  if (!validated.success) return refuse(SCHEMA_REFUSAL.MALFORMED, []);
  const stored: StoredUIMessage[] = [];
  for (const [messageIndex, message] of validated.data.entries()) {
    const read = readStoredMessage(message);
    if (!read.ok) return refuse(read.refusal, [messageIndex, ...read.path]);
    stored.push(read.value);
  }
  return { ok: true, value: stored };
}
