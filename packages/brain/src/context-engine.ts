import {
  type CheckpointFormat,
  CONTEXT_INPUT_KIND,
  type ContextAssembly,
  type ContextBootstrap,
  type ContextEngine,
  type ContextInput,
  type ContextMark,
  checkpointFormatTag,
  type RuntimeCheckpoint,
  sameCheckpointFormat,
} from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import { pairedDanglingCalls } from "./memory.js";
import {
  functionCallOutputItem,
  isCompactionItem,
  RESPONSES_ITEM_FORMAT,
  userMessageItem,
} from "./responses-api.js";

/**
 * The context engine for the OpenAI Responses input array. It is the one
 * place the brain reads a provider item's type: words become user messages,
 * a model's output items are kept verbatim so a reasoning model run
 * statelessly sees its own reasoning replayed beside the calls it preceded,
 * a tool's answer becomes the `function_call_output` paired to its call, and
 * a compaction item is the memory of everything before it, opaque and safe
 * to keep. What persists is the array from the latest compaction onward,
 * stamped with the runtime that wrote it and this item format, and an engine
 * loads only a checkpoint stamped exactly the same.
 */
export class ResponsesContextEngine implements ContextEngine {
  readonly checkpointFormat: CheckpointFormat;
  #items: WireRecord[] = [];

  constructor(runtime: { id: string; version: number }) {
    this.checkpointFormat = {
      runtime: runtime.id,
      runtimeVersion: runtime.version,
      format: RESPONSES_ITEM_FORMAT.FORMAT,
      formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
    };
  }

  /**
   * An empty checkpoint loads as nothing. A compatible one loads whole, with
   * every `function_call` that has no output answered with the lost-result
   * record, because a checkpoint taken between an act's start and its result
   * must never hand the model a dangling call or replay the act. A checkpoint
   * of any other stamp is not corruption and is not repaired: it is refused
   * with its stamp named, the engine stays empty, and what the caller does
   * about a memory it cannot read is the caller's decision.
   */
  bootstrap(checkpoint: RuntimeCheckpoint | undefined, lostResultJson: string): ContextBootstrap {
    // Synchronous throughout: every hook answers before a signal could fire, so none reads one.
    if (!checkpoint) {
      this.#items = [];
      return { loaded: true, repaired: 0 };
    }
    if (!sameCheckpointFormat(checkpoint.format, this.checkpointFormat)) {
      this.#items = [];
      return {
        loaded: false,
        reason: `checkpoint ${checkpointFormatTag(checkpoint.format)} is not readable by ${checkpointFormatTag(this.checkpointFormat)}`,
        repaired: 0,
      };
    }
    const paired = pairedDanglingCalls(checkpoint.items, () => lostResultJson);
    this.#items = [...paired];
    return { loaded: true, repaired: paired.length - checkpoint.items.length };
  }

  ingest(input: ContextInput): void {
    switch (input.kind) {
      case CONTEXT_INPUT_KIND.USER_TEXT:
        this.#items.push(userMessageItem(input.text));
        return;
      case CONTEXT_INPUT_KIND.MODEL_OUTPUT:
        this.#items.push(...input.items);
        return;
      case CONTEXT_INPUT_KIND.TOOL_RESULT:
        this.#items.push(functionCallOutputItem(input.callId, input.outputJson));
        return;
    }
  }

  /** The retained array, then the ephemeral text as user messages, so the instructions-plus-history prefix stays cacheable. */
  assemble(assembly: ContextAssembly): readonly WireRecord[] {
    return [...this.#items, ...assembly.ephemeral.map((text) => userMessageItem(text))];
  }

  /** Drops every item before the latest compaction item; answers how many went. */
  compact(): number {
    const index = this.#items.findLastIndex(isCompactionItem);
    if (index <= 0) return 0;
    this.#items = this.#items.slice(index);
    return index;
  }

  /** Adopts the window an explicit compaction answered, whole: it is the canonical next context. */
  adoptCompaction(items: readonly WireRecord[]): void {
    this.#items = [...items];
  }

  afterTurn(): void {}

  mark(): ContextMark {
    return { items: [...this.#items] };
  }

  rollback(mark: ContextMark): void {
    this.#items = [...mark.items];
  }

  checkpoint(): RuntimeCheckpoint {
    return { format: this.checkpointFormat, items: [...this.#items] };
  }

  dispose(): void {
    this.#items = [];
  }
}
