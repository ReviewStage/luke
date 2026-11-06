import { CODEX_ERROR_INFO, codexErrorKind } from "@repo/agent-runner/protocol";
import { CODEX_TOOL, WORKSPACE_MCP_SERVER_NAMES } from "@repo/features/agent-tools";
import { redactCredentials } from "@repo/features/credential-redaction";
import { type UnparsedWireValue, type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Predicate, Schema } from "effect";
import { storedServerCall } from "../../integrations/connection-tools.js";
import {
  NATIVE_MOMENT,
  type NativeHeld,
  type NativeMoment,
  PLAN_STATUS,
  type PlanStatus,
} from "./native-moments.js";
import {
  FAILURE_CHARS,
  PICTURE_STAND_IN,
  runnerMoments,
  toolAnswerSettlement,
} from "./runner-moments.js";

const NOTIFICATION = {
  THREAD_STARTED: "thread/started",
  TURN_STARTED: "turn/started",
  TURN_COMPLETED: "turn/completed",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  PLAN_UPDATED: "turn/plan/updated",
  TOKEN_USAGE: "thread/tokenUsage/updated",
  COMPACTED: "thread/compacted",
  RATE_LIMITS: "account/rateLimits/updated",
} as const;

const ITEM = {
  AGENT_MESSAGE: "agentMessage",
  REASONING: "reasoning",
  COMMAND: "commandExecution",
  FILE_CHANGE: "fileChange",
  MCP_TOOL_CALL: "mcpToolCall",
  WEB_SEARCH: "webSearch",
  SUBAGENT: "collabAgentToolCall",
  IMAGE_VIEW: "imageView",
  COMPACTION: "contextCompaction",
} as const;

const FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "declined", "interrupted"]);

const TURN_FAILED = "failed";

const TURN_COMPLETED = "completed";

const PLAN_REFUSAL_ORDER: readonly PlanStatus[] = [
  PLAN_STATUS.INELIGIBLE,
  PLAN_STATUS.INVALID,
  PLAN_STATUS.LIMIT_REACHED,
];

const PLAN_REFUSAL_CODE = /\b(subscription_sharing|chatpass_v2)_([a-z_]+)\b/g;

const PLAN_REASON_STATUS: ReadonlyMap<string, PlanStatus> = new Map([
  ["user_not_eligible", PLAN_STATUS.INELIGIBLE],
  ["invalid_user", PLAN_STATUS.INVALID],
  ["usage_limit_exceeded", PLAN_STATUS.LIMIT_REACHED],
]);

const PLAN_NOT_INCLUDED = "To use Codex with your ChatGPT plan, upgrade";

const HTTP_UNAUTHORIZED = 401;

const readEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ method: Schema.String, params: Schema.Unknown }),
);
const readThreadOf = Schema.decodeUnknownOption(Schema.Struct({ threadId: Schema.String }));
const readThreadStarted = Schema.decodeUnknownOption(
  Schema.Struct({
    thread: Schema.Struct({ id: Schema.String, parentThreadId: Schema.NullOr(Schema.String) }),
  }),
);
const readItemOf = Schema.decodeUnknownOption(Schema.Struct({ item: Schema.Unknown }));
const readItemKind = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.String, id: Schema.String }),
);

function itemOf(
  params: unknown,
): Option.Option<{ readonly type: string; readonly id: string; readonly whole: unknown }> {
  return Option.flatMap(readItemOf(params), ({ item }) =>
    Option.map(readItemKind(item), ({ type, id }) => ({ type, id, whole: item })),
  );
}
const readDelta = Schema.decodeUnknownOption(
  Schema.Struct({ itemId: Schema.String, delta: Schema.String }),
);

const ITEM_FIELDS = { type: Schema.String, id: Schema.String } as const;
const readAgentMessage = Schema.decodeUnknownOption(
  Schema.Struct({ ...ITEM_FIELDS, text: Schema.String }),
);
const readReasoning = Schema.decodeUnknownOption(
  Schema.Struct({ ...ITEM_FIELDS, summary: Schema.Array(Schema.String) }),
);
const readCommand = Schema.decodeUnknownOption(
  Schema.Struct({
    ...ITEM_FIELDS,
    command: Schema.String,
    cwd: Schema.String,
    status: Schema.String,
    aggregatedOutput: Schema.optionalKey(Schema.NullOr(Schema.String)),
    exitCode: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  }),
);
const readFileChange = Schema.decodeUnknownOption(
  Schema.Struct({ ...ITEM_FIELDS, changes: Schema.Array(WireValueSchema), status: Schema.String }),
);
const McpToolCallSchema = Schema.Struct({
  ...ITEM_FIELDS,
  server: Schema.String,
  tool: Schema.String,
  status: Schema.String,
  arguments: Schema.optionalKey(WireValueSchema),
  result: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ content: Schema.Array(WireValueSchema) })),
  ),
  error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
});
const readMcpToolCall = Schema.decodeUnknownOption(McpToolCallSchema);
const readWebSearch = Schema.decodeUnknownOption(
  Schema.Struct({
    ...ITEM_FIELDS,
    query: Schema.String,
    action: Schema.optionalKey(WireValueSchema),
    results: Schema.optionalKey(WireValueSchema),
  }),
);
const readSubagent = Schema.decodeUnknownOption(
  Schema.Struct({
    ...ITEM_FIELDS,
    tool: Schema.String,
    status: Schema.String,
    prompt: Schema.optionalKey(Schema.NullOr(Schema.String)),
    model: Schema.optionalKey(Schema.NullOr(Schema.String)),
    reasoningEffort: Schema.optionalKey(Schema.NullOr(Schema.String)),
    receiverThreadIds: Schema.optionalKey(Schema.Array(Schema.String)),
    agentsStates: Schema.optionalKey(WireValueSchema),
  }),
);
const readImageView = Schema.decodeUnknownOption(
  Schema.Struct({ ...ITEM_FIELDS, path: Schema.String }),
);
const readTextBlock = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
);
const readPlan = Schema.decodeUnknownOption(
  Schema.Struct({
    explanation: Schema.optionalKey(Schema.NullOr(Schema.String)),
    plan: Schema.Array(WireValueSchema),
  }),
);
const BREAKDOWN = Schema.Struct({
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteInputTokens: Schema.optionalKey(Schema.Number),
  outputTokens: Schema.Number,
  reasoningOutputTokens: Schema.Number,
});
const readTokenUsage = Schema.decodeUnknownOption(
  Schema.Struct({
    tokenUsage: Schema.Struct({ total: BREAKDOWN, last: Schema.optionalKey(BREAKDOWN) }),
  }),
);
const readTurnCompleted = Schema.decodeUnknownOption(
  Schema.Struct({
    turn: Schema.Struct({
      status: Schema.String,
      error: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            message: Schema.String,
            codexErrorInfo: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
            additionalDetails: Schema.optionalKey(Schema.NullOr(Schema.String)),
          }),
        ),
      ),
    }),
  }),
);

const RATE_LIMIT_WINDOW = Schema.NullOr(
  Schema.Struct({ usedPercent: Schema.Number, resetsAt: Schema.NullOr(Schema.Number) }),
);
const readRateLimits = Schema.decodeUnknownOption(
  Schema.Struct({
    rateLimits: Schema.Struct({
      primary: Schema.optionalKey(RATE_LIMIT_WINDOW),
      secondary: Schema.optionalKey(RATE_LIMIT_WINDOW),
      rateLimitReachedType: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  }),
);

const WINDOW_SPENT_PERCENT = 100;

interface Call {
  readonly callId: string;
  readonly name: string;
  readonly input: UnparsedWireValue;
}

interface Answered extends Call {
  readonly answer: Parameters<typeof toolAnswerSettlement>[0];
  readonly failed: boolean;
}

function mcpAnswerText(content: readonly WireValue[], workspaceTool: boolean): string {
  return content
    .flatMap((block) =>
      Option.match(readTextBlock(block), {
        onSome: ({ text }) => [text],
        onNone: () => (workspaceTool ? [] : [PICTURE_STAND_IN]),
      }),
    )
    .join("\n");
}

function storedMcpCall(
  call: typeof McpToolCallSchema.Type,
  args: WireValue,
): { readonly name: string; readonly input: UnparsedWireValue } {
  if (WORKSPACE_MCP_SERVER_NAMES.has(call.server)) return { name: call.tool, input: args };
  return (
    storedServerCall(call.server, call.tool, args, call.id) ?? {
      name: CODEX_TOOL.MCP_TOOL_CALL,
      input: { server: call.server, tool: call.tool, arguments: args },
    }
  );
}

function mcpCall(item: unknown): Option.Option<Answered> {
  return Option.map(readMcpToolCall(item), (call) => {
    const workspaceTool = WORKSPACE_MCP_SERVER_NAMES.has(call.server);
    const args = call.arguments ?? {};
    const text =
      call.error?.message ??
      (call.result === undefined || call.result === null
        ? ""
        : mcpAnswerText(call.result.content, workspaceTool));
    return {
      callId: call.id,
      ...storedMcpCall(call, args),
      answer: workspaceTool
        ? { workspaceTool: true, text }
        : { workspaceTool: false, text, output: text },
      failed:
        call.error !== undefined && call.error !== null ? true : FAILED_STATUSES.has(call.status),
    };
  });
}

function callOf(type: string, item: unknown): Option.Option<Answered> {
  switch (type) {
    case ITEM.COMMAND:
      return Option.map(readCommand(item), (command) => {
        const output = command.aggregatedOutput ?? "";
        return {
          callId: command.id,
          name: CODEX_TOOL.COMMAND_EXECUTION,
          input: { command: command.command, cwd: command.cwd },
          answer: {
            workspaceTool: false,
            text: output,
            output: { output, exitCode: command.exitCode ?? null },
          },
          failed: FAILED_STATUSES.has(command.status),
        };
      });
    case ITEM.FILE_CHANGE:
      return Option.map(readFileChange(item), (change) => ({
        callId: change.id,
        name: CODEX_TOOL.FILE_CHANGE,
        input: { changes: change.changes },
        answer: { workspaceTool: false, text: change.status, output: { status: change.status } },
        failed: FAILED_STATUSES.has(change.status),
      }));
    case ITEM.MCP_TOOL_CALL:
      return mcpCall(item);
    case ITEM.WEB_SEARCH:
      return Option.map(readWebSearch(item), (search) => ({
        callId: search.id,
        name: CODEX_TOOL.WEB_SEARCH,
        input: { query: search.query },
        answer: {
          workspaceTool: false,
          text: search.query,
          output: {
            query: search.query,
            action: search.action ?? null,
            results: search.results ?? null,
          },
        },
        failed: false,
      }));
    case ITEM.SUBAGENT:
      return Option.map(readSubagent(item), (call) => ({
        callId: call.id,
        name: CODEX_TOOL.SUBAGENT,
        input: {
          tool: call.tool,
          prompt: call.prompt ?? null,
          model: call.model ?? null,
          effort: call.reasoningEffort ?? null,
          receiverThreadIds: call.receiverThreadIds ?? [],
        },
        answer: {
          workspaceTool: false,
          text: call.status,
          output: { status: call.status, agentsStates: call.agentsStates ?? {} },
        },
        failed: FAILED_STATUSES.has(call.status),
      }));
    case ITEM.IMAGE_VIEW:
      return Option.map(readImageView(item), (view) => ({
        callId: view.id,
        name: CODEX_TOOL.IMAGE_VIEW,
        input: { path: view.path },
        answer: { workspaceTool: false, text: PICTURE_STAND_IN, output: PICTURE_STAND_IN },
        failed: false,
      }));
    default:
      return Option.none();
  }
}

function started(call: Call): NativeMoment {
  return {
    kind: NATIVE_MOMENT.TOOL_STARTED,
    callId: call.callId,
    name: call.name,
    input: call.input,
  };
}

function settled(call: Answered): readonly NativeMoment[] {
  return [
    started(call),
    {
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId: call.callId,
      settlement: toolAnswerSettlement(call.answer, call.failed),
      input: call.input,
    },
    { kind: NATIVE_MOMENT.STEP_CLOSED },
  ];
}

const SPAWN_AGENT = "spawnAgent";

function spawnedThreads(type: string, whole: unknown): readonly string[] {
  if (type !== ITEM.SUBAGENT) return [];
  return Option.match(readSubagent(whole), {
    onSome: (call) =>
      call.tool === SPAWN_AGENT && !FAILED_STATUSES.has(call.status)
        ? (call.receiverThreadIds ?? [])
        : [],
    onNone: () => [],
  });
}

function spawnMoments(call: Call, threads: readonly string[]): readonly NativeMoment[] {
  return [started(call), ...running(call, threads), { kind: NATIVE_MOMENT.STEP_CLOSED }];
}

function running(call: Call, threads: readonly string[]): readonly NativeMoment[] {
  const { callId, input } = call;
  return threads.map(
    (key): NativeMoment => ({
      kind: NATIVE_MOMENT.SUBAGENT_RUNNING,
      callId,
      key,
      ...(input === undefined ? undefined : { input }),
    }),
  );
}

function childTurnMoments(threadId: string, params: unknown): readonly NativeMoment[] {
  const read = readTurnCompleted(params);
  if (Option.isNone(read)) return [];
  const { status, error } = read.value.turn;
  const text = error?.message ?? status;
  return [
    {
      kind: NATIVE_MOMENT.SUBAGENT_ENDED,
      key: threadId,
      settlement: toolAnswerSettlement(
        { workspaceTool: false, text, output: { status } },
        status !== TURN_COMPLETED,
      ),
    },
  ];
}

function itemStartedMoments(params: unknown): readonly NativeMoment[] {
  const item = itemOf(params);
  if (Option.isNone(item)) return [];
  const { type, id, whole } = item.value;
  if (type === ITEM.AGENT_MESSAGE) return [{ kind: NATIVE_MOMENT.STEP, key: id }];
  return Option.match(callOf(type, whole), {
    onSome: (call): readonly NativeMoment[] => [
      started(call),
      ...running(call, spawnedThreads(type, whole)),
    ],
    onNone: () => [],
  });
}

function itemCompletedMoments(params: unknown): readonly NativeMoment[] {
  const item = itemOf(params);
  if (Option.isNone(item)) return [];
  const { type, id, whole } = item.value;
  switch (type) {
    case ITEM.AGENT_MESSAGE:
      return Option.match(readAgentMessage(whole), {
        onSome: ({ text }): readonly NativeMoment[] => [
          { kind: NATIVE_MOMENT.STEP, key: id },
          { kind: NATIVE_MOMENT.TEXT, text },
          { kind: NATIVE_MOMENT.STEP_CLOSED },
        ],
        onNone: () => [],
      });
    case ITEM.REASONING:
      return Option.match(readReasoning(whole), {
        onSome: ({ summary }): readonly NativeMoment[] => {
          const text = summary.join("\n\n").trim();
          return text.length === 0 ? [] : [{ kind: NATIVE_MOMENT.REASONING, text }];
        },
        onNone: () => [],
      });
    case ITEM.COMPACTION:
      return [{ kind: NATIVE_MOMENT.COMPACTED }];
    default: {
      const threads = spawnedThreads(type, whole);
      return Option.match(callOf(type, whole), {
        onSome: (call) => (threads.length === 0 ? settled(call) : spawnMoments(call, threads)),
        onNone: () => [],
      });
    }
  }
}

function planMoments(params: unknown, sequence: number): readonly NativeMoment[] {
  return Option.match(readPlan(params), {
    onSome: ({ explanation, plan }): readonly NativeMoment[] => {
      const input = { explanation: explanation ?? null, plan };
      return settled({
        callId: `${CODEX_TOOL.TODO_LIST}:${sequence}`,
        name: CODEX_TOOL.TODO_LIST,
        input,
        answer: { workspaceTool: false, text: "", output: input },
        failed: false,
      });
    },
    onNone: () => [],
  });
}

function usageMoments(params: unknown): readonly NativeMoment[] {
  return Option.match(readTokenUsage(params), {
    onSome: ({ tokenUsage: { total, last } }): readonly NativeMoment[] => [
      ...(last === undefined
        ? []
        : [
            {
              kind: NATIVE_MOMENT.CONTEXT,
              usage: {
                inputTokens: last.inputTokens,
                outputTokens: last.outputTokens,
                cachedInputTokens: last.cachedInputTokens,
                cacheWriteTokens: last.cacheWriteInputTokens ?? 0,
              },
            } as const,
          ]),
      {
        kind: NATIVE_MOMENT.USAGE_TOTAL,
        total: {
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          cachedInputTokens: total.cachedInputTokens,
          reasoningTokens: total.reasoningOutputTokens,
          cacheWriteTokens: total.cacheWriteInputTokens ?? 0,
        },
      },
    ],
    onNone: () => [],
  });
}

function httpStatusOf(value: unknown): number | undefined {
  return Predicate.isObject(value) &&
    "httpStatusCode" in value &&
    Predicate.isNumber(value.httpStatusCode)
    ? value.httpStatusCode
    : undefined;
}

function planStatusOfInfo(info: unknown): PlanStatus | undefined {
  const kind = codexErrorKind(info);
  if (kind === undefined) return undefined;
  switch (kind) {
    case CODEX_ERROR_INFO.USAGE_LIMIT_EXCEEDED:
      return PLAN_STATUS.LIMIT_REACHED;
    case CODEX_ERROR_INFO.UNAUTHORIZED:
      return PLAN_STATUS.INVALID;
    case CODEX_ERROR_INFO.HTTP_CONNECTION_FAILED:
    case CODEX_ERROR_INFO.RESPONSE_STREAM_CONNECTION_FAILED:
      return Predicate.isObject(info) && httpStatusOf(Object.values(info)[0]) === HTTP_UNAUTHORIZED
        ? PLAN_STATUS.INVALID
        : undefined;
    case CODEX_ERROR_INFO.CONTEXT_WINDOW_EXCEEDED:
    case CODEX_ERROR_INFO.SESSION_BUDGET_EXCEEDED:
    case CODEX_ERROR_INFO.RATE_LIMIT_EXCEEDED:
    case CODEX_ERROR_INFO.FLEX_UNAVAILABLE:
    case CODEX_ERROR_INFO.SERVER_OVERLOADED:
    case CODEX_ERROR_INFO.CYBER_POLICY:
    case CODEX_ERROR_INFO.MISALIGNMENT_POLICY_VIOLATION:
    case CODEX_ERROR_INFO.TOO_MANY_DENIALS:
    case CODEX_ERROR_INFO.INTERNAL_SERVER_ERROR:
    case CODEX_ERROR_INFO.BAD_REQUEST:
    case CODEX_ERROR_INFO.THREAD_ROLLBACK_FAILED:
    case CODEX_ERROR_INFO.SANDBOX_ERROR:
    case CODEX_ERROR_INFO.RESPONSE_STREAM_DISCONNECTED:
    case CODEX_ERROR_INFO.RESPONSE_TOO_MANY_FAILED_ATTEMPTS:
    case CODEX_ERROR_INFO.ACTIVE_TURN_NOT_STEERABLE:
    case CODEX_ERROR_INFO.OTHER:
      return undefined;
    default:
      return kind satisfies never;
  }
}

function errorInfoWords(info: unknown): readonly string[] {
  if (Predicate.isString(info)) return [info];
  if (!Predicate.isObject(info)) return [];
  return Object.entries(info).flatMap(([name, value]) => {
    const status = httpStatusOf(value);
    return status === undefined ? [name] : [name, String(status)];
  });
}

function turnCompletedMoments(params: unknown): readonly NativeMoment[] {
  const read = readTurnCompleted(params);
  if (Option.isNone(read) || read.value.turn.status !== TURN_FAILED) {
    const ran = Option.isSome(read) && read.value.turn.status === TURN_COMPLETED;
    return [
      { kind: NATIVE_MOMENT.RESULT },
      ...(ran ? [{ kind: NATIVE_MOMENT.PLAN, status: PLAN_STATUS.VERIFIED } as const] : []),
    ];
  }
  const error = read.value.turn.error ?? undefined;
  const said = [error?.message ?? "", error?.additionalDetails ?? ""].join(" ");
  const quoted = [...said.matchAll(PLAN_REFUSAL_CODE)];
  const codes = [...new Set(quoted.map(([code]) => code))];
  const info = errorInfoWords(error?.codexErrorInfo).map((word) => redactCredentials(word));
  const words = [...info, ...codes];
  const failure = words.length === 0 ? "turn_failed" : words.join(" ");
  const found = new Set([
    planStatusOfInfo(error?.codexErrorInfo),
    said.includes(PLAN_NOT_INCLUDED) ? PLAN_STATUS.INELIGIBLE : undefined,
    ...quoted.map(([, , reason]) => PLAN_REASON_STATUS.get(reason ?? "")),
  ]);
  const plan = PLAN_REFUSAL_ORDER.find((status) => found.has(status));
  return [
    { kind: NATIVE_MOMENT.RESULT, failure: failure.slice(0, FAILURE_CHARS) },
    ...(plan === undefined ? [] : [{ kind: NATIVE_MOMENT.PLAN, status: plan } as const]),
  ];
}

function rateLimitMoments(params: unknown): readonly NativeMoment[] {
  const read = readRateLimits(params);
  if (Option.isNone(read)) return [];
  const { primary, secondary, rateLimitReachedType } = read.value.rateLimits;
  const spent = [primary, secondary].filter(
    (window) => window != null && window.usedPercent >= WINDOW_SPENT_PERCENT,
  );
  const reached = rateLimitReachedType ?? (spent.length > 0 ? "rate_limit_reached" : undefined);
  if (reached === undefined) return [];
  const resets = spent.flatMap((window) =>
    window?.resetsAt == null ? [] : [window.resetsAt * 1000],
  );
  const resetsAt = resets.length === 0 ? undefined : Math.max(...resets);
  const words = [reached];
  if (resetsAt !== undefined) words.push(`resets ${new Date(resetsAt).toISOString()}`);
  return [
    {
      kind: NATIVE_MOMENT.RATE_LIMIT,
      refused: true,
      detail: words.join(" "),
      ...(resetsAt !== undefined ? { resetsAt } : undefined),
    },
  ];
}

function elsewhere(params: unknown, held: NativeHeld): boolean {
  if (held.session === undefined) return false;
  return Option.match(readThreadOf(params), {
    onSome: ({ threadId }) => threadId !== held.session,
    onNone: () => false,
  });
}

function threadStartedMoments(params: unknown): readonly NativeMoment[] {
  return Option.match(readThreadStarted(params), {
    onSome: ({ thread }): readonly NativeMoment[] =>
      thread.parentThreadId === null ? [{ kind: NATIVE_MOMENT.SESSION, sessionId: thread.id }] : [],
    onNone: () => [],
  });
}

export function codexMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const own = runnerMoments(message);
  if (Option.isSome(own)) return own.value;
  const envelope = readEnvelope(message);
  if (Option.isNone(envelope)) return [];
  const { method, params } = envelope.value;
  if (method === NOTIFICATION.THREAD_STARTED) return threadStartedMoments(params);
  if (elsewhere(params, held)) {
    if (method !== NOTIFICATION.TURN_COMPLETED) return [];
    return Option.match(readThreadOf(params), {
      onSome: ({ threadId }) => childTurnMoments(threadId, params),
      onNone: () => [],
    });
  }
  switch (method) {
    case NOTIFICATION.TURN_STARTED:
      return [{ kind: NATIVE_MOMENT.ACTIVE }];
    case NOTIFICATION.ITEM_STARTED:
      return itemStartedMoments(params);
    case NOTIFICATION.ITEM_COMPLETED:
      return itemCompletedMoments(params);
    case NOTIFICATION.AGENT_MESSAGE_DELTA:
      return Option.match(readDelta(params), {
        onSome: ({ itemId, delta }): readonly NativeMoment[] => [
          { kind: NATIVE_MOMENT.STEP, key: itemId },
          { kind: NATIVE_MOMENT.TEXT_DELTA, text: delta },
        ],
        onNone: () => [],
      });
    case NOTIFICATION.PLAN_UPDATED:
      return planMoments(params, held.sequence);
    case NOTIFICATION.TOKEN_USAGE:
      return usageMoments(params);
    case NOTIFICATION.COMPACTED:
      return [{ kind: NATIVE_MOMENT.COMPACTED }];
    case NOTIFICATION.TURN_COMPLETED:
      return turnCompletedMoments(params);
    case NOTIFICATION.RATE_LIMITS:
      return rateLimitMoments(params);
    default:
      return [];
  }
}
