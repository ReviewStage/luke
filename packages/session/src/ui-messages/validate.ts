import {
  ASSISTANT_MESSAGE_METADATA,
  type AssistantMessageMetadata,
  effectSchema,
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
import { readEither, SchemaRefusalError } from "@sidecar/wire/effect";
import {
  safeValidateUIMessages,
  type ToolSet,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import { Either } from "effect";
import { isStoredToolPart, toolPartName } from "./tool-parts.js";

/**
 * A stored message as this build reads it back: the SDK's `UIMessage`, with
 * the row's role deciding which metadata it carries. Reading rows back is
 * where a stored shape is held to the vocabulary, and it goes through the
 * SDK's own `validateUIMessages` so the structure a row must have is the
 * SDK's own statement of it, not a second one kept here. What this wrapper
 * adds is what the SDK leaves to its caller: the metadata schema for each
 * role, the refusal of a tool name the catalog did not register, and the
 * refusal of a tool state a stored row never carries. The SDK's own
 * `metadataSchema` option reads one schema for every row regardless of its
 * role, so it cannot stand in for a check that a user row and an assistant
 * row answer to different shapes; the role dispatch below reads each row's
 * metadata against the Effect schema the wire vocabulary's
 * `USER_MESSAGE_METADATA_STANDARD_SCHEMA` and
 * `ASSISTANT_MESSAGE_METADATA_STANDARD_SCHEMA` twins are themselves built
 * from, through `effectSchema` and `readEither`, so the same declaration
 * backs both the SDK-facing Standard Schema and this reader.
 */
export type StoredUIMessage =
  | StoredMessageOf<typeof MESSAGE_ROLE.USER, UserMessageMetadata>
  | StoredMessageOf<typeof MESSAGE_ROLE.ASSISTANT, AssistantMessageMetadata>
  | (Omit<UIMessage<never>, "role" | "metadata"> & { role: typeof MESSAGE_ROLE.SYSTEM });

type StoredMessageOf<Role extends UIMessage["role"], Metadata> = Omit<
  UIMessage<Metadata>,
  "role" | "metadata"
> & { role: Role; metadata: Metadata };

/**
 * What the SDK hands back before the metadata is read: a row it validated
 * structurally, whose metadata it passed through as it came off the wire.
 */
type ValidatedMessage = UIMessage<WireBoundaryInput>;

type ValidationOptions = Parameters<typeof safeValidateUIMessages<ValidatedMessage>>[0];

/**
 * The type the SDK gives a tool part that names no registered tool. The SDK
 * converts an unregistered part that already answered into one of these
 * rather than refusing it, so a stored row is held to the registry before
 * the SDK sees it; one found afterwards is a registered tool whose input the
 * registered schema refused.
 */
const DYNAMIC_TOOL_PART_TYPE = "dynamic-tool";

const readUserMetadata = readEither(effectSchema(USER_MESSAGE_METADATA));
const readAssistantMetadata = readEither(effectSchema(ASSISTANT_MESSAGE_METADATA));

function refuse(
  refusal: SchemaRefusal,
  path: SchemaPath,
): Either.Either<never, SchemaRefusalError> {
  return Either.left(new SchemaRefusalError({ refusal, path }));
}

/** A metadata-shaped refusal read at the row's `metadata` field, rather than at the metadata value's own root. */
function underMetadata<A>(
  read: Either.Either<A, SchemaRefusalError>,
): Either.Either<A, SchemaRefusalError> {
  return Either.mapLeft(
    read,
    (error) =>
      new SchemaRefusalError({ refusal: error.refusal, path: ["metadata", ...error.path] }),
  );
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
      const name = toolPartName(part.type);
      if (name === undefined) continue;
      if (!Object.hasOwn(tools, name)) return path;
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
    if (toolPartName(part.type) !== undefined && !isStoredToolPart(part)) {
      return ["parts", partIndex, "state"];
    }
  }
  return undefined;
}

/** A validated row typed by its role, its metadata read under that role's schema. */
function readStoredMessage(
  message: ValidatedMessage,
): Either.Either<StoredUIMessage, SchemaRefusalError> {
  const part = refusedPart(message.parts);
  if (part) return refuse(SCHEMA_REFUSAL.MALFORMED, part);
  const { id, parts } = message;
  const metadata = unparsedWire(message.metadata);
  switch (message.role) {
    case MESSAGE_ROLE.USER: {
      const role = message.role;
      return Either.map(underMetadata(readUserMetadata(metadata)), (value) => ({
        id,
        role,
        parts,
        metadata: value,
      }));
    }
    case MESSAGE_ROLE.ASSISTANT: {
      const role = message.role;
      return Either.map(underMetadata(readAssistantMetadata(metadata)), (value) => ({
        id,
        role,
        parts,
        metadata: value,
      }));
    }
    case MESSAGE_ROLE.SYSTEM:
      if (metadata !== undefined) return refuse(SCHEMA_REFUSAL.MALFORMED, ["metadata"]);
      return Either.right({ id, role: message.role, parts });
  }
}

/**
 * Reads stored rows back under the vocabulary: the SDK's own structural
 * validation and the registered tools' schemas, then this build's metadata by
 * role and its tool-state set. The registry is the catalog's `tool()`
 * declarations keyed by the name a part spells. A refusal is the same word
 * and path a wire schema answers with, so a store can tell a malformed row
 * from one naming a tool this build no longer registers. A conversation with
 * no rows yet reads as no messages: the SDK refuses an empty array, and an
 * empty conversation is not a malformed one.
 */
export async function readStoredUIMessagesEither(
  messages: UnparsedWireValue,
  tools: ToolSet,
): Promise<Either.Either<StoredUIMessage[], SchemaRefusalError>> {
  if (!Array.isArray(messages)) return refuse(SCHEMA_REFUSAL.MALFORMED, []);
  if (messages.length === 0) return Either.right([]);
  const unregistered = unregisteredToolPart(messages, tools);
  if (unregistered) return refuse(SCHEMA_REFUSAL.NOT_REGISTERED, unregistered);
  const validated = await safeValidateUIMessages<ValidatedMessage>({
    messages,
    // SAFETY: the SDK types this option for a message whose tool set is known statically, and a
    // concrete `tool()` is not assignable to its `Tool<unknown, unknown>` (vercel/ai#9147); the
    // validation itself reads each registered tool's schemas by name, which is what a `ToolSet` is.
    tools: tools as NonNullable<ValidationOptions["tools"]>,
  });
  if (!validated.success) return refuse(SCHEMA_REFUSAL.MALFORMED, []);
  const stored: StoredUIMessage[] = [];
  for (const [messageIndex, message] of validated.data.entries()) {
    const read = readStoredMessage(message);
    if (Either.isLeft(read)) {
      return Either.left(
        new SchemaRefusalError({
          refusal: read.left.refusal,
          path: [messageIndex, ...read.left.path],
        }),
      );
    }
    stored.push(read.right);
  }
  return Either.right(stored);
}

/** The strangler-shim entry point every store caller still holds a `SchemaRead` for. */
export async function readStoredUIMessages(
  messages: UnparsedWireValue,
  tools: ToolSet,
): Promise<SchemaRead<StoredUIMessage[]>> {
  return Either.match(await readStoredUIMessagesEither(messages, tools), {
    onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
    onRight: (value) => ({ ok: true, value }),
  });
}
