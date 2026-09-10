import { ESTIMATED_CHARS_PER_TOKEN } from "@sidecar/memory";
import {
  COMPACTION_SOURCE,
  type CompactionOptions,
  type ContextEngine,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
  type RuntimeCompaction,
  reserveTokens,
  shouldCompact,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";

/**
 * The desktop's own fold of a context that has outgrown its window, and the
 * one place the desktop brain compacts at all. It is disposable in the
 * storage plan's sense: the hosted brain's runtime owns compaction there and
 * writes the summary message itself, so nothing here is a rule about Luke's
 * conversations. The rule — when a context folds — is the runtime
 * vocabulary's `shouldCompact`, read here and there alike; what this module
 * adds is only the mechanism the desktop still needs: how far a fold reaches,
 * how the summary is asked for, and the byte bound a hosted request is
 * prepared against.
 *
 * The provider is asked for no compaction of its own, inline or explicit: the
 * older items are handed to the model with no tools and replaced by the
 * summary it writes, as one assistant message, cut at a user message so no
 * tool call is parted from its result and no reasoning item from the call it
 * preceded. A summary that does not come leaves the context exactly as it was.
 *
 * Transport size is a separate admission constraint. A hosted request has a
 * fixed byte envelope; the context is prepared before a request would cross
 * it rather than the transport refusing, and never by deleting stored
 * history or cutting an opaque item: preparation is a fold or nothing.
 */

export const COMPACTION_POLICY = {
  /** The most of the recent context a fold keeps verbatim, OpenClaw's recent-tail cut; never more than the window's reserve. */
  KEEP_RECENT_TOKENS: 20_000,
  /** The window assumed for a model that does not report one; the current default model's. */
  DEFAULT_CONTEXT_WINDOW_TOKENS: 400_000,
  /** The share of a transport's byte bound past which the context is prepared before the next request. */
  TRANSPORT_PREPARE_RATIO: 0.75,
  /** The most output tokens a summary may run to. */
  SUMMARY_OUTPUT_TOKENS: 4_000,
} as const;

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

/** Ported in shape from OpenClaw's summarization prompt: a checkpoint another model continues from. */
const SUMMARY_INSTRUCTIONS = [
  "You are a context summarization assistant. The items above are the older part of a conversation",
  "between a developer and Luke, an assistant that watches their coding-agent sessions. Produce a",
  "structured checkpoint summary another model will continue from. Do NOT continue the conversation",
  "and do NOT answer any question in it; output only the summary.",
  "",
  "Use these sections: Goal, Progress (done, in progress, blocked), Key Decisions, Open Questions,",
  "Next Steps. Preserve exact session titles, branches, file paths, identifiers, and error messages",
  "exactly as written. Prioritize recent context over older history.",
].join("\n");

export const SUMMARY_MARKER = "[conversation summary]";

export interface CompactionRequest extends CompactionOptions {
  capabilities: ModelCapabilities | undefined;
}

/** How much of the tail a fold keeps: the recent-tail budget, and never more than the reserve the fold is meant to win back. */
export function keepRecentTokens(contextWindowTokens: number | undefined): number {
  return Math.min(
    COMPACTION_POLICY.KEEP_RECENT_TOKENS,
    reserveTokens(contextWindowTokens ?? COMPACTION_POLICY.DEFAULT_CONTEXT_WINDOW_TOKENS),
  );
}

/**
 * Folds the context behind a summary the model is asked to write with no
 * tools, over the older items alone and never the ephemeral text. A failure
 * answers why and changes nothing.
 */
export async function compactContext(
  context: ContextEngine,
  model: ModelAdapter,
  request: CompactionRequest,
): Promise<RuntimeCompaction> {
  if (context.checkpoint().items.length === 0) {
    return { compacted: false, reason: "nothing to compact" };
  }
  if (!context.foldBehindSummary) {
    return { compacted: false, reason: "this context cannot be folded" };
  }
  let failure: string | undefined;
  let summary: string | undefined;
  const summarize = async (older: readonly WireRecord[]): Promise<string | undefined> => {
    const answer = await model.respond(older, {
      prompt: SUMMARY_INSTRUCTIONS,
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
    summary = `${SUMMARY_MARKER}\n${answer.text.trim()}`;
    return summary;
  };
  const dropped = await context.foldBehindSummary(
    summarize,
    keepRecentTokens(request.capabilities?.contextWindowTokens),
    { signal: request.signal },
  );
  if (request.signal.aborted) return { compacted: false, reason: "compaction cancelled" };
  if (dropped <= 0) return { compacted: false, reason: failure ?? "nothing could be folded" };
  return {
    compacted: true,
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped,
    ...(summary !== undefined ? { summary } : undefined),
  };
}
