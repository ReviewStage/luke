import { isRecord } from "@sidecar/wire";
import { Option, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { coderCallOf, coderOutputOf } from "./tool-vocabulary.js";

/**
 * stream-events.ts -- SPIKE (do not merge): one harness turn's AI SDK stream told as the eve events the shared relay reads.
 *
 * `HarnessAgent.stream()` answers an AI SDK `fullStream`: `start-step`,
 * reasoning and text in start/delta/end runs, `tool-call` and
 * `tool-result` (or `tool-error`) by call id, `finish-step` with the
 * step's usage, and `finish`, `error`, or `abort` to end it. The store's
 * one writer is fed by `StreamRelay` from eve's own events, so rather than
 * a second relay this tells each part as the eve event of the same moment
 * (`step.started`, `actions.requested`, `action.result`,
 * `reasoning.completed`, `message.appended`/`message.completed`,
 * `step.completed`, `turn.completed`/`turn.failed`/`turn.cancelled`), and
 * the relay writes the turn exactly as it writes an eve turn: the journal
 * while it runs, the answer when it ends, the usage on the turn row. Each
 * part is read through a Schema at the boundary, so a part this build does
 * not know (`raw`, `tool-input-*`, approvals) is passed over rather than
 * guessed at. Codex reports its usage on `finish` alone, so the last step
 * is told again with the remainder the steps did not carry, and the relay,
 * which keeps one usage per step, counts the turn whole. What the
 * translator holds between parts is plain state; a host that resumes a
 * turn after its function died would persist it beside the relay's.
 */

const UsageSchema = Schema.Struct({
  inputTokens: Schema.optionalKey(Schema.UndefinedOr(Schema.Number)),
  outputTokens: Schema.optionalKey(Schema.UndefinedOr(Schema.Number)),
  inputTokenDetails: Schema.optionalKey(
    Schema.Struct({ cacheReadTokens: Schema.optionalKey(Schema.UndefinedOr(Schema.Number)) }),
  ),
});

type PartUsage = typeof UsageSchema.Type;

const HarnessPartSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start-step") }),
  Schema.Struct({ type: Schema.Literals(["reasoning-start", "text-start"]), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literals(["reasoning-delta", "text-delta"]),
    id: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literals(["reasoning-end", "text-end"]), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool-call"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-result"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    output: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-error"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    error: Schema.Unknown,
  }),
  Schema.Struct({ type: Schema.Literal("finish-step"), usage: UsageSchema }),
  Schema.Struct({ type: Schema.Literal("finish"), totalUsage: UsageSchema }),
  Schema.Struct({ type: Schema.Literal("error"), error: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("abort") }),
]);

type HarnessPart = typeof HarnessPartSchema.Type;

const readPart = Schema.decodeUnknownOption(HarnessPartSchema);

/** The code a failed harness turn is recorded under; the message beside it is redacted by the relay. */
const HARNESS_TURN_FAILURE = "HARNESS_TURN_FAILED";

/** eve's word for the end of a step, which the relay does not read; every harness step ends as `stop` here. */
const STEP_FINISH = "stop";

/** A harness error's words, as far as they are words at all. */
function errorWords(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "the harness turn failed";
}

/** A step's usage in eve's words, and what it adds up to. */
interface StepTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

function tokensOf(usage: PartUsage): StepTokens {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  };
}

/** One harness turn's translator: fed every part in order, it answers the eve events each amounts to. */
export class HarnessTurnEvents {
  readonly #turnId: string;
  readonly #modelId: string;
  readonly #now: () => number;
  #ordinal = 0;
  #step = -1;
  #ended = false;
  #reasoning = new Map<string, string>();
  #text = new Map<string, string>();
  #names = new Map<string, string>();
  #stepTokens = new Map<number, StepTokens>();

  constructor(options: {
    readonly turnId: string;
    readonly modelId: string;
    readonly now: () => number;
  }) {
    this.#turnId = options.turnId;
    this.#modelId = options.modelId;
    this.#now = options.now;
  }

  /** Whether the turn has been told to end. */
  get ended(): boolean {
    return this.#ended;
  }

  /** The turn's opening: its start and the developer's words it received. */
  opening(message: string): MessageStreamEvent[] {
    return [
      this.#stamp({ type: "turn.started", data: { turnId: this.#turnId, sequence: 0 } }),
      this.#stamp({
        type: "message.received",
        data: { turnId: this.#turnId, sequence: 0, message },
      }),
    ];
  }

  /** The events one part of the stream amounts to; a part this build does not know amounts to none. */
  events(raw: unknown): MessageStreamEvent[] {
    if (this.#ended) return [];
    const part = readPart(raw);
    return Option.isSome(part) ? this.#told(part.value) : [];
  }

  /** The turn ended without a part saying so: the caller stopped it. */
  cancelled(): MessageStreamEvent[] {
    if (this.#ended) return [];
    this.#ended = true;
    return [this.#stamp({ type: "turn.cancelled", data: { turnId: this.#turnId, sequence: 0 } })];
  }

  #told(part: HarnessPart): MessageStreamEvent[] {
    const turnId = this.#turnId;
    const sequence = 0;
    const stepIndex = Math.max(this.#step, 0);
    switch (part.type) {
      case "start-step":
        this.#step += 1;
        return [
          this.#stamp({
            type: "step.started",
            data: { turnId, sequence, stepIndex: this.#step, modelId: this.#modelId },
          }),
        ];
      case "reasoning-start":
        this.#reasoning.set(part.id, "");
        return [];
      case "reasoning-delta":
        this.#reasoning.set(part.id, (this.#reasoning.get(part.id) ?? "") + part.text);
        return [];
      case "reasoning-end": {
        const reasoning = this.#reasoning.get(part.id) ?? "";
        this.#reasoning.delete(part.id);
        if (reasoning.length === 0) return [];
        return [
          this.#stamp({
            type: "reasoning.completed",
            data: { turnId, sequence, stepIndex, reasoning },
          }),
        ];
      }
      case "text-start":
        this.#text.set(part.id, "");
        return [];
      case "text-delta":
        this.#text.set(part.id, (this.#text.get(part.id) ?? "") + part.text);
        return [
          this.#stamp({
            type: "message.appended",
            data: { turnId, sequence, stepIndex, messageDelta: part.text },
          }),
        ];
      case "text-end": {
        const message = this.#text.get(part.id) ?? "";
        this.#text.delete(part.id);
        return [
          this.#stamp({
            type: "message.completed",
            data: { turnId, sequence, stepIndex, finishReason: STEP_FINISH, message },
          }),
        ];
      }
      case "tool-call": {
        const call = coderCallOf(part.toolName, part.input);
        this.#names.set(part.toolCallId, call.name);
        return [
          this.#stamp({
            type: "actions.requested",
            data: {
              turnId,
              sequence,
              stepIndex,
              actions: [
                {
                  kind: "tool-call",
                  callId: part.toolCallId,
                  toolName: call.name,
                  input: isRecord(call.input) ? call.input : {},
                },
              ],
            },
          }),
        ];
      }
      case "tool-result":
      case "tool-error": {
        const name = this.#names.get(part.toolCallId) ?? coderCallOf(part.toolName, {}).name;
        const failed = part.type === "tool-error";
        const output = failed ? errorWords(part.error) : coderOutputOf(name, part.output);
        return [
          this.#stamp({
            type: "action.result",
            data: {
              turnId,
              sequence,
              stepIndex,
              status: failed ? "failed" : "completed",
              result: {
                kind: "tool-result",
                callId: part.toolCallId,
                toolName: name,
                output: output ?? null,
                ...(failed ? { isError: true } : undefined),
              },
            },
          } as Omit<MessageStreamEvent, "meta">),
        ];
      }
      case "finish-step": {
        const tokens = tokensOf(part.usage);
        this.#stepTokens.set(stepIndex, tokens);
        return [this.#stepCompleted(stepIndex, tokens)];
      }
      case "finish": {
        this.#ended = true;
        return [
          ...this.#remainder(tokensOf(part.totalUsage)),
          this.#stamp({ type: "turn.completed", data: { turnId, sequence } }),
        ];
      }
      case "error":
        this.#ended = true;
        return [
          this.#stamp({
            type: "turn.failed",
            data: { turnId, sequence, code: HARNESS_TURN_FAILURE, message: errorWords(part.error) },
          }),
        ];
      case "abort":
        return this.cancelled();
    }
  }

  /** The last step told again with whatever of the turn's total its steps did not carry, which is all of it for Codex. */
  #remainder(total: StepTokens): MessageStreamEvent[] {
    const told = [...this.#stepTokens.values()].reduce(
      (sum, step) => ({
        inputTokens: sum.inputTokens + step.inputTokens,
        outputTokens: sum.outputTokens + step.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + step.cacheReadTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    );
    const missing = {
      inputTokens: Math.max(total.inputTokens - told.inputTokens, 0),
      outputTokens: Math.max(total.outputTokens - told.outputTokens, 0),
      cacheReadTokens: Math.max(total.cacheReadTokens - told.cacheReadTokens, 0),
    };
    if (missing.inputTokens + missing.outputTokens + missing.cacheReadTokens === 0) return [];
    const last = Math.max(this.#step, 0);
    const before = this.#stepTokens.get(last) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    };
    return [
      this.#stepCompleted(last, {
        inputTokens: before.inputTokens + missing.inputTokens,
        outputTokens: before.outputTokens + missing.outputTokens,
        cacheReadTokens: before.cacheReadTokens + missing.cacheReadTokens,
      }),
    ];
  }

  #stepCompleted(stepIndex: number, tokens: StepTokens): MessageStreamEvent {
    return this.#stamp({
      type: "step.completed",
      data: {
        turnId: this.#turnId,
        sequence: 0,
        stepIndex,
        finishReason: STEP_FINISH,
        usage: tokens,
      },
    });
  }

  /** The envelope eve stamps: an id that sorts in emission order, and the time. */
  #stamp(event: Omit<MessageStreamEvent, "meta">): MessageStreamEvent {
    this.#ordinal += 1;
    const id = `hevt_${this.#turnId}_${String(this.#ordinal).padStart(8, "0")}`;
    // SAFETY: the envelope is the one eve stamps; the union member is the event handed in.
    return {
      ...event,
      meta: { id, at: new Date(this.#now()).toISOString() },
    } as MessageStreamEvent;
  }
}
