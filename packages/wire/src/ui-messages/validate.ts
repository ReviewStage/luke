import {
  safeValidateUIMessages,
  type ToolSet,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import { Effect, Result } from "effect";
import { readEither, SchemaRefusalError } from "../effect/index.js";
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
} from "../index.js";
import { isStoredToolPart, toolPartName } from "./tool-parts.js";

export type StoredUIMessage =
  | StoredMessageOf<typeof MESSAGE_ROLE.USER, UserMessageMetadata>
  | StoredMessageOf<typeof MESSAGE_ROLE.ASSISTANT, AssistantMessageMetadata>
  | (Omit<UIMessage<never>, "role" | "metadata"> & { role: typeof MESSAGE_ROLE.SYSTEM });

type StoredMessageOf<Role extends UIMessage["role"], Metadata> = Omit<
  UIMessage<Metadata>,
  "role" | "metadata"
> & { role: Role; metadata: Metadata };

type ValidatedMessage = UIMessage<WireBoundaryInput>;

type ValidationOptions = Parameters<typeof safeValidateUIMessages<ValidatedMessage>>[0];

const DYNAMIC_TOOL_PART_TYPE = "dynamic-tool";

export const UNREGISTERED_TOOL_PART = {
  REFUSE: "refuse",
  DROP: "drop",
} as const;

export type UnregisteredToolPart =
  (typeof UNREGISTERED_TOOL_PART)[keyof typeof UNREGISTERED_TOOL_PART];

const readUserMetadata = readEither(USER_MESSAGE_METADATA);
const readAssistantMetadata = readEither(ASSISTANT_MESSAGE_METADATA);

function refuse(
  refusal: SchemaRefusal,
  path: SchemaPath,
): Result.Result<never, SchemaRefusalError> {
  return Result.fail(new SchemaRefusalError({ refusal, path }));
}

function underMetadata<A>(
  read: Result.Result<A, SchemaRefusalError>,
): Result.Result<A, SchemaRefusalError> {
  return Result.mapError(
    read,
    (error) =>
      new SchemaRefusalError({ refusal: error.refusal, path: ["metadata", ...error.path] }),
  );
}

function namesRetiredTool(part: UnparsedWireValue, tools: ToolSet): boolean {
  if (!isRecord(part) || !isWireString(part.type)) return false;
  const name = toolPartName(part.type);
  return name !== undefined && !Object.hasOwn(tools, name);
}

function withoutRetiredToolParts(
  messages: readonly UnparsedWireValue[],
  tools: ToolSet,
): UnparsedWireValue[] {
  return messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.parts)) return message;
    const parts = message.parts.filter((part) => !namesRetiredTool(part, tools));
    return parts.length === message.parts.length ? message : { ...message, parts };
  });
}

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

function readStoredMessage(
  message: ValidatedMessage,
): Result.Result<StoredUIMessage, SchemaRefusalError> {
  const part = refusedPart(message.parts);
  if (part) return refuse(SCHEMA_REFUSAL.MALFORMED, part);
  const { id, parts } = message;
  const metadata = unparsedWire(message.metadata);
  switch (message.role) {
    case MESSAGE_ROLE.USER: {
      const role = message.role;
      return Result.map(underMetadata(readUserMetadata(metadata)), (value) => ({
        id,
        role,
        parts,
        metadata: value,
      }));
    }
    case MESSAGE_ROLE.ASSISTANT: {
      const role = message.role;
      return Result.map(underMetadata(readAssistantMetadata(metadata)), (value) => ({
        id,
        role,
        parts,
        metadata: value,
      }));
    }
    case MESSAGE_ROLE.SYSTEM:
      if (metadata !== undefined) return refuse(SCHEMA_REFUSAL.MALFORMED, ["metadata"]);
      return Result.succeed({ id, role: message.role, parts });
  }
}

function readStoredMessages(
  messages: readonly ValidatedMessage[],
): Result.Result<StoredUIMessage[], SchemaRefusalError> {
  const stored: StoredUIMessage[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    const read = readStoredMessage(message);
    if (Result.isFailure(read)) {
      return Result.fail(
        new SchemaRefusalError({
          refusal: read.failure.refusal,
          path: [messageIndex, ...read.failure.path],
        }),
      );
    }
    stored.push(read.success);
  }
  return Result.succeed(stored);
}

export function readStoredUIMessagesEither(
  rows: UnparsedWireValue,
  tools: ToolSet,
  unregistered: UnregisteredToolPart = UNREGISTERED_TOOL_PART.REFUSE,
): Effect.Effect<Result.Result<StoredUIMessage[], SchemaRefusalError>> {
  if (!Array.isArray(rows)) return Effect.succeed(refuse(SCHEMA_REFUSAL.MALFORMED, []));
  if (rows.length === 0) return Effect.succeed(Result.succeed([]));
  const storedRow = unregistered === UNREGISTERED_TOOL_PART.DROP;
  const messages = storedRow ? withoutRetiredToolParts(rows, tools) : rows;
  const unregisteredPart = unregisteredToolPart(messages, tools);
  if (unregisteredPart) {
    return Effect.succeed(refuse(SCHEMA_REFUSAL.NOT_REGISTERED, unregisteredPart));
  }
  const validated = Effect.promise(() =>
    safeValidateUIMessages<ValidatedMessage>(
      storedRow
        ? { messages }
        : {
            messages,
            tools: tools as NonNullable<ValidationOptions["tools"]>,
          },
    ),
  );
  return Effect.map(validated, (result) =>
    result.success ? readStoredMessages(result.data) : refuse(SCHEMA_REFUSAL.MALFORMED, []),
  );
}

export function readStoredUIMessages(
  messages: UnparsedWireValue,
  tools: ToolSet,
  unregistered: UnregisteredToolPart = UNREGISTERED_TOOL_PART.REFUSE,
): Effect.Effect<SchemaRead<StoredUIMessage[]>> {
  return Effect.map(readStoredUIMessagesEither(messages, tools, unregistered), (read) =>
    Result.match(read, {
      onFailure: ({ refusal, path }) => ({ ok: false, refusal, path }),
      onSuccess: (value) => ({ ok: true, value }),
    }),
  );
}
