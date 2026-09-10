import { type ItemFormatIdentity, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  type AgentRuntime,
  type CheckpointFormat,
  CONTEXT_INPUT_KIND,
  type CompactionOptions,
  type ContextEngine,
  type ContextInput,
  type ContextLifecycle,
  type ContextOpening,
  type MaybePromise,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelAnswer,
  type ModelCapabilities,
  type ModelIncomplete,
  RUN_END_REASON,
  RUNTIME_EVENT,
  type RuntimeCheckpoint,
  type RuntimeCompaction,
  type RuntimeEvent,
  type RuntimeIdentity,
  type RuntimeRun,
  type RuntimeRunEnd,
  type RuntimeRunRequest,
  type ToolInvocation,
  type ToolResult,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { compactContext } from "./compaction.js";
import { LOOP_GUARD_LEVEL, LoopGuard, type LoopGuardConfig } from "./loop-guard.js";
import { settledUnlessAborted } from "./settled.js";
import { outputStatus } from "./tool-results.js";

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

/** What the model is told about a call the guard refused to dispatch. */
const LOOP_GUARD_REFUSAL_REASON = "not run: the loop guard ended this run";
const LOOP_GUARD_MARKER = "[loop guard]";
/** The statuses the runtime itself puts on a tool's result, beside the action statuses a performer answers with. */
export const TOOL_RESULT_STATUS = {
  UNKNOWN: "unknown",
  ANSWERED: "answered",
} as const;

/** What the model is told about a tool that threw instead of answering; the executor is expected to catch its own. */
const TOOL_DID_NOT_ANSWER = {
  status: TOOL_RESULT_STATUS.UNKNOWN,
  reason: "the tool did not answer; it may have run, so do not repeat it",
} as const;

export interface ToolLoopRuntimeOptions {
  model: ModelAdapter;
  /** The item format of the engines this runtime opens. */
  itemFormat: ItemFormatIdentity;
  createContext: (format: CheckpointFormat) => ContextEngine;
  loopGuard?: LoopGuardConfig;
}

interface EndSignal {
  deadline: boolean;
  ended: boolean;
}

export function incompleteDetail(incomplete: ModelIncomplete): string {
  return `${incomplete.status ?? "incomplete"}: ${incomplete.reason}`;
}

export class ToolLoopAgentRuntime implements AgentRuntime {
  readonly #options: ToolLoopRuntimeOptions;
  readonly #checkpoint: CheckpointFormat;
  #capabilities: Promise<ModelCapabilities | undefined> | undefined;

  constructor(options: ToolLoopRuntimeOptions) {
    this.#options = options;
    this.#checkpoint = {
      runtime: TOOL_LOOP_RUNTIME.ID,
      runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
      format: options.itemFormat.format,
      formatVersion: options.itemFormat.version,
    };
  }

  /** Read on each ask, because a hosted adapter learns its model only from the service's capabilities. */
  get descriptor(): RuntimeIdentity {
    const model = this.#options.model.model;
    return {
      id: TOOL_LOOP_RUNTIME.ID,
      checkpoint: this.#checkpoint,
      ...(model ? { model } : undefined),
    };
  }

  quietUntil(): number | undefined {
    return this.#options.model.quietUntil();
  }

  /** Asked once and kept: a hosted adapter reads the service for it, and the answer does not change within a build. */
  capabilities(): Promise<ModelCapabilities | undefined> {
    this.#capabilities ??= this.#options.model.capabilities().then(
      (answer) =>
        answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED ? answer.capabilities : undefined,
      () => undefined,
    );
    return this.#capabilities;
  }

  /** The runtime's own compaction: the model's explicit one where it compacts, the engine's fold behind a summary otherwise. */
  async compact(context: ContextEngine, options: CompactionOptions): Promise<RuntimeCompaction> {
    return compactContext(context, this.#options.model, {
      ...options,
      capabilities: await this.capabilities(),
    });
  }

  async openContext(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResultJson: string,
    lifecycle?: ContextLifecycle,
  ): Promise<ContextOpening> {
    const context = this.#options.createContext(this.#checkpoint);
    return { context, bootstrap: await context.bootstrap(checkpoint, lostResultJson, lifecycle) };
  }

  async resume(
    checkpoint: RuntimeCheckpoint,
    request: Omit<RuntimeRunRequest, "context">,
    lostResultJson: string,
  ): Promise<RuntimeRun | { readonly refused: string }> {
    const { context, bootstrap } = await this.openContext(checkpoint, lostResultJson);
    if (!bootstrap.loaded) return { refused: bootstrap.reason ?? "checkpoint not loaded" };
    return this.start({ ...request, context });
  }

  /**
   * The run's execution ends on every terminal path — completion, cancel,
   * deadline, throttle, failure, the guard, or a listener or engine that
   * threw — and from that instant every context the run handed an executor
   * answers revoked and late words are refused, so nothing prepared inside
   * the run can act after it.
   */
  start(request: RuntimeRunRequest): RuntimeRun {
    const internal = new AbortController();
    const signal = AbortSignal.any([request.signal, internal.signal]);
    const end: EndSignal = { deadline: false, ended: false };
    const steered: ContextInput[] = [];
    // The end is decided synchronously: a cancel closes admission the instant
    // it is asked for, a terminal path closes it before any listener hears
    // the end, and the fallback below closes it when the execution threw.
    const done = this.#execute(request, signal, end, steered).finally(() => {
      end.ended = true;
    });
    return {
      runId: request.runId,
      steer: (input) => {
        if (end.ended || signal.aborted) return false;
        steered.push(input);
        return true;
      },
      cancel: (reason) => {
        if (reason?.deadline) end.deadline = true;
        end.ended = true;
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
      end.ended = true;
      await emit({ kind: RUNTIME_EVENT.ENDED, end: result });
      return result;
    };
    const cancelled = async (): Promise<RuntimeRunEnd> => {
      end.ended = true;
      await emit({ kind: RUNTIME_EVENT.CANCELLED, deadline: end.deadline });
      return finish({ reason: end.deadline ? RUN_END_REASON.DEADLINE : RUN_END_REASON.CANCELLED });
    };
    const { context, tools } = request;
    const guard = new LoopGuard(
      this.#options.loopGuard,
      request.toolSchemas.map((schema) => schema.name),
    );
    const revoked = () => end.ended || signal.aborted;
    const lifecycle: ContextLifecycle = { signal };
    // Every wait on the engine settles when the signal fires, like every wait
    // on the model: a held hook cannot keep a cancel or a deadline from
    // landing, and its late answer is not read.
    const engine = async <Value>(work: MaybePromise<Value>): Promise<Value | undefined> => {
      const settled = await settledUnlessAborted(Promise.resolve(work), signal);
      return settled.aborted ? undefined : settled.value;
    };
    const ingest = (input: ContextInput) => engine(context.ingest(input, lifecycle));
    for (const input of request.input) {
      await ingest(input);
      if (signal.aborted) return cancelled();
    }
    for (;;) {
      if (signal.aborted) return cancelled();
      const taken = steered.splice(0);
      for (const input of taken) {
        await ingest(input);
        if (signal.aborted) return cancelled();
      }
      // The host hears that the steered words are now in the context, so it
      // can tell which checkpoint first carries them; nothing else changes.
      if (taken.length > 0) await emit({ kind: RUNTIME_EVENT.STEERED, inputs: taken.length });
      const assembled = await engine(
        context.assemble({ ephemeral: request.ephemeral() }, lifecycle),
      );
      if (assembled === undefined || signal.aborted) return cancelled();
      const answered = await settledUnlessAborted(
        this.#options.model.respond(assembled, {
          prompt: request.prompt,
          tools: request.toolSchemas,
          maximumOutputTokens: request.maximumOutputTokens,
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : undefined),
          ...(request.promptCacheKey !== undefined
            ? { promptCacheKey: request.promptCacheKey }
            : undefined),
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
      const continued = await this.#absorb(answer, request, emit, ingest, lifecycle);
      if (signal.aborted) return cancelled();
      if (!continued && steered.length > 0) {
        // Words steered in while the model was answering are still unread: the
        // run is not over until the model has read them, so the loop goes
        // round once more with them rather than ending on a reply that never saw them.
        continue;
      }
      if (!continued) {
        // An answer that stopped short with no words is a run that fell short;
        // one that stopped short with words still ends completed, its words
        // authoritative, and the shortfall travels beside them.
        if (answer.incomplete && !answer.text) {
          return finish({
            reason: RUN_END_REASON.INCOMPLETE,
            detail: incompleteDetail(answer.incomplete),
          });
        }
        return finish({
          reason: RUN_END_REASON.COMPLETED,
          text: answer.text,
          ...(answer.incomplete ? { incomplete: answer.incomplete } : undefined),
        });
      }
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
                status: ACTION_RESULT_STATUS.REJECTED,
                reason: LOOP_GUARD_REFUSAL_REASON,
              }),
              status: ACTION_RESULT_STATUS.REJECTED,
            };
            await ingest({
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
        const result = await this.#executeOne(call, tools, request.runId, signal, revoked);
        await ingest({
          kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
          callId: call.callId,
          outputJson: result.outputJson,
        });
        guard.record(call, result);
        await emit({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation: call, result });
        if (verdict.stuck) {
          // A warning is words for the model, read at its next inference and never kept as an action.
          await ingest({
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
    ingest: (input: ContextInput) => Promise<void | undefined>,
    lifecycle: ContextLifecycle,
  ): Promise<boolean> {
    await emit({ kind: RUNTIME_EVENT.ANSWERED, toolCalls: answer.toolCalls.length });
    if (answer.responseId !== undefined) {
      await emit({ kind: RUNTIME_EVENT.RESPONSE, responseId: answer.responseId });
    }
    await ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: answer.items });
    if (lifecycle.signal?.aborted) return false;
    for (const reasoning of answer.reasoning ?? []) {
      await emit({ kind: RUNTIME_EVENT.REASONING, reasoning });
    }
    if (answer.compacted) {
      const settled = await settledUnlessAborted(
        Promise.resolve(request.context.compact(lifecycle)),
        lifecycle.signal ?? new AbortController().signal,
      );
      if (settled.aborted) return false;
      await emit({ kind: RUNTIME_EVENT.COMPACTED, dropped: settled.value });
    }
    if (answer.usage) await emit({ kind: RUNTIME_EVENT.USAGE, usage: answer.usage });
    // Every answer's text is reported, the empty one included, so a listener
    // keeping the latest words holds what the final answer actually said.
    await emit({ kind: RUNTIME_EVENT.TEXT, text: answer.text });
    if (answer.incomplete) {
      await emit({ kind: RUNTIME_EVENT.INCOMPLETE, incomplete: answer.incomplete });
    }
    return answer.toolCalls.length > 0;
  }

  async #executeOne(
    call: ToolInvocation,
    tools: RuntimeRunRequest["tools"],
    runId: string,
    signal: AbortSignal,
    revoked: () => boolean,
  ): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await tools.execute(call, { runId, signal, isRevoked: revoked });
    } catch {
      result = {
        outputJson: JSON.stringify(TOOL_DID_NOT_ANSWER),
        status: TOOL_DID_NOT_ANSWER.status,
      };
    }
    const status = result.status ?? outputStatus(result.outputJson);
    return status !== undefined ? { outputJson: result.outputJson, status } : result;
  }
}
