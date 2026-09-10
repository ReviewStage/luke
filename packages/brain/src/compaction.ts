import { ESTIMATED_CHARS_PER_TOKEN } from "@sidecar/memory";
import {
  COMPACTION_SOURCE,
  type CompactionOptions,
  type ContextEngine,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
  type RuntimeCompaction,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";

/**
 * The one component that decides when the context folds and how. The
 * provider is asked for no automatic compaction of its own: the request
 * carries no `context_management`, so two policies never compete over one
 * window. The policy is OpenClaw's at the pinned revision: the context is
 * compacted once it crosses the window less a reserve of 20,000 tokens,
 * capped at one quarter of the window; and a local fold keeps roughly the
 * most recent 20,000 tokens, cut at a user message so no tool call is
 * parted from its result.
 *
 * Transport size is a separate admission constraint. A hosted request has a
 * fixed byte envelope; the context is prepared before a request would cross
 * it rather than the transport refusing, and never by deleting stored
 * history or cutting an opaque item: preparation is a compaction or nothing.
 *
 * Explicit compaction adopts the provider's answered window whole, as the
 * Responses compaction contract says the window is the next context. Where
 * the adapter cannot compact, the engine folds the older items behind a
 * summary the model writes tool-free. Either can fail; a failure leaves the
 * context exactly as it was.
 */

export const COMPACTION_POLICY = {
  RESERVE_TOKENS: 20_000,
  RESERVE_WINDOW_DIVISOR: 4,
  KEEP_RECENT_TOKENS: 20_000,
  /** The window assumed for a model that does not report one; the current default model's. */
  DEFAULT_CONTEXT_WINDOW_TOKENS: 400_000,
  /** The share of a transport's byte bound past which the context is prepared before the next request. */
  TRANSPORT_PREPARE_RATIO: 0.75,
  /** The most output tokens a local summary may run to. */
  SUMMARY_OUTPUT_TOKENS: 4_000,
} as const;

export function reserveTokens(contextWindowTokens: number): number {
  return Math.min(
    COMPACTION_POLICY.RESERVE_TOKENS,
    Math.floor(contextWindowTokens / COMPACTION_POLICY.RESERVE_WINDOW_DIVISOR),
  );
}

export function shouldCompact(contextTokens: number, contextWindowTokens: number): boolean {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return false;
  return contextTokens > contextWindowTokens - reserveTokens(contextWindowTokens);
}

export function estimateTokens(items: readonly WireRecord[]): number {
  return Math.ceil(JSON.stringify(items).length / ESTIMATED_CHARS_PER_TOKEN);
}

/** How many bytes a request of these items under this prompt weighs, as the transport measures it. */
function requestBytes(items: readonly WireRecord[], prompt: string): number {
  return Buffer.byteLength(JSON.stringify({ instructions: prompt, input: items }), "utf8");
}

function transportNeedsPreparation(
  bytes: number,
  maximumRequestBytes: number | undefined,
): boolean {
  if (maximumRequestBytes === undefined) return false;
  return bytes > maximumRequestBytes * COMPACTION_POLICY.TRANSPORT_PREPARE_RATIO;
}

export const COMPACTION_NEED = {
  NONE: "none",
  /** The window is nearly spent; maintenance once the turn has settled. */
  WINDOW: "window",
  /** The transport would refuse the next request; the context is prepared before it. */
  TRANSPORT: "transport",
} as const;

type CompactionNeed = (typeof COMPACTION_NEED)[keyof typeof COMPACTION_NEED];

export interface CompactionAssessment {
  need: CompactionNeed;
  contextTokens: number;
  contextWindowTokens: number;
  bytes: number;
}

/** What the retained items say about the next request: over the window, over the transport's bound, or fine. */
export function assessCompaction(
  items: readonly WireRecord[],
  prompt: string,
  capabilities: Pick<ModelCapabilities, "contextWindowTokens" | "maximumRequestBytes"> | undefined,
  countedTokens?: number,
): CompactionAssessment {
  const contextWindowTokens =
    capabilities?.contextWindowTokens ?? COMPACTION_POLICY.DEFAULT_CONTEXT_WINDOW_TOKENS;
  const contextTokens = countedTokens ?? estimateTokens(items);
  const bytes = requestBytes(items, prompt);
  let need: CompactionNeed = COMPACTION_NEED.NONE;
  if (transportNeedsPreparation(bytes, capabilities?.maximumRequestBytes)) {
    need = COMPACTION_NEED.TRANSPORT;
  } else if (shouldCompact(contextTokens, contextWindowTokens)) {
    need = COMPACTION_NEED.WINDOW;
  }
  return { need, contextTokens, contextWindowTokens, bytes };
}

export interface CompactionRequest extends CompactionOptions {
  capabilities: ModelCapabilities | undefined;
}

/** Ported in shape from OpenClaw's summarization prompt: a checkpoint another model continues from. */
const LOCAL_SUMMARY_INSTRUCTIONS = [
  "You are a context summarization assistant. The items above are the older part of a conversation",
  "between a developer and Luke, an assistant that watches their coding-agent sessions. Produce a",
  "structured checkpoint summary another model will continue from. Do NOT continue the conversation",
  "and do NOT answer any question in it; output only the summary.",
  "",
  "Use these sections: Goal, Progress (done, in progress, blocked), Key Decisions, Open Questions,",
  "Next Steps. Preserve exact session titles, branches, file paths, identifiers, and error messages",
  "exactly as written. Prioritize recent context over older history.",
].join("\n");

export const LOCAL_SUMMARY_MARKER = "[conversation summary]";

/**
 * Compacts the context by whichever way the adapter offers. An explicit
 * provider compaction is asked for over the retained items alone, never the
 * ephemeral text, and its answer replaces the window whole; otherwise the
 * engine folds behind a summary the model is asked to write with no tools.
 * Any failure answers why and changes nothing.
 */
export async function compactContext(
  context: ContextEngine,
  model: ModelAdapter,
  request: CompactionRequest,
): Promise<RuntimeCompaction> {
  const retained = context.checkpoint().items;
  if (retained.length === 0) return { compacted: false, reason: "nothing to compact" };
  if (request.capabilities?.compacts) {
    const answer = await model.compact(retained, {
      prompt: request.prompt,
      signal: request.signal,
    });
    if (request.signal.aborted) return { compacted: false, reason: "compaction cancelled" };
    if (answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED) {
      return { compacted: false, reason: "the model is rate limited" };
    }
    if (answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED) {
      return { compacted: false, reason: `${answer.failure}: ${answer.reason}` };
    }
    if (answer.items.length === 0)
      return { compacted: false, reason: "compaction answered no window" };
    await context.adoptCompaction(answer.items, { signal: request.signal });
    return {
      compacted: true,
      source: COMPACTION_SOURCE.PROVIDER_EXPLICIT,
      dropped: retained.length,
    };
  }
  if (!context.foldBehindSummary) {
    return { compacted: false, reason: "this transport offers no compaction" };
  }
  let failure: string | undefined;
  let summary: string | undefined;
  const summarize = async (older: readonly WireRecord[]): Promise<string | undefined> => {
    const answer = await model.respond(older, {
      prompt: LOCAL_SUMMARY_INSTRUCTIONS,
      tools: [],
      maximumOutputTokens: COMPACTION_POLICY.SUMMARY_OUTPUT_TOKENS,
      signal: request.signal,
    });
    if (answer.outcome !== MODEL_RESPONSE_OUTCOME.ANSWERED) {
      failure =
        answer.outcome === MODEL_RESPONSE_OUTCOME.THROTTLED
          ? "the model is rate limited"
          : `${answer.failure}: ${answer.reason}`;
      return undefined;
    }
    if (!answer.text.trim()) {
      failure = "the summary came back empty";
      return undefined;
    }
    summary = `${LOCAL_SUMMARY_MARKER}\n${answer.text.trim()}`;
    return summary;
  };
  const dropped = await context.foldBehindSummary(summarize, COMPACTION_POLICY.KEEP_RECENT_TOKENS, {
    signal: request.signal,
  });
  if (request.signal.aborted) return { compacted: false, reason: "compaction cancelled" };
  if (dropped <= 0) return { compacted: false, reason: failure ?? "nothing could be folded" };
  return {
    compacted: true,
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped,
    ...(summary !== undefined ? { summary } : undefined),
  };
}
