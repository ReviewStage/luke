import {
  failedHousekeeping,
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
  memoryFlushPrompt,
  SILENT_REPLY_TOKEN,
  skippedHousekeeping,
} from "@sidecar/memory";
import { emitJsonSchema } from "@sidecar/wire/effect";
import {
  generateText,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  type Tool,
  type ToolResultPart,
  type ToolSet,
  tool,
} from "ai";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Data, Duration, Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  ACTION_RESULT_STATUS,
  BRAIN_TOOL,
  type BrainWorkspaceAccess,
  dailyNotePath,
  isRecord,
  isWireString,
  jsonRoundTrip,
  RUN_ORIGIN,
  sessionKey,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  WORKSPACE_TOOLS,
  type WorkspaceToolContext,
  type WorkspaceToolModule,
} from "../../core.js";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import type { ConversationTarget } from "../store/index.js";

/**
 * The pre-compaction memory flush on the hosted brain: OpenClaw's silent
 * housekeeping turn, run where eve says the session's context is about to
 * fold. eve hands its memory provider a private copy of the history and an
 * operation id that names the compaction cycle; this module claims the cycle
 * on the conversation's row, hands the model that copy rendered as data with
 * the flush's own words, offers it exactly one tool, `append_daily_note`
 * over the account's workspace rows, and writes down how the turn ended.
 * Nothing the turn says reaches the conversation: its reply is read only for
 * the silent token and then dropped, its tool calls land as rows of the
 * dated note and nowhere else, and the conversation's row keeps the outcome
 * word and the instant, never a word of the turn. The developer's own turn
 * never waits on the flush's success: every failure is an outcome here, not
 * an error eve sees, so compaction proceeds whatever became of the flush.
 */

const MEMORY_FLUSH = {
  /** The most characters of the session's context the turn is handed, cut from the front so the newest words stay. */
  CONTEXT_CHARS: 400_000,
  /** The most characters of a model's own error the outcome's reason keeps. */
  REASON_CHARS: 200,
} as const;

/** Why a flush did not run, or ran and stored nothing, in words a reader of the outcome can use. */
export const MEMORY_FLUSH_REFUSAL = {
  NOT_AN_ASK: "not flushed: only a developer's own ask flushes before its context folds",
  ALREADY_FLUSHED: "not flushed: this compaction cycle has run its flush",
  NO_TOOL: "not flushed: the catalog declares no append_daily_note",
  TIMED_OUT: "not finished: the housekeeping turn ran past its bound",
  CANCELLED: "not finished: the session's turn was cancelled under it",
  REPLIED_IN_WORDS: "nothing stored: the turn replied in words and appended nothing",
  NOTHING_LANDED: "nothing stored: every append was refused",
  HOST_FAILED: "not finished: the host could not run the housekeeping turn",
} as const;

const CONTEXT_CUT_MARKER = "[earlier context cut]";
const ROLE_LABEL = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
} as const;

/** One tool result as the turn reads it: its text, its JSON, or the kind of thing it was. */
function toolOutputText(output: ToolResultPart["output"]): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value;
    case "json":
    case "error-json":
      return JSON.stringify(output.value);
    case "content":
      return output.value
        .flatMap((part) => (part.type === "text" ? [part.text] : [`[${part.type}]`]))
        .join(" ");
    case "execution-denied":
      return "[denied]";
  }
}

/** One message as a block of the data the turn reads; nothing for a system message, which is instruction rather than conversation. */
function messageAsData(message: ModelMessage): string | undefined {
  switch (message.role) {
    case "system":
      return undefined;
    case "user": {
      const text = Array.isArray(message.content)
        ? message.content
            .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
            .join("\n")
        : message.content;
      return `[${ROLE_LABEL.USER}]\n${text}`;
    }
    case "assistant": {
      const text = Array.isArray(message.content)
        ? message.content
            .flatMap((part) => {
              switch (part.type) {
                case "text":
                  return [part.text];
                case "tool-call":
                  return [`-> ${part.toolName} ${JSON.stringify(part.input)}`];
                case "tool-result":
                  return [`<- ${part.toolName}: ${toolOutputText(part.output)}`];
                case "file":
                  return [`[${part.type}]`];
                default:
                  return [];
              }
            })
            .join("\n")
        : message.content;
      return `[${ROLE_LABEL.ASSISTANT}]\n${text}`;
    }
    case "tool":
      return `[${ROLE_LABEL.TOOL}]\n${message.content
        .flatMap((part) =>
          part.type === "tool-result"
            ? [`<- ${part.toolName}: ${toolOutputText(part.output)}`]
            : [],
        )
        .join("\n")}`;
  }
}

/**
 * The session's context as the data the turn reads, never as its
 * instructions: each message one block under its role, tool calls and their
 * results one line each, files and images named by kind alone, reasoning
 * left out, and the whole cut from the front to the bound so what the turn
 * is handed is the newest words, marked where the older ones were cut.
 */
export function contextAsData(
  messages: readonly ModelMessage[],
  bound: number = MEMORY_FLUSH.CONTEXT_CHARS,
): string {
  const rendered = messages
    .flatMap((message) => {
      const block = messageAsData(message);
      return block === undefined ? [] : [block];
    })
    .join("\n\n");
  if (rendered.length <= bound) return rendered;
  return `${CONTEXT_CUT_MARKER}\n${rendered.slice(rendered.length - bound)}`;
}

const appendDailyNoteModule = (): WorkspaceToolModule | undefined =>
  WORKSPACE_TOOLS.find((module) => module.name === BRAIN_TOOL.APPEND_DAILY_NOTE);

export interface MemoryFlushTurnInput {
  readonly target: ConversationTarget;
  /** eve's id for the compaction cycle; the calls of the turn are attributed to it. */
  readonly operationId: string;
  /** The history as eve hands its memory provider before the checkpoint changes; read here, never written. */
  readonly messages: readonly ModelMessage[];
  /** eve's own cancellation of the operation. */
  readonly signal: AbortSignal;
  /** The account's hosted model, the meter already in front of it. */
  readonly model: LanguageModel;
  /** The account's workspace rows, which the one offered tool appends to. */
  readonly workspace: BrainWorkspaceAccess;
  readonly now: () => number;
}

/** The housekeeping turn's one model call: what it was asked, and what it answered. */
interface HousekeepingAnswer {
  readonly text: string;
  readonly appends: readonly WireRecord[];
}

/** The model call's own failure — the meter's refusal, the provider's error, the network's — with its words bounded for the outcome's reason. */
class HousekeepingModelError extends Data.TaggedError("HousekeepingModelError")<{
  readonly reason: string;
}> {}

/**
 * The turn itself, total: one model call under the flush's system prompt,
 * the context as data and the flush's ask as the one user message, the one
 * tool declared and not executed by the model's own loop, so each call the
 * model emits is carried here through the catalog's module over the account's
 * workspace, and every way the call can end is an outcome rather than an
 * error. The model's words are read for the silent token and dropped.
 */
const housekeepingTurn = /* @__PURE__ */ Effect.fn("housekeepingTurn")(function* (
  input: MemoryFlushTurnInput,
): Effect.fn.Return<MemoryHousekeepingResult> {
  const module = appendDailyNoteModule();
  if (!module) return failedHousekeeping(MEMORY_FLUSH_REFUSAL.NO_TOOL);
  const prompt = memoryFlushPrompt(dailyNotePath(input.now()));
  // The tool as the model is shown it: the catalog module's own words and
  // wire schema, with no `execute`, so the AI SDK's loop runs nothing and
  // every call the model emits comes back here to be parsed and carried.
  const offered: Tool = tool({
    description: module.description,
    // The wire schema's node is JSON Schema in the strict form a function tool takes; a
    // round trip is its plain-object form, which is what the SDK's schema type names.
    inputSchema: jsonSchema<unknown>(jsonRoundTrip(emitJsonSchema(module.inputSchema))),
  });
  const tools: ToolSet = { [BRAIN_TOOL.APPEND_DAILY_NOTE]: offered };
  const asked = yield* Effect.tryPromise({
    try: (signal) =>
      generateText({
        model: input.model,
        system: prompt.system,
        messages: [
          {
            role: "user",
            content: `The conversation so far, as data:\n\n${contextAsData(input.messages)}\n\n${prompt.ask}`,
          },
        ],
        tools,
        maxOutputTokens: MEMORY_FLUSH_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
        abortSignal: AbortSignal.any([input.signal, signal]),
      }),
    catch: (error) =>
      new HousekeepingModelError({
        reason: (error instanceof Error ? error.message : String(error)).slice(
          0,
          MEMORY_FLUSH.REASON_CHARS,
        ),
      }),
  }).pipe(
    Effect.map(
      (result): HousekeepingAnswer => ({
        text: result.text,
        appends: result.toolCalls.flatMap((call) => {
          if (call.toolName !== BRAIN_TOOL.APPEND_DAILY_NOTE) return [];
          // SAFETY: the SDK hands back the JSON object the model emitted; the module reads it as wire input.
          const fields = unparsedWire(call.input as WireBoundaryInput);
          return isRecord(fields) ? [fields] : [];
        }),
      }),
    ),
    Effect.timeout(Duration.millis(MEMORY_FLUSH_DEFAULTS.TIMEOUT_MS)),
    Effect.catchTag("TimeoutError", () =>
      Effect.succeed({
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
        writes: 0,
        reason: MEMORY_FLUSH_REFUSAL.TIMED_OUT,
      }),
    ),
    Effect.catchTag("HousekeepingModelError", (error) =>
      Effect.succeed(
        input.signal.aborted
          ? {
              outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
              writes: 0,
              reason: MEMORY_FLUSH_REFUSAL.CANCELLED,
            }
          : failedHousekeeping(error.reason),
      ),
    ),
  );
  if (!("appends" in asked)) return asked;
  // eve's cancellation lands between the call and the appends too: what the
  // model asked for under a turn that ended is not written.
  if (input.signal.aborted) {
    return {
      outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
      writes: 0,
      reason: MEMORY_FLUSH_REFUSAL.CANCELLED,
    };
  }
  if (asked.appends.length === 0) {
    return {
      outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
      writes: 0,
      reason:
        asked.text.trim() === SILENT_REPLY_TOKEN
          ? SILENT_REPLY_TOKEN
          : MEMORY_FLUSH_REFUSAL.REPLIED_IN_WORDS,
    };
  }
  const standing: WorkspaceToolContext = {
    conversationId: sessionKey(input.target.conversationId),
    turnId: input.operationId,
    runId: input.operationId,
    origin: RUN_ORIGIN.MAINTENANCE,
    signal: input.signal,
    isRevoked: () => input.signal.aborted,
    workspace: input.workspace,
    journal: (effect) => effect,
  };
  let writes = 0;
  let refusal: string | undefined;
  for (const fields of asked.appends) {
    // The workspace the append reached could not be read or written: nothing
    // landed, and the turn says so in the host's own words.
    const answer = yield* Effect.catchTag(
      module.execute(fields, standing),
      "ToolHostUnavailable",
      () =>
        Effect.succeed<WireRecord>({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: MEMORY_FLUSH_REFUSAL.HOST_FAILED,
        }),
    );
    if (answer.status === ACTION_RESULT_STATUS.ACCEPTED) writes += 1;
    else if (refusal === undefined && isWireString(answer.reason)) refusal = answer.reason;
  }
  if (writes > 0) return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes };
  return failedHousekeeping(refusal ?? MEMORY_FLUSH_REFUSAL.NOTHING_LANDED);
});

const ClaimedRowSchema = Schema.Struct({ id: Schema.String });

/**
 * The row has not already claimed this cycle. `is distinct from` is what
 * makes a row that has claimed nothing at all — a null column — count as
 * unclaimed, which an equality would not; the builder has no operator for it,
 * so it is a fragment inside the one rendered statement.
 */
const UNCLAIMED_CYCLE = (operationId: string) =>
  sql`${conversations.memoryFlushOperationId} is distinct from ${operationId}`;

/**
 * Claims the compaction cycle for this flush: the row takes the operation id
 * only when it records another, so eve replaying the capture under the same
 * id, as it may, finds the cycle claimed and runs nothing. The outcome is
 * cleared as the claim lands, so a row naming an operation with no outcome
 * is a flush that started and never wrote its end.
 */
const claimFlushCycle = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    operationId: Schema.String,
    now: Schema.Date,
  }),
  Result: ClaimedRowSchema,
  execute: (claim) =>
    db
      .update(conversations)
      .set({
        memoryFlushOperationId: claim.operationId,
        memoryFlushOutcome: null,
        memoryFlushedAt: claim.now,
      })
      .where(
        and(
          eq(conversations.id, claim.conversationId),
          eq(conversations.userId, claim.userId),
          isNull(conversations.deletedAt),
          UNCLAIMED_CYCLE(claim.operationId),
        ),
      )
      .returning({ id: conversations.id }),
});

const recordFlushOutcome = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    operationId: Schema.String,
    outcome: Schema.Literals(Object.values(MEMORY_HOUSEKEEPING_OUTCOME)),
    now: Schema.Date,
  }),
  execute: (record) =>
    db
      .update(conversations)
      .set({ memoryFlushOutcome: record.outcome, memoryFlushedAt: record.now })
      .where(
        and(
          eq(conversations.id, record.conversationId),
          eq(conversations.memoryFlushOperationId, record.operationId),
        ),
      ),
});

/**
 * One flush for one compaction cycle of one conversation: the cycle claimed
 * on the row first, the turn run only under a claim that landed, and the
 * outcome written back under the same operation id. At most one
 * housekeeping turn per cycle is what the claim guarantees; that the turn
 * stored anything is what the outcome says.
 */
export const flushMemory = /* @__PURE__ */ Effect.fn("flushMemory")(function* (
  input: MemoryFlushTurnInput,
): Effect.fn.Return<MemoryHousekeepingResult, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const claimed = yield* claimFlushCycle({
    userId: input.target.userId,
    conversationId: input.target.conversationId,
    operationId: input.operationId,
    now: new Date(input.now()),
  });
  if (Option.isNone(claimed)) return skippedHousekeeping(MEMORY_FLUSH_REFUSAL.ALREADY_FLUSHED);
  const result = yield* housekeepingTurn(input);
  yield* recordFlushOutcome({
    conversationId: input.target.conversationId,
    operationId: input.operationId,
    outcome: result.outcome,
    now: new Date(input.now()),
  });
  return result;
});
