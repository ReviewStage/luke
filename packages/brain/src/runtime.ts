import { type ItemFormatIdentity, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  type AgentRuntimeEffect,
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
  RuntimeResumeRefused,
  type RuntimeRunEffect,
  type RuntimeRunEnd,
  type RuntimeRunRequestEffect,
  type ToolInvocation,
  type ToolResult,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type UnknownActionResult } from "@sidecar/wire";
import { Cause, Effect, Exit, Fiber } from "effect";
import { compactContext } from "./compaction.js";
import { whenAborted } from "./effect/settled.js";
import { LOOP_GUARD_LEVEL, LoopGuard, type LoopGuardConfig } from "./loop-guard.js";
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
  /** The end already told to the run's listener, so a second one is never told. */
  told?: RuntimeRunEnd;
}

export function incompleteDetail(incomplete: ModelIncomplete): string {
  return `${incomplete.status ?? "incomplete"}: ${incomplete.reason}`;
}

export class ToolLoopAgentRuntime implements AgentRuntimeEffect {
  readonly #options: ToolLoopRuntimeOptions;
  readonly #checkpoint: CheckpointFormat;
  /** One ask at a time, so a second caller reads the answer the first kept rather than spending a call of its own. */
  readonly #asking = Effect.unsafeMakeSemaphore(1);
  #capabilities: { readonly answer: ModelCapabilities | undefined } | undefined;

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

  /**
   * Asked once and kept: a hosted adapter reads the service for it, and the
   * answer does not change within a build. An adapter that threw answers
   * nothing rather than failing the turn that asked, exactly as the host's
   * compaction policy reads a model that cannot say.
   */
  capabilities(): Effect.Effect<ModelCapabilities | undefined> {
    return this.#asking.withPermits(1)(
      Effect.suspend(() => {
        const kept = this.#capabilities;
        if (kept) return Effect.succeed(kept.answer);
        return Effect.promise(() => this.#options.model.capabilities()).pipe(
          Effect.map((answer) =>
            answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED ? answer.capabilities : undefined,
          ),
          Effect.catchAllDefect(() => Effect.succeed(undefined)),
          Effect.tap((answer) =>
            Effect.sync(() => {
              this.#capabilities = { answer };
            }),
          ),
        );
      }),
    );
  }

  /** The runtime's own compaction: the engine's fold behind a summary the model writes, kept to the model's window. */
  compact(context: ContextEngine, options: CompactionOptions): Effect.Effect<RuntimeCompaction> {
    return Effect.flatMap(this.capabilities(), (capabilities) =>
      Effect.promise(() =>
        compactContext(context, this.#options.model, { ...options, capabilities }),
      ),
    );
  }

  openContext(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResult: UnknownActionResult,
    lifecycle?: ContextLifecycle,
  ): Effect.Effect<ContextOpening> {
    return Effect.suspend(() => {
      const context = this.#options.createContext(this.#checkpoint);
      return Effect.map(
        Effect.promise(async () => await context.bootstrap(checkpoint, lostResult, lifecycle)),
        (bootstrap) => ({ context, bootstrap }),
      );
    });
  }

  resume(
    checkpoint: RuntimeCheckpoint,
    request: Omit<RuntimeRunRequestEffect, "context">,
    lostResult: UnknownActionResult,
  ): Effect.Effect<RuntimeRunEffect, RuntimeResumeRefused> {
    return Effect.flatMap(this.openContext(checkpoint, lostResult), ({ context, bootstrap }) =>
      bootstrap.loaded
        ? Effect.succeed(this.start({ ...request, context }))
        : Effect.fail(
            new RuntimeResumeRefused({ reason: bootstrap.reason ?? "checkpoint not loaded" }),
          ),
    );
  }

  /**
   * The run's execution ends on every terminal path — completion, cancel,
   * deadline, throttle, failure, the guard, or a listener or engine that
   * threw — and from that instant every context the run handed an executor
   * answers revoked and late words are refused, so nothing prepared inside
   * the run can act after it.
   */
  start(request: RuntimeRunRequestEffect): RuntimeRunEffect {
    const internal = new AbortController();
    const signal = AbortSignal.any([request.signal, internal.signal]);
    const end: EndSignal = { deadline: false, ended: false };
    const steered: ContextInput[] = [];
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
      done: this.#run(request, signal, end, steered),
    };
  }

  /**
   * One run, as the fiber it is. The loop between the model and its tools
   * runs in a fiber of its own and the signal interrupts it, so a cancel, a
   * deadline, or the host's own revocation reaches every wait the loop holds
   * — a model answer, an engine's hook — at once, and the late answer is
   * never read. The cancelled end is settled out here rather than inside the
   * loop: it follows the loop's own exit, so a batch of calls the loop was in
   * the middle of pairing is paired in full before the run answers, and it
   * runs where no interruption can reach it, so a run that was cancelled
   * still tells its end exactly once.
   */
  #run(
    request: RuntimeRunRequestEffect,
    signal: AbortSignal,
    end: EndSignal,
    steered: ContextInput[],
  ): Effect.Effect<RuntimeRunEnd> {
    const emit = request.onEvent;
    // Every end a listener hears is uninterruptible: a run whose signal fired
    // as it was finishing still tells the end it reached rather than losing it
    // to the interruption that arrived in the middle of the telling. The end
    // is written down before it is told, because the fiber is interruptible
    // again the instant the telling is over: an end already told is the run's
    // answer even when the interruption that was waiting takes the fiber
    // immediately afterwards, and a second end is never told.
    const finish = (result: RuntimeRunEnd): Effect.Effect<RuntimeRunEnd> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          end.ended = true;
          end.told = result;
          yield* emit({ kind: RUNTIME_EVENT.ENDED, end: result });
          return result;
        }),
      );
    const cancelled = Effect.uninterruptible(
      Effect.gen(function* () {
        end.ended = true;
        yield* emit({ kind: RUNTIME_EVENT.CANCELLED, deadline: end.deadline });
        return yield* finish({
          reason: end.deadline ? RUN_END_REASON.DEADLINE : RUN_END_REASON.CANCELLED,
        });
      }),
    );
    const loop = this.#loop(request, signal, end, steered, emit, finish);
    return Effect.gen(function* () {
      const running = yield* Effect.fork(loop);
      yield* Effect.fork(Effect.zipRight(whenAborted(signal), Fiber.interrupt(running)));
      const exit = yield* Fiber.await(running);
      if (Exit.isSuccess(exit)) return exit.value;
      if (!Cause.isInterruptedOnly(exit.cause)) return yield* Effect.failCause(exit.cause);
      return end.told ?? (yield* cancelled);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          end.ended = true;
        }),
      ),
    );
  }

  /**
   * The loop itself: the opening words ingested, then the model asked and its
   * calls dispatched until it answers with none. Nothing here reads the
   * signal — the fiber's interruption is what a cancel, a deadline, and the
   * host's revocation all reach it as — so the loop states only how a run
   * ends of its own accord.
   */
  #loop(
    request: RuntimeRunRequestEffect,
    signal: AbortSignal,
    end: EndSignal,
    steered: ContextInput[],
    emit: (event: RuntimeEvent) => Effect.Effect<void>,
    finish: (result: RuntimeRunEnd) => Effect.Effect<RuntimeRunEnd>,
  ): Effect.Effect<RuntimeRunEnd> {
    const { context, tools } = request;
    const model = this.#options.model;
    const guard = new LoopGuard(
      this.#options.loopGuard,
      request.toolSchemas.map((schema) => schema.name),
    );
    const revoked = () => end.ended || signal.aborted;
    const lifecycle: ContextLifecycle = { signal };
    const engine = <Value>(work: () => MaybePromise<Value>): Effect.Effect<Value> =>
      Effect.promise(async () => await work());
    const ingest = (input: ContextInput): Effect.Effect<void> =>
      engine(() => context.ingest(input, lifecycle));
    const executeOne = (call: ToolInvocation): Effect.Effect<ToolResult> =>
      executeToolCall(call, tools, request.runId, signal, revoked);
    /**
     * Every call the model emitted, dispatched in the order it emitted them,
     * and uninterruptible as one: a cancel that lands mid-batch neither
     * leaves a call without an output nor cuts a dispatched effect off from
     * the result the host checkpoints for it. The run ends the instant the
     * batch does, on the interruption that was waiting for it.
     */
    const dispatch = (calls: readonly ToolInvocation[]): Effect.Effect<RuntimeRunEnd | undefined> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
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
                yield* ingest({
                  kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
                  callId: refused.callId,
                  outputJson: result.outputJson,
                });
                yield* emit({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation: refused, result });
              }
              yield* emit({ kind: RUNTIME_EVENT.LOOP_GUARD, detail: verdict.message });
              return yield* finish({
                reason: RUN_END_REASON.LOOP_GUARD,
                detail: verdict.message,
              });
            }
            yield* emit({ kind: RUNTIME_EVENT.TOOL_CALL, invocation: call });
            const result = yield* executeOne(call);
            yield* ingest({
              kind: CONTEXT_INPUT_KIND.TOOL_RESULT,
              callId: call.callId,
              outputJson: result.outputJson,
            });
            guard.record(call, result);
            yield* emit({ kind: RUNTIME_EVENT.TOOL_RESULT, invocation: call, result });
            if (verdict.stuck) {
              // A warning is words for the model, read at its next inference and never kept as an action.
              yield* ingest({
                kind: CONTEXT_INPUT_KIND.USER_TEXT,
                text: `${LOOP_GUARD_MARKER} ${verdict.message}`,
              });
              yield* emit({ kind: RUNTIME_EVENT.LOOP_GUARD, detail: verdict.message });
            }
          }
          return undefined;
        }),
      );
    return Effect.gen(function* () {
      // A run whose signal fired before it opened reads nothing and ingests
      // nothing: the fiber ends as the interruption its caller asked for, and
      // the cancelled end is settled outside it like every other.
      if (signal.aborted) return yield* Effect.interrupt;
      for (const input of request.input) yield* ingest(input);
      for (;;) {
        const taken = steered.splice(0);
        for (const input of taken) yield* ingest(input);
        // The host hears that the steered words are now in the context, so it
        // can tell which checkpoint first carries them; nothing else changes.
        if (taken.length > 0) yield* emit({ kind: RUNTIME_EVENT.STEERED, inputs: taken.length });
        const assembled = yield* engine(() =>
          context.assemble({ ephemeral: request.ephemeral() }, lifecycle),
        );
        const answer = yield* Effect.promise(() =>
          model.respond(assembled, {
            prompt: request.prompt,
            tools: request.toolSchemas,
            maximumOutputTokens: request.maximumOutputTokens,
            ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : undefined),
            ...(request.promptCacheKey !== undefined
              ? { promptCacheKey: request.promptCacheKey }
              : undefined),
            signal,
          }),
        );
        if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
          yield* emit({ kind: RUNTIME_EVENT.THROTTLED, until: answer.until });
          return yield* finish({ reason: RUN_END_REASON.THROTTLED, until: answer.until });
        }
        if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
          yield* emit({
            kind: RUNTIME_EVENT.PROVIDER_FAILURE,
            failure: answer.failure,
            reason: answer.reason,
          });
          return yield* finish({
            reason: RUN_END_REASON.PROVIDER_FAILURE,
            failure: answer.failure,
            detail: answer.reason,
          });
        }
        const continued = yield* absorb(answer, emit, ingest);
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
            return yield* finish({
              reason: RUN_END_REASON.INCOMPLETE,
              detail: incompleteDetail(answer.incomplete),
            });
          }
          return yield* finish({
            reason: RUN_END_REASON.COMPLETED,
            text: answer.text,
            ...(answer.incomplete ? { incomplete: answer.incomplete } : undefined),
          });
        }
        const guarded = yield* dispatch([...answer.toolCalls]);
        if (guarded !== undefined) return guarded;
      }
    });
  }
}

/** Keeps what the answer carried; answers whether there are calls to run. */
function absorb(
  answer: ModelAnswer,
  emit: (event: RuntimeEvent) => Effect.Effect<void>,
  ingest: (input: ContextInput) => Effect.Effect<void>,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    yield* emit({
      kind: RUNTIME_EVENT.ANSWERED,
      toolNames: answer.toolCalls.map((call) => call.name),
    });
    if (answer.responseId !== undefined) {
      yield* emit({ kind: RUNTIME_EVENT.RESPONSE, responseId: answer.responseId });
    }
    yield* ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: answer.items });
    for (const reasoning of answer.reasoning ?? []) {
      yield* emit({ kind: RUNTIME_EVENT.REASONING, reasoning });
    }
    if (answer.usage) yield* emit({ kind: RUNTIME_EVENT.USAGE, usage: answer.usage });
    // Every answer's text is reported, the empty one included, so a listener
    // keeping the latest words holds what the final answer actually said.
    yield* emit({ kind: RUNTIME_EVENT.TEXT, text: answer.text });
    if (answer.incomplete) {
      yield* emit({ kind: RUNTIME_EVENT.INCOMPLETE, incomplete: answer.incomplete });
    }
    return answer.toolCalls.length > 0;
  });
}

/** One call, handed to the executor; a tool that threw instead of answering is told as unknown rather than left dangling. */
function executeToolCall(
  call: ToolInvocation,
  tools: RuntimeRunRequestEffect["tools"],
  runId: string,
  signal: AbortSignal,
  revoked: () => boolean,
): Effect.Effect<ToolResult> {
  return Effect.gen(function* () {
    const result = yield* Effect.merge(
      Effect.tryPromise({
        try: async () => await tools.execute(call, { runId, signal, isRevoked: revoked }),
        catch: (): ToolResult => ({
          outputJson: JSON.stringify(TOOL_DID_NOT_ANSWER),
          status: TOOL_DID_NOT_ANSWER.status,
        }),
      }),
    );
    const status = result.status ?? outputStatus(result.outputJson);
    return status !== undefined ? { outputJson: result.outputJson, status } : result;
  });
}
