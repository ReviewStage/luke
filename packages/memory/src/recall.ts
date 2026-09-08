import { createHash } from "node:crypto";
import {
  CONVERSATION_KIND,
  type ConversationKind,
  conversationKindOf,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { RECALL_DEFAULTS } from "./defaults.js";

/**
 * Private-conversation recall, ported in shape from OpenClaw `b7528507`'s
 * active-memory extension: a developer's ask in an eligible conversation is
 * answered first from deterministic trusted memory (the notebook's own
 * index), and only an ask that reads like a question about the past is
 * escalated to a bounded recall subrun, which may search and read memory
 * and nothing else, runs under a 15-second timeout, answers a summary cut
 * to 220 characters, is cached for 15 seconds, and is stood down for a
 * minute after three consecutive timeouts. Nothing the subrun says is ever
 * written back: its summary is context for one turn, so a recall can never
 * feed itself.
 */

/** Which of the same agent's conversations a recall may read: main and the developer's private threads, the current one excepted. */
export const RECALL_ELIGIBLE_KINDS: ReadonlySet<ConversationKind> = new Set([
  CONVERSATION_KIND.MAIN,
  CONVERSATION_KIND.THREAD,
]);

export interface RecallEligibilityInput {
  readonly sessionKey: SessionKey;
  readonly agentId: string;
  /** Whether the thread is held in memory alone; a temporary thread is never a recall source. */
  readonly temporary: boolean;
}

/** Whether a conversation may be recalled from, and whether one may recall at all. */
export function isRecallEligibleConversation(
  candidate: RecallEligibilityInput,
  current: { readonly sessionKey: SessionKey; readonly agentId: string },
): boolean {
  if (candidate.temporary) return false;
  if (candidate.agentId !== current.agentId) return false;
  if (candidate.sessionKey === current.sessionKey) return false;
  return RECALL_ELIGIBLE_KINDS.has(conversationKindOf(candidate.sessionKey));
}

/** Whether a conversation's asks run recall at all: the same set, since a child, an observed session, or a temporary thread neither recalls nor is recalled. */
export function conversationRunsRecall(input: RecallEligibilityInput): boolean {
  return !input.temporary && RECALL_ELIGIBLE_KINDS.has(conversationKindOf(input.sessionKey));
}

const RECALL_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(?:previously|earlier|last time|used to)\b/iu,
  /\b(?:do|can|could|would)\s+you\s+(?:remember|recall)\b/iu,
  /\b(?:remember|recall)\s+(?:when|what|which|who|where|why|how)\b/iu,
  /\b(?:we|you|i)\s+(?:discussed|decided|agreed|said|talked about|chose)\b/iu,
  /\b(?:previous|earlier|past)\s+(?:decision|conversation|chat|discussion)\b/iu,
  /\b(?:yesterday|the other day|last (?:week|month|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\s+ago)\b/iu,
  /\bwhat did (?:we|you|i)\b/iu,
  /\bwhat (?:do|did) i usually\b/iu,
  /\b(?:what|which|when|where|why|how)\s+(?:did|have|had)\s+(?:we|you|i)\s+(?:decide|choose|discuss|agree|say|mention|talk|use|do)\b/iu,
  /\b(?:did|have|had)\s+(?:we|you|i)\s+(?:decide|choose|discuss|agree|say|mention|talk)\b/iu,
  /\b(?:summarize|review|find|search)\s+(?:my|our|the)?\s*(?:past|previous|earlier)?\s*(?:conversation|chat|discussion)s?\b/iu,
  /\bremind\s+(?:me|us)\s+(?:what|which|who|where|why|how)\b/iu,
];

/** Whether an ask reads like a question about the past, as the pinned source decides it. */
export function hasRecallIntent(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  return (
    normalized.length > 0 && RECALL_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export const RECALL_DECISION = {
  RECALL: "recall",
  TRUSTED_MEMORY_HIT: "trusted-memory-hit",
  NO_RECALL_INTENT: "no-recall-intent",
} as const;

export type RecallDecision = (typeof RECALL_DECISION)[keyof typeof RECALL_DECISION];

/** Whether an ask escalates: a strong deterministic hit answers it, otherwise only an ask about the past does. */
export function resolveRecallEscalation(params: {
  message: string;
  hasStrongTrustedHit: boolean;
}): RecallDecision {
  if (params.hasStrongTrustedHit) return RECALL_DECISION.TRUSTED_MEMORY_HIT;
  return hasRecallIntent(params.message)
    ? RECALL_DECISION.RECALL
    : RECALL_DECISION.NO_RECALL_INTENT;
}

/** One line of the recent exchange the recall reads, already bounded by the caller. */
export interface RecallRecentTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** The small recent-turn input the pinned source hands a recall: two asks and one reply, each cut. */
export function boundRecentTurns(turns: readonly RecallRecentTurn[]): RecallRecentTurn[] {
  const users = turns
    .filter((turn) => turn.role === "user")
    .slice(-RECALL_DEFAULTS.RECENT_USER_TURNS)
    .map((turn) => ({ ...turn, text: turn.text.slice(0, RECALL_DEFAULTS.RECENT_USER_CHARS) }));
  const assistants = turns
    .filter((turn) => turn.role === "assistant")
    .slice(-RECALL_DEFAULTS.RECENT_ASSISTANT_TURNS)
    .map((turn) => ({
      ...turn,
      text: turn.text.slice(0, RECALL_DEFAULTS.RECENT_ASSISTANT_CHARS),
    }));
  return [...users, ...assistants];
}

export const RECALL_STATUS = {
  OK: "ok",
  NONE: "none",
  TIMEOUT: "timeout",
  FAILED: "failed",
  UNAVAILABLE: "unavailable",
  SKIPPED: "skipped",
} as const;

export type RecallStatus = (typeof RECALL_STATUS)[keyof typeof RECALL_STATUS];

export interface RecallResult {
  readonly status: RecallStatus;
  /** The summary the developer's turn reads, cut to the bound; empty unless ok. */
  readonly summary: string;
  readonly decision: RecallDecision;
  readonly elapsedMs: number;
  readonly cached: boolean;
}

export interface RecallAsk {
  readonly sessionKey: SessionKey;
  readonly agentId: string;
  readonly query: string;
  readonly recentTurns: readonly RecallRecentTurn[];
  readonly signal?: AbortSignal;
}

/** What a trusted-memory search answers the recall with before any subrun. */
export interface TrustedMemoryLookup {
  readonly strongHit: boolean;
}

/**
 * The subrun as the host runs it: a tool loop offered memory_search and
 * memory_get alone, told the query and the recent turns, answering its text.
 * `NONE` or an empty text means nothing relevant was found.
 */
export type RecallSubrun = (params: {
  readonly query: string;
  readonly recentTurns: readonly RecallRecentTurn[];
  readonly signal: AbortSignal;
}) => Promise<string | undefined>;

export interface ConversationRecallOptions {
  readonly trustedMemory: (
    query: string,
    signal: AbortSignal | undefined,
  ) => Promise<TrustedMemoryLookup>;
  readonly subrun: RecallSubrun;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly circuitBreakerMaximumTimeouts?: number;
  readonly circuitBreakerCooldownMs?: number;
  readonly report?: (message: string) => void;
}

const NONE_REPLY = "NONE";

/** The summary as one line, cut to the bound, or nothing when the subrun said it found nothing. */
export function summarizeRecallReply(reply: string | undefined): string {
  const single = (reply ?? "").replace(/\s+/g, " ").trim();
  if (single.length === 0 || single.toUpperCase() === NONE_REPLY) return "";
  return single.slice(0, RECALL_DEFAULTS.MAXIMUM_SUMMARY_CHARS);
}

interface CacheEntry {
  expiresAt: number;
  result: RecallResult;
}

export class ConversationRecall {
  readonly #options: ConversationRecallOptions;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<RecallResult>>();
  #consecutiveTimeouts = 0;
  #lastTimeoutAt = 0;

  constructor(options: ConversationRecallOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  #cacheKey(ask: RecallAsk): string {
    const hash = createHash("sha256").update(ask.query).digest("hex");
    return `${ask.agentId}:${ask.sessionKey}:${hash}`;
  }

  #breakerOpen(): boolean {
    const maximum =
      this.#options.circuitBreakerMaximumTimeouts ??
      RECALL_DEFAULTS.CIRCUIT_BREAKER_MAXIMUM_TIMEOUTS;
    const cooldown =
      this.#options.circuitBreakerCooldownMs ?? RECALL_DEFAULTS.CIRCUIT_BREAKER_COOLDOWN_MS;
    if (this.#consecutiveTimeouts < maximum) return false;
    if (this.#now() - this.#lastTimeoutAt >= cooldown) {
      this.#consecutiveTimeouts = 0;
      return false;
    }
    return true;
  }

  /** For inspection: how many timeouts in a row the breaker has counted. */
  consecutiveTimeouts(): number {
    return this.#consecutiveTimeouts;
  }

  async recall(ask: RecallAsk): Promise<RecallResult> {
    const query = ask.query
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, RECALL_DEFAULTS.MAXIMUM_QUERY_CHARS);
    if (query.length === 0) {
      return {
        status: RECALL_STATUS.SKIPPED,
        summary: "",
        decision: RECALL_DECISION.NO_RECALL_INTENT,
        elapsedMs: 0,
        cached: false,
      };
    }
    const key = this.#cacheKey({ ...ask, query });
    const cached = this.#cache.get(key);
    if (cached) {
      if (cached.expiresAt > this.#now()) return { ...cached.result, cached: true };
      this.#cache.delete(key);
    }
    const running = this.#inFlight.get(key);
    if (running) return running;
    const started = this.#run({ ...ask, query }, key).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, started);
    return started;
  }

  async #run(ask: RecallAsk, key: string): Promise<RecallResult> {
    const startedAt = this.#now();
    const elapsed = () => this.#now() - startedAt;
    const trusted = await this.#options.trustedMemory(ask.query, ask.signal).catch(() => ({
      strongHit: false,
    }));
    const decision = resolveRecallEscalation({
      message: ask.query,
      hasStrongTrustedHit: trusted.strongHit,
    });
    if (decision !== RECALL_DECISION.RECALL) {
      return {
        status: RECALL_STATUS.SKIPPED,
        summary: "",
        decision,
        elapsedMs: elapsed(),
        cached: false,
      };
    }
    if (this.#breakerOpen()) {
      return {
        status: RECALL_STATUS.UNAVAILABLE,
        summary: "",
        decision,
        elapsedMs: elapsed(),
        cached: false,
      };
    }
    const timeoutMs = this.#options.timeoutMs ?? RECALL_DEFAULTS.TIMEOUT_MS;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = ask.signal ? AbortSignal.any([ask.signal, timeout.signal]) : timeout.signal;
    let result: RecallResult;
    try {
      const reply = await this.#options.subrun({
        query: ask.query,
        recentTurns: boundRecentTurns(ask.recentTurns),
        signal,
      });
      const summary = summarizeRecallReply(reply);
      this.#consecutiveTimeouts = 0;
      result = {
        status: summary.length > 0 ? RECALL_STATUS.OK : RECALL_STATUS.NONE,
        summary,
        decision,
        elapsedMs: elapsed(),
        cached: false,
      };
    } catch (error) {
      if (timeout.signal.aborted && !ask.signal?.aborted) {
        this.#consecutiveTimeouts += 1;
        this.#lastTimeoutAt = this.#now();
        result = {
          status: RECALL_STATUS.TIMEOUT,
          summary: "",
          decision,
          elapsedMs: elapsed(),
          cached: false,
        };
      } else {
        this.#options.report?.(
          `Recall subrun failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        result = {
          status: RECALL_STATUS.FAILED,
          summary: "",
          decision,
          elapsedMs: elapsed(),
          cached: false,
        };
      }
    } finally {
      clearTimeout(timer);
    }
    if (result.status === RECALL_STATUS.OK) {
      const ttl = this.#options.cacheTtlMs ?? RECALL_DEFAULTS.CACHE_TTL_MS;
      this.#cache.set(key, { expiresAt: this.#now() + ttl, result });
      while (this.#cache.size > RECALL_DEFAULTS.MAXIMUM_CACHE_ENTRIES) {
        const oldest = this.#cache.keys().next().value;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
    }
    return result;
  }
}
