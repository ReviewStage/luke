import {
  type AgentRuntime,
  type AgentRuntimeDescriptor,
  type CheckpointFormat,
  CONTEXT_INPUT_KIND,
  type ContextBootstrap,
  type ContextEngine,
  type ContextInput,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelAnswer,
  RUN_END_REASON,
  RUNTIME_EVENT,
  type RuntimeCheckpoint,
  type RuntimeEvent,
  type RuntimeRun,
  type RuntimeRunEnd,
  type RuntimeRunRequest,
  sameCheckpointFormat,
  type ToolInvocation,
  type ToolResult,
} from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { LOOP_GUARD_LEVEL, LoopGuard, type LoopGuardConfig } from "./loop-guard.js";
import { settledUnlessAborted } from "./settled.js";

/**
 * The loop between a model and its tools, and nothing outside it. A run
 * ingests its opening words, asks the model, hands every tool call to the
 * executor in the order the model emitted them — one at a time, awaiting the
 * host's listener after each result so nothing is asked of the model before
 * the host has recorded what the tool did — and asks again until the model
 * answers with no calls. It ends through completion, the host's cancel or
 * deadline, a throttle, a provider failure, an answer that stopped short, or
 * the loop guard when a configuration has enabled it. There is no count of
 * iterations that ends it.
 *
 * The runtime knows no provider: items are opaque records the context engine
 * owns, and the model adapter normalizes whatever it speaks to. Its
 * checkpoint stamp is its own id and version joined to the engine's item
 * format, so a checkpoint is readable only by this runtime at this version
 * over an engine of that format.
 */

export const TOOL_LOOP_RUNTIME = {
  ID: "tool-loop",
  VERSION: 1,
} as const;

/** The runtime as a context engine is told who writes its checkpoints. */
export const TOOL_LOOP_RUNTIME_IDENTITY = {
  id: TOOL_LOOP_RUNTIME.ID,
  version: TOOL_LOOP_RUNTIME.VERSION,
} as const;

/** What the model is told about a call the guard refused to dispatch. */
const LOOP_GUARD_REFUSAL_REASON = "not run: the loop guard ended this run";
const LOOP_GUARD_MARKER = "[loop guard]";
/** What the model is told about a tool that threw instead of answering; the executor is expected to catch its own. */
const TOOL_DID_NOT_ANSWER = {
  status: "unknown",
  reason: "the tool did not answer; it may have run, so do not repeat it",
} as const;

export interface ToolLoopRuntimeOptions {
  model: ModelAdapter;
  /** The item format of the engines this runtime opens. */
  itemFormat: { format: string; version: number };
  createContext: (format: CheckpointFormat) => ContextEngine;
  loopGuard?: LoopGuardConfig;
}

interface EndSignal {
  deadline: boolean;
}

function resultStatus(outputJson: string): string | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the record and string checks are the validation.
    const parsed = JSON.parse(outputJson) as UnparsedWireValue;
    return isRecord(parsed) && typeof parsed.status === "string" ? parsed.status : undefined;
  } catch {
    return undefined;
  }
}

export class ToolLoopAgentRuntime implements AgentRuntime {
  readonly descriptor: AgentRuntimeDescriptor;
  readonly #options: ToolLoopRuntimeOptions;

  constructor(options: ToolLoopRuntimeOptions) {
    this.#options = options;
    this.descriptor = {
      id: TOOL_LOOP_RUNTIME.ID,
      checkpoint: {
        runtime: TOOL_LOOP_RUNTIME.ID,
        runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
        format: options.itemFormat.format,
        formatVersion: options.itemFormat.version,
      },
    };
  }

  openContext(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResultJson: string,
  ): { context: ContextEngine; bootstrap: ContextBootstrap } {
    const context = this.#options.createContext(this.descriptor.checkpoint);
    return { context, bootstrap: context.bootstrap(checkpoint, lostResultJson) };
  }

  resume(
    checkpoint: RuntimeCheckpoint,
    request: Omit<RuntimeRunRequest, "context">,
    lostResultJson: string,
  ): RuntimeRun | { readonly refused: string } {
    if (!sameCheckpointFormat(checkpoint.format, this.descriptor.checkpoint)) {
      return { refused: "checkpoint format is not this runtime's" };
    }
    const { context, bootstrap } = this.openContext(checkpoint, lostResultJson);
    if (!bootstrap.loaded) return { refused: bootstrap.reason ?? "checkpoint not loaded" };
    return this.start({ ...request, context });
  }

  start(request: RuntimeRunRequest): RuntimeRun {
    const internal = new AbortController();
    const signal = AbortSignal.any([request.signal, internal.signal]);
    const end: EndSignal = { deadline: false };
    const steered: ContextInput[] = [];
    const done = this.#execute(request, signal, end, steered);
    return {
      runId: request.runId,
      steer: (input) => {
        steered.push(input);
      },
      cancel: (reason) => {
        if (reason?.deadline) end.deadline = true;
        internal.abort();
      },
      done,
    };
  }

  async #execute(
    request: RuntimeRunRequest,
    signal: AbortSignal,
    end: EndSignal,
    steered: ContextInput[],
  ): Promise<RuntimeRunEnd> {
    const emit = async (event: RuntimeEvent) => {
      await request.onEvent(event);
    };
    const finish = async (result: RuntimeRunEnd): Promise<RuntimeRunEnd> => {
      await emit({ kind: RUNTIME_EVENT.ENDED, end: result });
      return result;
    };
    const cancelled = async (): Promise<RuntimeRunEnd> => {
      await emit({ kind: RUNTIME_EVENT.CANCELLED, deadline: end.deadline });
      return finish({ reason: end.deadline ? RUN_END_REASON.DEADLINE : RUN_END_REASON.CANCELLED });
    };
    const { context, tools } = request;
    const guard = new LoopGuard(
      this.#options.loopGuard,
      request.toolSchemas.map((schema) => schema.name),
    );
    for (const input of request.input) context.ingest(input);
    for (;;) {
      if (signal.aborted) return cancelled();
      for (const input of steered.splice(0)) context.ingest(input);
      const answered = await settledUnlessAborted(
        this.#options.model.respond(context.assemble({ ephemeral: request.ephemeral() }), {
          prompt: request.prompt,
          tools: request.toolSchemas,
          maximumOutputTokens: request.maximumOutputTokens,
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : undefined),
          signal,
        }),
        signal,
      );
      if (answered.aborted || signal.aborted) return cancelled();
      const answer = answered.value;
      if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
        await emit({ kind: RUNTIME_EVENT.THROTTLED, until: answer.until });
        return finish({ reason: RUN_END_REASON.THROTTLED, until: answer.until });
      }
      if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
        await emit({
          kind: RUNTIME_EVENT.PROVIDER_FAILURE,
          failure: answer.failure,
          reason: answer.reason,
        });
        return finish({
          reason: RUN_END_REASON.PROVIDER_FAILURE,
          failure: answer.failure,
          detail: answer.reason,
        });
      }
      const continued = await this.#absorb(answer, request, emit);
      if (!continued) {
        if (answer.incomplete && !answer.text) {
          await emit({ kind: RUNTIME_EVENT.INCOMPLETE, incomplete: answer.incomplete });
          return finish({
            reason: RUN_END_REASON.INCOMPLETE,
            detail: `${answer.incomplete.status ?? "incomplete"}: ${answer.incomplete.reason}`,
          });
        }
        return finish({ reason: RUN_END_REASON.COMPLETED, text: answer.text });
      }
      // Calls run in the order the model emitted them, one at a time, and the
      // listener is awaited after each result: an act is recorded before the
      // next starts, and a cancel landing between two reaches the executor,
      // which refuses the second rather than racing it.
      const calls = [...answer.toolCalls];
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        if (!call) continue;
        const verdict = guard.detect(call);
        if (verdict.stuck && verdict.level === LOOP_GUARD_LEVEL.CRITICAL) {
          // Every remaining call still gets an output so the context never
          // holds a dangling call; the run then ends as the guard's.
          for (const refused of calls.slice(index)) {
            const result: ToolResult = {
              outputJson: JSON.stringify({
                status: ACT_RESULT_STATUS.REJECTED,
                reason: LOOP_GUARD_REFUSAL_REASON,
              }),
              status: ACT_RESULT_STATUS.REJECTED,
            };
            context.ingest({
              kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
              callId: refused.callId,
              outputJson: result.outputJson,
            });
            await emit({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation: refused, result });
          }
          await emit({ kind: RUNTIME_EVENT.LOOP_GUARD, detail: verdict.message });
          return finish({ reason: RUN_END_REASON.LOOP_GUARD, detail: verdict.message });
        }
        await emit({ kind: RUNTIME_EVENT.TOOL_CALL, invocation: call });
        const result = await this.#executeOne(call, tools, request.runId, signal);
        context.ingest({
          kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
          callId: call.callId,
          outputJson: result.outputJson,
        });
        guard.record(call, result);
        await emit({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation: call, result });
        if (verdict.stuck) {
          // A warning is words for the model, read at its next inference and never kept as an act.
          context.ingest({
            kind: CONTEXT_INPUT_KIND.USER_TEXT,
            text: `${LOOP_GUARD_MARKER} ${verdict.message}`,
          });
          await emit({ kind: RUNTIME_EVENT.LOOP_GUARD, detail: verdict.message });
        }
      }
      if (signal.aborted) return cancelled();
    }
  }

  /** Keeps what the answer carried; answers whether there are calls to run. */
  async #absorb(
    answer: ModelAnswer,
    request: RuntimeRunRequest,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<boolean> {
    request.context.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: answer.items });
    if (answer.compacted) {
      const dropped = request.context.compact();
      await emit({ kind: RUNTIME_EVENT.COMPACTED, dropped });
    }
    if (answer.usage) await emit({ kind: RUNTIME_EVENT.USAGE, usage: answer.usage });
    if (answer.text) await emit({ kind: RUNTIME_EVENT.TEXT, text: answer.text });
    return answer.toolCalls.length > 0;
  }

  async #executeOne(
    call: ToolInvocation,
    tools: RuntimeRunRequest["tools"],
    runId: string,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await tools.execute(call, { runId, signal, isRevoked: () => signal.aborted });
    } catch {
      result = {
        outputJson: JSON.stringify(TOOL_DID_NOT_ANSWER),
        status: TOOL_DID_NOT_ANSWER.status,
      };
    }
    const status = result.status ?? resultStatus(result.outputJson);
    return status !== undefined ? { outputJson: result.outputJson, status } : result;
  }
}
