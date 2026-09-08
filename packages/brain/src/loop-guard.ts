import type { ToolInvocation, ToolResult } from "@sidecar/runtime-contracts";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The tool-loop guard, ported from OpenClaw at b7528507
 * (`src/agents/tool-loop-detection.ts`, `tool-loop-no-progress.ts`,
 * `tool-loop-argument-churn.ts`, `tool-loop-thresholds.ts`; MIT, Copyright
 * (c) 2026 OpenClaw Foundation — the notice travels in
 * `THIRD_PARTY_NOTICES.md` at the repository root): a sliding window of the run's
 * recent tool calls, each hashed by name and arguments and, once answered,
 * by its result, read for the no-progress patterns that mean a model is
 * stuck rather than working. It is off unless a configuration enables it,
 * exactly as the pinned source has it, so by default a run ends only through
 * completion, cancellation, its deadline, or a provider failure — never
 * through a count of tool iterations. The detectors ported are the generic
 * repeat, the ping-pong between two signatures, the unknown-tool repeat, the
 * argument churn, and the global circuit breaker, with the pinned thresholds
 * and the pinned no-progress semantics; the pinned poll and terminal-exec
 * classifiers key on OpenClaw's own `exec` and process tools, which this
 * build does not offer, so they have nothing to classify here.
 */

export const LOOP_GUARD_THRESHOLDS = {
  HISTORY_SIZE: 30,
  WARNING: 10,
  CRITICAL: 20,
  GLOBAL_CIRCUIT_BREAKER: 30,
  UNKNOWN_TOOL: 10,
} as const;

export interface LoopGuardConfig {
  /** Enable tool-loop protection (default: false). */
  enabled?: boolean;
}

export const LOOP_GUARD_LEVEL = {
  WARNING: "warning",
  CRITICAL: "critical",
} as const;

export type LoopGuardLevel = (typeof LOOP_GUARD_LEVEL)[keyof typeof LOOP_GUARD_LEVEL];

export const LOOP_GUARD_DETECTOR = {
  GENERIC_REPEAT: "generic_repeat",
  PING_PONG: "ping_pong",
  UNKNOWN_TOOL_REPEAT: "unknown_tool_repeat",
  GLOBAL_CIRCUIT_BREAKER: "global_circuit_breaker",
  ARGUMENT_CHURN: "argument_churn",
} as const;

export type LoopGuardDetector = (typeof LOOP_GUARD_DETECTOR)[keyof typeof LOOP_GUARD_DETECTOR];

export type LoopGuardVerdict =
  | { stuck: false }
  | {
      stuck: true;
      level: LoopGuardLevel;
      detector: LoopGuardDetector;
      count: number;
      message: string;
    };

interface ToolCallRecord {
  name: string;
  argsHash: string;
  resultHash?: string;
  /** Whether the outcome matched the last outcome of the same signature, as the pinned recorder marks it. */
  noProgress: boolean;
  unknownTool: boolean;
}

/** A deterministic rendering of JSON with keys sorted, so two equal arguments hash alike however written. */
export function stableStringify(value: UnparsedWireValue): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The JSON a call or a result carried, or the raw text when it was not JSON: either hashes the same way each time. */
function parsedJson(json: string): UnparsedWireValue {
  try {
    // SAFETY: JSON.parse returns a wire value; nothing here reads inside it beyond rendering it stably.
    return JSON.parse(json) as UnparsedWireValue;
  } catch {
    return json;
  }
}

export function hashToolCall(name: string, argumentsJson: string): string {
  return `${name}:${stableStringify(parsedJson(argumentsJson))}`;
}

interface NoProgressStreak {
  count: number;
  latestResultHash?: string;
}

/**
 * How many times, most recent first, this exact signature answered the same
 * outcome. Records of other tools and other arguments are skipped rather
 * than ending the streak, as the pinned `countNoProgressStreak` does, so an
 * unrelated call between two stuck polls does not hide the loop; only a
 * changed outcome for the same signature ends it.
 */
function noProgressStreak(
  history: readonly ToolCallRecord[],
  name: string,
  argsHash: string,
): NoProgressStreak {
  let count = 0;
  let latest: string | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index];
    if (!record || record.name !== name || record.argsHash !== argsHash) continue;
    if (!record.resultHash) continue;
    if (latest === undefined) {
      latest = record.resultHash;
      count = 1;
      continue;
    }
    if (record.resultHash !== latest) break;
    count += 1;
  }
  return { count, ...(latest !== undefined ? { latestResultHash: latest } : undefined) };
}

const MIN_STABLE_CALLS_PER_VARIANT = 3;

interface ArgumentChurn {
  count: number;
  variantCount: number;
}

/**
 * Whether the tool's recent tail is cycling through a few repeated argument
 * patterns that all land on one stable outcome, ported from the pinned
 * `tool-loop-argument-churn.ts`: every call in the tail must belong to a
 * repeated stable variant, and the proposed call must continue one of them.
 * A novel argument is a possible escape and resets the evidence. The
 * classifier is warning-only.
 */
function argumentChurn(
  history: readonly ToolCallRecord[],
  name: string,
  currentArgsHash: string,
): ArgumentChurn {
  const outcomes = new Map<string, { resultHash: string; count: number }>();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index];
    if (!record || record.name !== name) break;
    if (!record.resultHash) continue;
    if (!record.noProgress) break;
    const previous = outcomes.get(record.argsHash);
    if (previous && previous.resultHash !== record.resultHash) break;
    outcomes.set(record.argsHash, {
      resultHash: record.resultHash,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const all = [...outcomes.values()];
  const count = all.reduce((sum, outcome) => sum + outcome.count, 0);
  const stable = all.filter((outcome) => outcome.count >= MIN_STABLE_CALLS_PER_VARIANT);
  const sharedStableOutcome = new Set(stable.map((outcome) => outcome.resultHash)).size === 1;
  const onlyStableVariants = stable.reduce((sum, outcome) => sum + outcome.count, 0) === count;
  const current = outcomes.get(currentArgsHash);
  const churning =
    stable.length > 1 &&
    onlyStableVariants &&
    sharedStableOutcome &&
    (current?.count ?? 0) >= MIN_STABLE_CALLS_PER_VARIANT;
  return churning ? { count, variantCount: stable.length } : { count: 0, variantCount: 0 };
}

function unknownToolStreak(history: readonly ToolCallRecord[], name: string): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index];
    if (!record || record.name !== name || !record.unknownTool) break;
    count += 1;
  }
  return count;
}

interface PingPongStreak {
  count: number;
  noProgressEvidence: boolean;
}

function pingPongStreak(
  history: readonly ToolCallRecord[],
  currentSignature: string,
): PingPongStreak {
  const last = history.at(-1);
  if (!last) return { count: 0, noProgressEvidence: false };
  let otherSignature: string | undefined;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const call = history[index];
    if (call && call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash;
      break;
    }
  }
  if (!otherSignature) return { count: 0, noProgressEvidence: false };
  let alternating = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const call = history[index];
    if (!call) continue;
    const expected = alternating % 2 === 0 ? last.argsHash : otherSignature;
    if (call.argsHash !== expected) break;
    alternating += 1;
  }
  if (alternating < 2 || currentSignature !== otherSignature) {
    return { count: 0, noProgressEvidence: false };
  }
  let firstA: string | undefined;
  let firstB: string | undefined;
  let noProgressEvidence = true;
  for (let index = Math.max(0, history.length - alternating); index < history.length; index += 1) {
    const call = history[index];
    if (!call) continue;
    if (!call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (call.argsHash === last.argsHash) {
      if (firstA === undefined) firstA = call.resultHash;
      else if (firstA !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else if (firstB === undefined) firstB = call.resultHash;
    else if (firstB !== call.resultHash) {
      noProgressEvidence = false;
      break;
    }
  }
  if (firstA === undefined || firstB === undefined) noProgressEvidence = false;
  return { count: alternating + 1, noProgressEvidence };
}

/** One run's window of tool calls, asked before each dispatch and told each result. */
export class LoopGuard {
  readonly #enabled: boolean;
  readonly #known: ReadonlySet<string>;
  readonly #history: ToolCallRecord[] = [];

  constructor(config: LoopGuardConfig | undefined, knownTools: Iterable<string>) {
    this.#enabled = config?.enabled === true;
    this.#known = new Set(knownTools);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** The verdict for a call about to be dispatched, read against the calls before it. */
  detect(invocation: ToolInvocation): LoopGuardVerdict {
    if (!this.#enabled) return { stuck: false };
    const { name } = invocation;
    const currentHash = hashToolCall(name, invocation.argumentsJson);
    const history = this.#history;
    const unknown = unknownToolStreak(history, name);
    const noProgress = noProgressStreak(history, name, currentHash);
    const pingPong = pingPongStreak(history, currentHash);
    const { WARNING, CRITICAL, GLOBAL_CIRCUIT_BREAKER, UNKNOWN_TOOL } = LOOP_GUARD_THRESHOLDS;
    if (unknown >= UNKNOWN_TOOL) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.CRITICAL,
        detector: LOOP_GUARD_DETECTOR.UNKNOWN_TOOL_REPEAT,
        count: unknown,
        message: `CRITICAL: attempted unavailable tool ${name} ${unknown} times. Stop retrying that missing tool and answer without it.`,
      };
    }
    if (noProgress.count >= GLOBAL_CIRCUIT_BREAKER) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.CRITICAL,
        detector: LOOP_GUARD_DETECTOR.GLOBAL_CIRCUIT_BREAKER,
        count: noProgress.count,
        message: `CRITICAL: ${name} repeated identical no-progress outcomes ${noProgress.count} times. Session execution blocked by global circuit breaker to prevent runaway loops.`,
      };
    }
    if (pingPong.count >= CRITICAL && pingPong.noProgressEvidence) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.CRITICAL,
        detector: LOOP_GUARD_DETECTOR.PING_PONG,
        count: pingPong.count,
        message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,
      };
    }
    if (pingPong.count >= WARNING) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.WARNING,
        detector: LOOP_GUARD_DETECTOR.PING_PONG,
        count: pingPong.count,
        message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,
      };
    }
    if (noProgress.count >= CRITICAL) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.CRITICAL,
        detector: LOOP_GUARD_DETECTOR.GENERIC_REPEAT,
        count: noProgress.count,
        message: `CRITICAL: Called ${name} with identical outcomes ${noProgress.count} times. Session execution blocked to prevent runaway loops.`,
      };
    }
    const churn = argumentChurn(history, name, currentHash);
    if (churn.count >= WARNING) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.WARNING,
        detector: LOOP_GUARD_DETECTOR.ARGUMENT_CHURN,
        count: churn.count,
        message: `WARNING: ${name} has cycled through ${churn.variantCount} repeated argument patterns with the same stable outcome ${churn.count} times. Continued churn is treated as stalled run activity, but this tool call remains allowed.`,
      };
    }
    const recent = history.filter(
      (record) => record.name === name && record.argsHash === currentHash,
    ).length;
    if (recent >= WARNING) {
      return {
        stuck: true,
        level: LOOP_GUARD_LEVEL.WARNING,
        detector: LOOP_GUARD_DETECTOR.GENERIC_REPEAT,
        count: recent,
        message: `WARNING: You have called ${name} ${recent} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`,
      };
    }
    return { stuck: false };
  }

  /** Records a dispatched call and its answer, keeping the window at its size. */
  record(invocation: ToolInvocation, result: ToolResult): void {
    if (!this.#enabled) return;
    const argsHash = hashToolCall(invocation.name, invocation.argumentsJson);
    const resultHash = stableStringify(parsedJson(result.outputJson));
    const previous = this.#history.findLast(
      (record) => record.name === invocation.name && record.argsHash === argsHash,
    );
    this.#history.push({
      name: invocation.name,
      argsHash,
      resultHash,
      noProgress: previous?.resultHash === resultHash,
      unknownTool: !this.#known.has(invocation.name),
    });
    if (this.#history.length > LOOP_GUARD_THRESHOLDS.HISTORY_SIZE) {
      this.#history.splice(0, this.#history.length - LOOP_GUARD_THRESHOLDS.HISTORY_SIZE);
    }
  }
}
