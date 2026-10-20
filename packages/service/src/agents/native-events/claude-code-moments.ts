import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@luke/agent-runner/protocol";
import { CLAUDE_CODE_LUKE_TOOL_PREFIX, CLAUDE_CODE_TOOL } from "@luke/features/agent-tools";
import {
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  toolCallSettlementOf,
} from "@luke/features/brain";
import { redactCredentials } from "@luke/features/credential-redaction";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { Option, Predicate, Schema } from "effect";
import { NATIVE_ENDING, NATIVE_MOMENT, type NativeMoment } from "./native-moments.js";

/**
 * claude-code-moments.ts -- Claude Code's SDK messages, as its runner posts them, read as the moments of a native run.
 *
 * Each message the pinned Agent SDK emits (`@anthropic-ai/claude-agent-sdk`'s
 * `SDKMessage`) and each of the runner's own (`@luke/agent-runner/protocol`)
 * is read here for what the transcript keeps: a model call's answer is a
 * step, its text and thinking blocks its words and reasoning, its
 * `tool_use` blocks its calls, the `tool_result` blocks of the next user
 * message their answers, and a `result` the end of one model turn with its
 * usage. With `includePartialMessages` the words also arrive token by token
 * as `stream_event`s, which draft the step before its whole message lands.
 * A message from inside a subagent names the `Agent` call it runs under
 * (`parent_tool_use_id`) and is folded under that call: the call and its
 * answer stand in the transcript, its inner work does not. A call to Luke's
 * own MCP server is named as Luke's tool (`mcp__luke__read_inbox` is
 * `read_inbox`) and its answer read as the JSON that tool answers; every
 * other call keeps the CLI's own name and its answer the text the model
 * read. Each shape is read with a schema of the fields this reads alone, so
 * a field the SDK adds changes nothing here, and a message no schema fits
 * is no moment.
 */

/** What a picture in a tool's answer is kept as: the bytes went to the model once, and a transcript carries every byte it holds into each read. */
const PICTURE_STAND_IN = "[image]";

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

const readAssistant = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      content: Schema.Array(WireValueSchema),
    }),
  }),
);

const readUser = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
    }),
  }),
);

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

const COUNT = Schema.optionalKey(Schema.NullOr(Schema.Number));
const readResult = Schema.decodeUnknownOption(
  Schema.Struct({
    subtype: Schema.String,
    is_error: Schema.optionalKey(Schema.Boolean),
    errors: Schema.optionalKey(Schema.Array(Schema.String)),
    usage: Schema.optionalKey(
      Schema.Struct({
        input_tokens: COUNT,
        output_tokens: COUNT,
        cache_read_input_tokens: COUNT,
        cache_creation_input_tokens: COUNT,
      }),
    ),
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

const readAccepted = Schema.decodeUnknownOption(Schema.Struct({ uuid: Schema.String }));

const readEnd = Schema.decodeUnknownOption(
  Schema.Struct({
    reason: Schema.Literals(Object.values(RUNNER_END)),
    detail: Schema.optionalKey(Schema.String),
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

const SYSTEM_SUBTYPE = { INIT: "init", COMPACT_BOUNDARY: "compact_boundary" } as const;

/** The limit status that refuses the plan's calls, as `SDKRateLimitInfo` spells it. */
const RATE_LIMIT_REFUSED = "rejected";

/** How long the turn's record keeps a failure the CLI reported, inside the writer's own bound. */
const FAILURE_CHARS = 300;

/** The name a call is stored under: Luke's tool's own for a call to Luke's MCP server, the CLI's otherwise. */
function storedClaudeCodeToolName(name: string): string {
  return name.startsWith(CLAUDE_CODE_LUKE_TOOL_PREFIX)
    ? name.slice(CLAUDE_CODE_LUKE_TOOL_PREFIX.length)
    : name;
}

const CLI_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(CLAUDE_CODE_TOOL));

/** The name of a call the projection holds, by its id; nothing for a call it does not hold. */
export type HeldCallName = (callId: string) => string | undefined;

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
  const lukeTool = !CLI_TOOL_NAMES.has(storedName);
  const text = answerText(content, !lukeTool);
  const output: UnparsedWireValue = lukeTool ? valueFromJsonText(text) : text;
  if (isError) {
    return {
      state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
      output,
      errorText: text,
      status: ACTION_RESULT_STATUS.REJECTED,
    };
  }
  if (!lukeTool) return toolCallSettlementOf(JSON.stringify(text), undefined);
  const status = isRecord(output) && isWireString(output.status) ? output.status : undefined;
  return toolCallSettlementOf(text, status);
}

/** A model call's answer, or the one block of it the SDK streams as a message: a step, and its words, reasoning, and calls. */
function assistantMoments(message: WireValue): readonly NativeMoment[] {
  const read = readAssistant(message);
  if (Option.isNone(read)) return [];
  const { id, content } = read.value.message;
  const moments: NativeMoment[] = [
    id === undefined ? { kind: NATIVE_MOMENT.STEP } : { kind: NATIVE_MOMENT.STEP, key: id },
  ];
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
      moments.push({
        kind: NATIVE_MOMENT.TOOL_STARTED,
        callId: call.value.id,
        name: storedClaudeCodeToolName(call.value.name),
        input: call.value.input,
      });
    }
  }
  return moments;
}

/** The tools' answers a user message carries, each settling the call the projection holds; the step that asked for them is over. */
function userMoments(message: WireValue, heldCallName: HeldCallName): readonly NativeMoment[] {
  const read = readUser(message);
  if (Option.isNone(read)) return [];
  const { content } = read.value.message;
  if (Predicate.isString(content)) return [];
  const moments: NativeMoment[] = [];
  for (const block of content) {
    const answer = readToolResultBlock(block);
    if (Option.isNone(answer)) continue;
    const name = heldCallName(answer.value.tool_use_id);
    if (name === undefined) continue;
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
  moments.push({ kind: NATIVE_MOMENT.STEP_CLOSED });
  return moments;
}

/** The plan's limit as the CLI reports it: refused or not, and which limit and when it resets. */
function rateLimitMoments(message: WireValue): readonly NativeMoment[] {
  const read = readRateLimit(message);
  if (Option.isNone(read)) return [];
  const { status, rateLimitType, resetsAt } = read.value.rate_limit_info;
  const words = [`rate_limit_${status}`];
  if (rateLimitType !== undefined) words.push(rateLimitType);
  // Note that the SDK counts the reset in seconds since the epoch.
  if (resetsAt !== undefined) words.push(`resets ${new Date(resetsAt * 1000).toISOString()}`);
  return [
    {
      kind: NATIVE_MOMENT.RATE_LIMIT,
      refused: status === RATE_LIMIT_REFUSED,
      detail: words.join(" "),
    },
  ];
}

/** How each of the runner's endings reads on the turn. */
const ENDING_OF_RUNNER_END = {
  [RUNNER_END.TURN_ENDED]: NATIVE_ENDING.DONE,
  [RUNNER_END.STOPPED]: NATIVE_ENDING.STOPPED,
  [RUNNER_END.INPUT_CLOSED]: NATIVE_ENDING.FAILED,
  [RUNNER_END.FAILED]: NATIVE_ENDING.FAILED,
} as const satisfies Record<RunnerEnd, (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING]>;

function endMoments(message: WireValue): readonly NativeMoment[] {
  const read = readEnd(message);
  if (Option.isNone(read)) return [];
  const { reason, detail } = read.value;
  const said = detail === undefined ? reason : `${reason} ${detail}`;
  return [
    {
      kind: NATIVE_MOMENT.ENDED,
      ending: ENDING_OF_RUNNER_END[reason],
      ...(reason === RUNNER_END.TURN_ENDED || reason === RUNNER_END.STOPPED
        ? undefined
        : { detail: redactCredentials(said).slice(0, FAILURE_CHARS) }),
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
    default:
      return [];
  }
}

/**
 * One message the runner posted, as the moments of the run: nothing for a
 * message of a subagent, which its `Agent` call stands for, or of a type the
 * transcript keeps nothing of. `heldCallName` names the calls the projection
 * holds, so an answer settles a call the transcript holds and is read as
 * that tool answers.
 */
export function claudeCodeMoments(
  message: WireValue,
  heldCallName: HeldCallName,
): readonly NativeMoment[] {
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
      return userMoments(message, heldCallName);
    case SDK_MESSAGE.STREAM_EVENT:
      return streamMoments(message);
    case SDK_MESSAGE.RESULT:
      return resultMoments(message);
    case SDK_MESSAGE.RATE_LIMIT:
      return rateLimitMoments(message);
    case RUNNER_EVENT.ACCEPTED:
      return Option.match(readAccepted(message), {
        onSome: ({ uuid }): readonly NativeMoment[] => [
          { kind: NATIVE_MOMENT.LINE_ACCEPTED, clientId: uuid },
        ],
        onNone: () => [],
      });
    case RUNNER_EVENT.WAITING:
      return [{ kind: NATIVE_MOMENT.WAITING }];
    case RUNNER_EVENT.END:
      return endMoments(message);
    default:
      return [];
  }
}
