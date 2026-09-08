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
import { isWireString, type WireRecord } from "@sidecar/wire";
import {
  functionCallOutputItem,
  isCompactionItem,
  isUserMessageItem,
  RESPONSES_ITEM_FORMAT,
  RESPONSES_ITEM_TYPE,
  type ResponsesInputItem,
  userMessageItem,
} from "./responses-api.js";

/** OpenClaw's own approximation where no count is at hand. */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

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

  /**
   * The local fold, the port of OpenClaw's recent-tail cut: walking back from
   * the end until roughly `keepRecentTokens` are kept, the cut lands on the
   * latest user message at or before that point, so every function call
   * stays beside its output and every reasoning item beside the call it
   * preceded. The older items are handed to the summarizer and replaced by
   * its words as one user message; a summary that does not come leaves the
   * items untouched.
   */
  async foldBehindSummary(
    summarize: (older: readonly WireRecord[]) => Promise<string | undefined>,
    keepRecentTokens: number,
  ): Promise<number> {
    const cut = this.#cutPoint(keepRecentTokens);
    if (cut <= 0) return 0;
    const before = this.#items;
    const older = before.slice(0, cut);
    const summary = await summarize(older);
    // A turn or a mark may have moved the items while the summary was
    // written; the fold applies only to the array it was planned over.
    if (summary === undefined || this.#items !== before) return 0;
    this.#items = [userMessageItem(summary), ...before.slice(cut)];
    return older.length;
  }

  #cutPoint(keepRecentTokens: number): number {
    const items = this.#items;
    let accumulated = 0;
    let cut: number | undefined;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item) continue;
      if (isUserMessageItem(item)) cut = index;
      accumulated += Math.ceil(JSON.stringify(item).length / ESTIMATED_CHARS_PER_TOKEN);
      if (accumulated >= keepRecentTokens && cut !== undefined) break;
    }
    return cut ?? 0;
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

/**
 * Answers every `function_call` in the array that has no `function_call_output`
 * anywhere in it with the output given, so a memory restored from a checkpoint
 * taken between an act's start and its result never replays the call and
 * never hands the model a dangling one.
 */
export function pairedDanglingCalls(
  items: readonly ResponsesInputItem[],
  outputFor: (callId: string) => string,
): readonly ResponsesInputItem[] {
  const answered = new Set<string>();
  for (const item of items) {
    if (item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT && isWireString(item.call_id)) {
      answered.add(item.call_id);
    }
  }
  const dangling: ResponsesInputItem[] = [];
  for (const item of items) {
    if (item.type !== RESPONSES_ITEM_TYPE.FUNCTION_CALL || !isWireString(item.call_id)) continue;
    if (answered.has(item.call_id)) continue;
    answered.add(item.call_id);
    dangling.push({
      type: RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
      call_id: item.call_id,
      output: outputFor(item.call_id),
    });
  }
  return dangling.length === 0 ? items : [...items, ...dangling];
}
