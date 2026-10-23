import { CLAUDE_CODE_LUKE_TOOL_PREFIX, CLAUDE_CODE_TOOL } from "@luke/features/agent-tools";
import type { ToolCallSettlement } from "@luke/features/brain";
import { redactCredentials } from "@luke/features/credential-redaction";
import { integrationOfRemoteTool } from "@luke/features/integration-wire";
import { type UnparsedWireValue, type WireValue, WireValueSchema } from "@luke/wire";
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

/**
 * claude-code-moments.ts -- Claude Code's SDK messages, as its runner posts them, read as the moments of a native run.
 *
 * Each message the pinned Agent SDK emits (`@anthropic-ai/claude-agent-sdk`'s
 * `SDKMessage`) is read here, and each of the runner's own as every
 * harness's is (`runner-moments.ts`), for what the transcript keeps: a model call's answer is a
 * step, its text and thinking blocks its words and reasoning, its
 * `tool_use` blocks its calls, the `tool_result` blocks of the next user
 * message their answers, and a `result` the end of one model turn with its
 * usage. With `includePartialMessages` the words also arrive token by token
 * as `stream_event`s, which draft the step before its whole message lands.
 * A message from inside a subagent names the `Agent` call it runs under
 * (`parent_tool_use_id`) and is folded under that call: the call and its
 * answer stand in the transcript, its inner work does not. A subagent the
 * CLI runs in the background, as it does by default, answers its call at
 * once with words that say only that it launched, so that call is kept
 * open instead and settled by the task notification its end posts. A call to Luke's
 * own MCP server is named as Luke's tool (`mcp__luke__read_inbox` is
 * `read_inbox`) and its answer read as the JSON that tool answers; a call
 * to an integration's own server (`mcp__linear__list_issues`) is stored as
 * eve's call of that integration's tool is, so it draws with the service's
 * mark and the tool's own name; every other call keeps the CLI's own name,
 * and it and an integration's call keep as their answer the text the model
 * read. A turn also says how it found the plan that pays: a `result` that
 * is no error ran on it, an answer the CLI flags `authentication_failed`
 * (a setup-token revoked, expired, or never one) refused it, and a
 * rejected `rate_limit_event` is its limit reached, until the reset the
 * CLI names. Each shape is read with a schema of the fields this reads alone, so
 * a field the SDK adds changes nothing here, and a message no schema fits
 * is no moment.
 */

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

/** The fields every message read here has: its type, its subtype where it has one, and the subagent call it runs under. */
const readEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    subtype: Schema.optionalKey(Schema.String),
    parent_tool_use_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

const readInit = Schema.decodeUnknownOption(Schema.Struct({ session_id: Schema.String }));

const COUNT = Schema.optionalKey(Schema.NullOr(Schema.Number));

/** A model call's usage as the Messages API counts it: the input apart from what the prefix cache read and wrote. */
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

/** The status a subagent call's structured answer (`AgentOutput`) says its subagent went on in the background with. */
const AGENT_ASYNC_LAUNCHED = "async_launched";

const readAgentOutputStatus = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

/**
 * The words a backgrounded subagent call's answer opens with, the text the
 * model reads in place of an answer: read where the structured answer is
 * missing, so Claude Code's internal metadata never stands as the answer.
 */
const AGENT_LAUNCHED_WORDS = "Async agent launched";

const readTaskNotification = Schema.decodeUnknownOption(
  Schema.Struct({
    tool_use_id: Schema.optionalKey(Schema.String),
    status: Schema.String,
    summary: Schema.optionalKey(Schema.String),
  }),
);

/** The status a task's notification says it ran to its end with, as `SDKTaskNotificationMessage` spells it; `failed` and `stopped` did not. */
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

const readResult = Schema.decodeUnknownOption(
  Schema.Struct({
    subtype: Schema.String,
    is_error: Schema.optionalKey(Schema.Boolean),
    errors: Schema.optionalKey(Schema.Array(Schema.String)),
    usage: Schema.optionalKey(MessageUsageSchema),
  }),
);

const readRateLimit = Schema.decodeUnknownOption(
  Schema.Struct({
    rate_limit_info: Schema.Struct({
      status: Schema.String,
      rateLimitType: Schema.optionalKey(Schema.String),
      resetsAt: Schema.optionalKey(Schema.Number),
    }),
  }),
);

/** The SDK's message types read here, as it spells them. */
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

/** The limit status that refuses the plan's calls, as `SDKRateLimitInfo` spells it. */
const RATE_LIMIT_REFUSED = "rejected";

/**
 * The errors an answer carries that say the provider refused the plan's
 * credential, as `SDKAssistantMessageError` spells them: the token was
 * refused, or its organization may not use Claude Code. Either is mended
 * only by a new setup-token.
 */
const CREDENTIAL_REFUSED: ReadonlySet<string> = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
]);

/** What Claude Code puts before any MCP server's tool, the server's name and `__` following it (`mcp__linear__list_issues`). */
const MCP_TOOL_PREFIX = "mcp__";
const MCP_SERVER_SEPARATOR = "__";

/**
 * The name and input a call is stored under: Luke's tool's own for a call
 * to Luke's MCP server; for a call to an integration's own server, its
 * integration's fixed name and envelope, as eve's nested call of the tool is
 * stored (`storedServerCall`); the CLI's otherwise.
 */
function storedClaudeCodeCall(
  callId: string,
  name: string,
  input: WireValue,
): { readonly name: string; readonly input: UnparsedWireValue } {
  if (name.startsWith(CLAUDE_CODE_LUKE_TOOL_PREFIX)) {
    return { name: name.slice(CLAUDE_CODE_LUKE_TOOL_PREFIX.length), input };
  }
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

/** A tool's answer as the text the model read: its text blocks joined, a picture standing in for its bytes where `pictures` asks, and left out otherwise. */
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

/**
 * A tool's answer as the transcript settles its call: an error the CLI
 * flagged is a refusal carrying the text, and any other answer is available,
 * kept as the text a CLI tool answered, or read as the JSON a tool of Luke's
 * MCP server answers, so its status word counts as the eve relay counts it.
 * A CLI tool's pictures stand in as `[image]`; a Luke tool's pictures are left
 * out, as eve's relay leaves out a look's picture, so its JSON still reads.
 */
function settlementOf(
  storedName: string,
  content: string | readonly WireValue[] | undefined,
  isError: boolean,
): ToolCallSettlement {
  const lukeTool =
    !CLI_TOOL_NAMES.has(storedName) && integrationOfRemoteTool(storedName) === undefined;
  const text = answerText(content, !lukeTool);
  return lukeTool
    ? toolAnswerSettlement({ lukeTool: true, text }, isError)
    : toolAnswerSettlement({ lukeTool: false, text, output: text }, isError);
}

/**
 * What one model call read and wrote, as the context ring reads it. Note
 * that the input the provider counts excludes what the prefix cache read and
 * what was written to it, while the ring's input counts both, as eve's does.
 */
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

/** A model call's answer, or the one block of it the SDK streams as a message: a step, and its words, reasoning, and calls. */
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

/**
 * Whether a subagent call's answer says its subagent went on in the
 * background: the structured answer's status where the message carries it,
 * or the words the model reads in its place.
 */
function backgrounded(
  toolUseResult: unknown,
  content: string | readonly WireValue[] | undefined,
): boolean {
  const status = Option.map(readAgentOutputStatus(toolUseResult), (output) => output.status);
  if (Option.isSome(status)) return status.value === AGENT_ASYNC_LAUNCHED;
  return answerText(content, false).trimStart().startsWith(AGENT_LAUNCHED_WORDS);
}

/**
 * The tools' answers a user message carries, each settling the call the
 * projection holds; the step that asked for them is over. A subagent call
 * whose subagent went on in the background is not settled by its answer,
 * which says only that it launched: it stays open until the subagent's
 * task notification (`taskNotificationMoments`), as a delegation's row runs
 * until its worker answers.
 */
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

/** A token of the words while they stream: the step a model call opens, and the piece of its words. */
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

/** A count the SDK left out or nulled, as nothing. */
function counted(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * The end of one model turn: what its main loop cost, and why it failed
 * where it did. Note that the input the provider counts excludes what the
 * prefix cache read and what was written to it, while the record's input
 * counts both, as the price reads it (`model-catalog.ts`).
 */
function resultMoments(message: WireValue): readonly NativeMoment[] {
  const read = readResult(message);
  if (Option.isNone(read)) return [{ kind: NATIVE_MOMENT.RESULT }];
  const { subtype, is_error, errors, usage } = read.value;
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
  const failure = [subtype, ...(errors ?? [])].join(" ");
  moments.push(
    failed
      ? {
          kind: NATIVE_MOMENT.RESULT,
          failure: redactCredentials(failure).slice(0, FAILURE_CHARS),
        }
      : { kind: NATIVE_MOMENT.RESULT },
  );
  // Note that a turn that ran is the plan's answer that it pays, which a limit reached earlier lifts on.
  if (!failed) moments.push({ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.VERIFIED });
  moments.push({ kind: NATIVE_MOMENT.STEP_CLOSED });
  return moments;
}

/** The plan's limit as the CLI reports it: refused or not, and which limit and when it resets. */
function rateLimitMoments(message: WireValue): readonly NativeMoment[] {
  const read = readRateLimit(message);
  if (Option.isNone(read)) return [];
  const { status, rateLimitType, resetsAt } = read.value.rate_limit_info;
  // Note that the SDK counts the reset in seconds since the epoch.
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
    // The limit held first, so the plan's word reads its reset.
    ...(refused ? [{ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.LIMIT_REACHED } as const] : []),
  ];
}

/**
 * A background task's end, which settles the subagent call it ran under
 * where it was one (the projection passes over any other task's): its
 * summary is the answer, and a task that failed or was stopped a refusal.
 */
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
        { lukeTool: false, text, output: text },
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

/**
 * One message the runner posted, as the moments of the run: nothing for a
 * message of a subagent, which its `Agent` call stands for, or of a type the
 * transcript keeps nothing of. `held` names the calls the projection
 * holds, so an answer settles a call the transcript holds and is read as
 * that tool answers.
 */
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
