import { CLAUDE_CODE_TOOL, claudeCodeWorkspaceTool } from "@repo/features/agent-tools";
import { redactCredentials } from "@repo/features/credential-redaction";
import { integrationOfRemoteTool } from "@repo/features/integration-wire";
import type { ToolCallSettlement } from "@repo/features/turn-run";
import { type UnparsedWireValue, type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Predicate, Schema } from "effect";
import { storedServerCall } from "../../integrations/connection-tools.js";
import {
  NATIVE_MOMENT,
  type NativeContextUsage,
  type NativeHeld,
  type NativeMoment,
  PLAN_STATUS,
} from "./native-moments.js";
import {
  FAILURE_CHARS,
  PICTURE_STAND_IN,
  runnerMoments,
  toolAnswerSettlement,
} from "./runner-moments.js";

const TextBlockSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const ThinkingBlockSchema = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
});
const ToolUseBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: WireValueSchema,
});
const ToolResultBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(WireValueSchema)])),
  is_error: Schema.optionalKey(Schema.Boolean),
});

const readTextBlock = Schema.decodeUnknownOption(TextBlockSchema);
const readThinkingBlock = Schema.decodeUnknownOption(ThinkingBlockSchema);
const readToolUseBlock = Schema.decodeUnknownOption(ToolUseBlockSchema);
const readToolResultBlock = Schema.decodeUnknownOption(ToolResultBlockSchema);

const readEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    subtype: Schema.optionalKey(Schema.String),
    parent_tool_use_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

const readInit = Schema.decodeUnknownOption(Schema.Struct({ session_id: Schema.String }));

const COUNT = Schema.optionalKey(Schema.NullOr(Schema.Number));

const MessageUsageSchema = Schema.Struct({
  input_tokens: COUNT,
  output_tokens: COUNT,
  cache_read_input_tokens: COUNT,
  cache_creation_input_tokens: COUNT,
});

const readAssistant = Schema.decodeUnknownOption(
  Schema.Struct({
    error: Schema.optionalKey(Schema.String),
    message: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      content: Schema.Array(WireValueSchema),
      usage: Schema.optionalKey(Schema.NullOr(MessageUsageSchema)),
    }),
  }),
);

const readUser = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
    }),
    tool_use_result: Schema.optionalKey(Schema.Unknown),
  }),
);

const AGENT_ASYNC_LAUNCHED = "async_launched";

const readAgentOutputStatus = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

const AGENT_LAUNCHED_WORDS = "Async agent launched";

const readTaskNotification = Schema.decodeUnknownOption(
  Schema.Struct({
    tool_use_id: Schema.optionalKey(Schema.String),
    status: Schema.String,
    summary: Schema.optionalKey(Schema.String),
  }),
);

const TASK_COMPLETED = "completed";

const readStreamEvent = Schema.decodeUnknownOption(
  Schema.Struct({
    event: Schema.Struct({
      type: Schema.String,
      message: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
      delta: Schema.optionalKey(
        Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
      ),
    }),
  }),
);

const ResultSchema = Schema.Struct({
  subtype: Schema.String,
  is_error: Schema.optionalKey(Schema.Boolean),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
  api_error_status: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  result: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(MessageUsageSchema),
});

const readResult = Schema.decodeUnknownOption(ResultSchema);

const readRateLimit = Schema.decodeUnknownOption(
  Schema.Struct({
    rate_limit_info: Schema.Struct({
      status: Schema.String,
      rateLimitType: Schema.optionalKey(Schema.String),
      resetsAt: Schema.optionalKey(Schema.Number),
    }),
  }),
);

const SDK_MESSAGE = {
  SYSTEM: "system",
  ASSISTANT: "assistant",
  USER: "user",
  STREAM_EVENT: "stream_event",
  RESULT: "result",
  RATE_LIMIT: "rate_limit_event",
} as const;

const SYSTEM_SUBTYPE = {
  INIT: "init",
  COMPACT_BOUNDARY: "compact_boundary",
  TASK_NOTIFICATION: "task_notification",
} as const;

const RATE_LIMIT_REFUSED = "rejected";

const CREDENTIAL_REFUSED: ReadonlySet<string> = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
]);

const MCP_TOOL_PREFIX = "mcp__";
const MCP_SERVER_SEPARATOR = "__";

function storedClaudeCodeCall(
  callId: string,
  name: string,
  input: WireValue,
): { readonly name: string; readonly input: UnparsedWireValue } {
  const workspaceTool = claudeCodeWorkspaceTool(name);
  if (workspaceTool !== undefined) return { name: workspaceTool, input };
  if (!name.startsWith(MCP_TOOL_PREFIX)) return { name, input };
  const named = name.slice(MCP_TOOL_PREFIX.length);
  const separator = named.indexOf(MCP_SERVER_SEPARATOR);
  const integration =
    separator < 0
      ? undefined
      : storedServerCall(
          named.slice(0, separator),
          named.slice(separator + MCP_SERVER_SEPARATOR.length),
          input,
          callId,
        );
  return integration ?? { name, input };
}

const CLI_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(CLAUDE_CODE_TOOL));

function answerText(content: string | readonly WireValue[] | undefined, pictures: boolean): string {
  if (content === undefined) return "";
  if (Predicate.isString(content)) return content;
  return content
    .flatMap((block) =>
      Option.match(readTextBlock(block), {
        onSome: ({ text }) => [text],
        onNone: () => (pictures ? [PICTURE_STAND_IN] : []),
      }),
    )
    .join("\n");
}

function settlementOf(
  storedName: string,
  content: string | readonly WireValue[] | undefined,
  isError: boolean,
): ToolCallSettlement {
  const workspaceTool =
    !CLI_TOOL_NAMES.has(storedName) && integrationOfRemoteTool(storedName) === undefined;
  const text = answerText(content, !workspaceTool);
  return workspaceTool
    ? toolAnswerSettlement({ workspaceTool: true, text }, isError)
    : toolAnswerSettlement({ workspaceTool: false, text, output: text }, isError);
}

function contextOf(usage: typeof MessageUsageSchema.Type): NativeContextUsage {
  const cachedInputTokens = counted(usage.cache_read_input_tokens);
  const cacheWriteTokens = counted(usage.cache_creation_input_tokens);
  return {
    inputTokens: counted(usage.input_tokens) + cachedInputTokens + cacheWriteTokens,
    outputTokens: counted(usage.output_tokens),
    cachedInputTokens,
    cacheWriteTokens,
  };
}

function assistantMoments(message: WireValue): readonly NativeMoment[] {
  const read = readAssistant(message);
  if (Option.isNone(read)) return [];
  const { id, content, usage } = read.value.message;
  const moments: NativeMoment[] = [
    id === undefined ? { kind: NATIVE_MOMENT.STEP } : { kind: NATIVE_MOMENT.STEP, key: id },
  ];
  if (usage !== undefined && usage !== null) {
    moments.push({ kind: NATIVE_MOMENT.CONTEXT, usage: contextOf(usage) });
  }
  const { error } = read.value;
  if (error !== undefined && CREDENTIAL_REFUSED.has(error)) {
    moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.INVALID });
  }
  for (const block of content) {
    const text = readTextBlock(block);
    if (Option.isSome(text)) {
      moments.push({ kind: NATIVE_MOMENT.TEXT, text: text.value.text });
      continue;
    }
    const thinking = readThinkingBlock(block);
    if (Option.isSome(thinking)) {
      if (thinking.value.thinking.trim().length > 0) {
        moments.push({ kind: NATIVE_MOMENT.REASONING, text: thinking.value.thinking });
      }
      continue;
    }
    const call = readToolUseBlock(block);
    if (Option.isSome(call)) {
      const { id, name, input } = call.value;
      moments.push({
        kind: NATIVE_MOMENT.TOOL_STARTED,
        callId: id,
        ...storedClaudeCodeCall(id, name, input),
      });
    }
  }
  return moments;
}

function backgrounded(
  toolUseResult: unknown,
  content: string | readonly WireValue[] | undefined,
): boolean {
  const status = Option.map(readAgentOutputStatus(toolUseResult), (output) => output.status);
  if (Option.isSome(status)) return status.value === AGENT_ASYNC_LAUNCHED;
  return answerText(content, false).trimStart().startsWith(AGENT_LAUNCHED_WORDS);
}

function userMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const read = readUser(message);
  if (Option.isNone(read)) return [];
  const { content } = read.value.message;
  if (Predicate.isString(content)) return [];
  const moments: NativeMoment[] = [];
  for (const block of content) {
    const answer = readToolResultBlock(block);
    if (Option.isNone(answer)) continue;
    const name = held.callName(answer.value.tool_use_id);
    if (name === undefined) continue;
    if (
      name === CLAUDE_CODE_TOOL.AGENT &&
      answer.value.is_error !== true &&
      backgrounded(read.value.tool_use_result, answer.value.content)
    ) {
      const callId = answer.value.tool_use_id;
      moments.push({ kind: NATIVE_MOMENT.SUBAGENT_RUNNING, callId, key: callId });
      continue;
    }
    moments.push({
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId: answer.value.tool_use_id,
      settlement: settlementOf(name, answer.value.content, answer.value.is_error === true),
    });
  }
  return moments.length === 0 ? [] : [...moments, { kind: NATIVE_MOMENT.STEP_CLOSED }];
}

function streamMoments(message: WireValue): readonly NativeMoment[] {
  const read = readStreamEvent(message);
  if (Option.isNone(read)) return [];
  const { type, message: started, delta } = read.value.event;
  if (type === "message_start" && started !== undefined) {
    return [{ kind: NATIVE_MOMENT.STEP, key: started.id }];
  }
  if (type === "content_block_delta" && delta?.type === "text_delta" && delta.text !== undefined) {
    return [{ kind: NATIVE_MOMENT.STEP }, { kind: NATIVE_MOMENT.TEXT_DELTA, text: delta.text }];
  }
  return [];
}

function counted(value: number | null | undefined): number {
  return value ?? 0;
}

function failureOf(result: typeof ResultSchema.Type): string {
  const { subtype, api_error_status, errors, result: said } = result;
  const status =
    api_error_status === undefined || api_error_status === null ? [] : [String(api_error_status)];
  const words = [subtype, ...status, ...(errors ?? [])].join(" ");
  const failure = said === undefined || said.trim() === "" ? words : `${words}: ${said}`;
  return redactCredentials(failure).slice(0, FAILURE_CHARS);
}

function resultMoments(message: WireValue): readonly NativeMoment[] {
  const read = readResult(message);
  if (Option.isNone(read)) return [{ kind: NATIVE_MOMENT.RESULT }];
  const { is_error, usage } = read.value;
  const moments: NativeMoment[] = [];
  if (usage !== undefined) {
    const cachedInputTokens = counted(usage.cache_read_input_tokens);
    const cacheWriteTokens = counted(usage.cache_creation_input_tokens);
    moments.push({
      kind: NATIVE_MOMENT.USAGE,
      usage: {
        inputTokens: counted(usage.input_tokens) + cachedInputTokens + cacheWriteTokens,
        outputTokens: counted(usage.output_tokens),
        cachedInputTokens,
        reasoningTokens: 0,
        cacheWriteTokens,
      },
    });
  }
  const failed = is_error === true;
  moments.push(
    failed
      ? { kind: NATIVE_MOMENT.RESULT, failure: failureOf(read.value) }
      : { kind: NATIVE_MOMENT.RESULT },
  );
  if (!failed) moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.VERIFIED });
  moments.push({ kind: NATIVE_MOMENT.STEP_CLOSED });
  return moments;
}

function rateLimitMoments(message: WireValue): readonly NativeMoment[] {
  const read = readRateLimit(message);
  if (Option.isNone(read)) return [];
  const { status, rateLimitType, resetsAt } = read.value.rate_limit_info;
  const resetsAtMs = resetsAt === undefined ? undefined : resetsAt * 1000;
  const words = [`rate_limit_${status}`];
  if (rateLimitType !== undefined) words.push(rateLimitType);
  if (resetsAtMs !== undefined) words.push(`resets ${new Date(resetsAtMs).toISOString()}`);
  const refused = status === RATE_LIMIT_REFUSED;
  return [
    {
      kind: NATIVE_MOMENT.RATE_LIMIT,
      refused,
      detail: words.join(" "),
      ...(refused && resetsAtMs !== undefined ? { resetsAt: resetsAtMs } : undefined),
    },
    ...(refused ? [{ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED } as const] : []),
  ];
}

function taskNotificationMoments(message: WireValue): readonly NativeMoment[] {
  const read = readTaskNotification(message);
  if (Option.isNone(read) || read.value.tool_use_id === undefined) return [];
  const { tool_use_id, status, summary } = read.value;
  const text = summary === undefined || summary.trim() === "" ? status : summary;
  return [
    {
      kind: NATIVE_MOMENT.SUBAGENT_ENDED,
      key: tool_use_id,
      settlement: toolAnswerSettlement(
        { workspaceTool: false, text, output: text },
        status !== TASK_COMPLETED,
      ),
    },
  ];
}

function systemMoments(subtype: string | undefined, message: WireValue): readonly NativeMoment[] {
  switch (subtype) {
    case SYSTEM_SUBTYPE.INIT:
      return [
        ...Option.match(readInit(message), {
          onSome: ({ session_id }): readonly NativeMoment[] => [
            { kind: NATIVE_MOMENT.SESSION, sessionId: session_id },
          ],
          onNone: () => [],
        }),
        { kind: NATIVE_MOMENT.ACTIVE },
      ];
    case SYSTEM_SUBTYPE.COMPACT_BOUNDARY:
      return [{ kind: NATIVE_MOMENT.COMPACTED }];
    case SYSTEM_SUBTYPE.TASK_NOTIFICATION:
      return taskNotificationMoments(message);
    default:
      return [];
  }
}

export function claudeCodeMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const own = runnerMoments(message);
  if (Option.isSome(own)) return own.value;
  const envelope = readEnvelope(message);
  if (Option.isNone(envelope)) return [];
  const { type, subtype, parent_tool_use_id } = envelope.value;
  if (parent_tool_use_id !== undefined && parent_tool_use_id !== null) return [];
  switch (type) {
    case SDK_MESSAGE.SYSTEM:
      return systemMoments(subtype, message);
    case SDK_MESSAGE.ASSISTANT:
      return assistantMoments(message);
    case SDK_MESSAGE.USER:
      return userMoments(message, held);
    case SDK_MESSAGE.STREAM_EVENT:
      return streamMoments(message);
    case SDK_MESSAGE.RESULT:
      return resultMoments(message);
    case SDK_MESSAGE.RATE_LIMIT:
      return rateLimitMoments(message);
    default:
      return [];
  }
}
