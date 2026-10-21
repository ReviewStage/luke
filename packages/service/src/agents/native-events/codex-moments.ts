import { CODEX_LUKE_MCP_SERVER, CODEX_TOOL } from "@luke/features/agent-tools";
import { redactCredentials } from "@luke/features/credential-redaction";
import { type UnparsedWireValue, type WireValue, WireValueSchema } from "@luke/wire";
import { Option, Predicate, Schema } from "effect";
import { NATIVE_MOMENT, type NativeHeld, type NativeMoment } from "./native-moments.js";
import {
  FAILURE_CHARS,
  PICTURE_STAND_IN,
  runnerMoments,
  toolAnswerSettlement,
} from "./runner-moments.js";

/**
 * codex-moments.ts -- Codex's app-server notifications, as its runner posts them, read as the moments of a native run.
 *
 * Each notification the pinned `codex app-server` sends (the runner's
 * `CodexNotification`, `@luke/agent-runner/protocol`) and each of the
 * runner's own (`runner-moments.ts`) is read here for what the transcript
 * keeps. Codex names no model call, so its items stand in: an agent message
 * is a step, its deltas drafting the step's words and its completion
 * telling them whole; a command, a file change, an MCP call, a web search
 * and a subagent call each start a call as their item starts and settle it
 * as it completes; a reasoning item's summary is the step's reasoning; the
 * turn's plan is its todo list, one call for each time Codex sets it.
 * `turn/completed` ends one model turn, failed where Codex says so, with
 * the plan's refusals named by OpenAI's own codes; the thread's running
 * token total meters the turn; a compaction stamps the agent; and a new
 * thread is the session a relaunch resumes. Codex sends a subagent's work
 * on a thread of its own, which its subagent call stands for, so anything
 * of a thread other than the session's is passed over. A call to Luke's own
 * MCP server is named as Luke's tool and its answer read as the JSON that
 * tool answers, a picture in it standing in for its bytes. Each shape is
 * read with a schema of the fields this reads alone, so a field Codex adds
 * changes nothing here, and a notification no schema fits is no moment.
 */

/** The notifications read here, as app-server spells them. */
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
} as const;

/** The item types read here, as app-server's `ThreadItem` spells them. */
const ITEM = {
  AGENT_MESSAGE: "agentMessage",
  REASONING: "reasoning",
  COMMAND: "commandExecution",
  FILE_CHANGE: "fileChange",
  MCP_TOOL_CALL: "mcpToolCall",
  WEB_SEARCH: "webSearch",
  SUBAGENT: "collabAgentToolCall",
  COMPACTION: "contextCompaction",
} as const;

/** The statuses that say a call did not do its work, across the items' own status words: a subagent's call may be interrupted. */
const FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "declined", "interrupted"]);

/** A turn's status that says it failed, as `TurnStatus` spells it. */
const TURN_FAILED = "failed";

/** The codes OpenAI answers a ChatGPT plan's refusal with, such as `subscription_sharing_usage_limit_exceeded`. */
const PLAN_REFUSAL_CODE = /\b(?:subscription_sharing|chatpass_v2)_[a-z_]+\b/g;

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

/** The item a notification carries, whole, with its type and id. */
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
const readMcpToolCall = Schema.decodeUnknownOption(
  Schema.Struct({
    ...ITEM_FIELDS,
    server: Schema.String,
    tool: Schema.String,
    status: Schema.String,
    arguments: Schema.optionalKey(WireValueSchema),
    result: Schema.optionalKey(
      Schema.NullOr(Schema.Struct({ content: Schema.Array(WireValueSchema) })),
    ),
    error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
  }),
);
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
    receiverThreadIds: Schema.optionalKey(Schema.Array(Schema.String)),
    agentsStates: Schema.optionalKey(WireValueSchema),
  }),
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
  Schema.Struct({ tokenUsage: Schema.Struct({ total: BREAKDOWN }) }),
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

/** One call as it starts: its id, the name the transcript stores it under, and what it was asked. */
interface Call {
  readonly callId: string;
  readonly name: string;
  readonly input: UnparsedWireValue;
}

/** One call as it completes: the call, and its answer as the transcript settles it. */
interface Answered extends Call {
  readonly answer: Parameters<typeof toolAnswerSettlement>[0];
  readonly failed: boolean;
}

/**
 * An MCP result's text blocks joined. A picture in a Luke tool's answer is
 * left out, so the JSON the tool answered reads whole; in any other server's
 * a stand-in takes the place of its bytes.
 */
function mcpAnswerText(content: readonly WireValue[], lukeTool: boolean): string {
  return content
    .flatMap((block) =>
      Option.match(readTextBlock(block), {
        onSome: ({ text }) => [text],
        onNone: () => (lukeTool ? [] : [PICTURE_STAND_IN]),
      }),
    )
    .join("\n");
}

/** A call to an MCP server: Luke's tool by its own name, any other server's as `mcpToolCall`. */
function mcpCall(item: unknown): Option.Option<Answered> {
  return Option.map(readMcpToolCall(item), (call) => {
    const lukeTool = call.server === CODEX_LUKE_MCP_SERVER;
    const args = call.arguments ?? {};
    const text =
      call.error?.message ??
      (call.result === undefined || call.result === null
        ? ""
        : mcpAnswerText(call.result.content, lukeTool));
    return {
      callId: call.id,
      name: lukeTool ? call.tool : CODEX_TOOL.MCP_TOOL_CALL,
      input: lukeTool ? args : { server: call.server, tool: call.tool, arguments: args },
      answer: lukeTool ? { lukeTool: true, text } : { lukeTool: false, text, output: text },
      failed:
        call.error !== undefined && call.error !== null ? true : FAILED_STATUSES.has(call.status),
    };
  });
}

/** An item that does Codex's work, as the call it stands for; nothing for any other item. */
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
            lukeTool: false,
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
        answer: { lukeTool: false, text: change.status, output: { status: change.status } },
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
          lukeTool: false,
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
          receiverThreadIds: call.receiverThreadIds ?? [],
        },
        answer: {
          lukeTool: false,
          text: call.status,
          output: { status: call.status, agentsStates: call.agentsStates ?? {} },
        },
        failed: FAILED_STATUSES.has(call.status),
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
      // Note that an item's input can fill in between its start and its completion (a file change's changes), so the completed one is told with the answer.
      input: call.input,
    },
    { kind: NATIVE_MOMENT.STEP_CLOSED },
  ];
}

function itemStartedMoments(params: unknown): readonly NativeMoment[] {
  const item = itemOf(params);
  if (Option.isNone(item)) return [];
  const { type, id, whole } = item.value;
  if (type === ITEM.AGENT_MESSAGE) return [{ kind: NATIVE_MOMENT.STEP, key: id }];
  return Option.match(callOf(type, whole), {
    onSome: (call): readonly NativeMoment[] => [started(call)],
    onNone: () => [],
  });
}

/**
 * An item completed: an agent message's words whole, a reasoning summary, a
 * compaction, or a call settled. Note that a call is started here too,
 * which the projection passes over where the item's start already did,
 * because a call can complete with no start reported.
 */
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
    default:
      return Option.match(callOf(type, whole), { onSome: settled, onNone: () => [] });
  }
}

/** The turn's plan set again: a todo list call, started and settled at once, under the event's own number. */
function planMoments(params: unknown, sequence: number): readonly NativeMoment[] {
  return Option.match(readPlan(params), {
    onSome: ({ explanation, plan }): readonly NativeMoment[] => {
      const input = { explanation: explanation ?? null, plan };
      return settled({
        callId: `${CODEX_TOOL.TODO_LIST}:${sequence}`,
        name: CODEX_TOOL.TODO_LIST,
        input,
        answer: { lukeTool: false, text: "", output: input },
        failed: false,
      });
    },
    onNone: () => [],
  });
}

/**
 * The thread's running total, as the meter reads one. Note that OpenAI
 * counts the cache's reads within the input and the reasoning within the
 * output, as the record counts them.
 */
function usageMoments(params: unknown): readonly NativeMoment[] {
  return Option.match(readTokenUsage(params), {
    onSome: ({ tokenUsage: { total } }): readonly NativeMoment[] => [
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

/** Codex's own word for why a turn failed: `usageLimitExceeded`, or `httpConnectionFailed 401`. */
function errorInfoWords(info: unknown): readonly string[] {
  if (Predicate.isString(info)) return [info];
  if (!Predicate.isObject(info)) return [];
  return Object.entries(info).flatMap(([name, value]) => {
    const status =
      Predicate.isObject(value) &&
      "httpStatusCode" in value &&
      Predicate.isNumber(value.httpStatusCode)
        ? [String(value.httpStatusCode)]
        : [];
    return [name, ...status];
  });
}

/**
 * A model turn's end: failed where Codex says it failed, said in Codex's own
 * word for it and the codes OpenAI refused the plan with, which name a usage
 * limit, an account not eligible, and a sign-in not accepted alike. The
 * failure's whole message is the launch's end's to say.
 */
function turnCompletedMoments(params: unknown): readonly NativeMoment[] {
  const read = readTurnCompleted(params);
  if (Option.isNone(read) || read.value.turn.status !== TURN_FAILED) {
    return [{ kind: NATIVE_MOMENT.RESULT }];
  }
  const error = read.value.turn.error ?? undefined;
  const said = [error?.message ?? "", error?.additionalDetails ?? ""].join(" ");
  const codes = [...new Set(said.match(PLAN_REFUSAL_CODE) ?? [])];
  // Note that OpenAI's codes are its own words, never a secret, though a credential's redaction would take one for it.
  const info = errorInfoWords(error?.codexErrorInfo).map((word) => redactCredentials(word));
  const words = [...info, ...codes];
  const failure = words.length === 0 ? "turn_failed" : words.join(" ");
  return [{ kind: NATIVE_MOMENT.RESULT, failure: failure.slice(0, FAILURE_CHARS) }];
}

/** Whether a notification is of a thread other than the session's: a subagent's, which its call stands for. */
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

/**
 * One message the runner posted, as the moments of the run: nothing for a
 * notification of a subagent's thread, or of a kind the transcript keeps
 * nothing of. `held` names the session's thread, and the event's number,
 * which names a todo list Codex names nothing for.
 */
export function codexMoments(message: WireValue, held: NativeHeld): readonly NativeMoment[] {
  const own = runnerMoments(message);
  if (Option.isSome(own)) return own.value;
  const envelope = readEnvelope(message);
  if (Option.isNone(envelope)) return [];
  const { method, params } = envelope.value;
  if (method === NOTIFICATION.THREAD_STARTED) return threadStartedMoments(params);
  if (elsewhere(params, held)) return [];
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
    default:
      return [];
  }
}
