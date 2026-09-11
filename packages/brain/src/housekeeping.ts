import {
  type HousekeepingPrompt,
  isAppendOnlyRewrite,
  isDailyNotePathForDay,
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
} from "@sidecar/memory";
import { WORKSPACE_FILE_REFUSAL } from "@sidecar/runtime";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  RUN_END_REASON,
  type RuntimeRunEnd,
  type ToolExecutor,
  type ToolResult,
  type ToolSchema,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, isWireString, type WireRecord, wireRecord } from "@sidecar/wire";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import type { BrainWorkspaceAccess } from "./tool-executor.js";
import { answer } from "./tool-results.js";
import { REFUSAL_REASON } from "./tools/refusals.js";
import { BRAIN_TOOL, brainToolCatalog } from "./tools.js";

/**
 * The memory housekeeping turn: the pre-compaction flush and the reset
 * capture, both the same bounded run. It opens a fresh context of the
 * runtime's own format, adopts a private copy of the conversation's items,
 * and runs one tool loop offered the workspace read and the workspace write
 * — the write narrowed here to today's dated note, or a slugged variant of
 * it, and to an append-only rewrite of it, so nothing the turn does can
 * overwrite a bootstrap file or an earlier entry. The private context is
 * disposed at the end whatever happened, so the housekeeping prompt, the
 * model's words, and the tool answers never enter the conversation the
 * developer continues. Every accepted write lands as it is made and stands
 * whether the turn then completes, is interrupted, or fails; only the
 * outcome says which, and only a turn that ran to its end is reported done.
 */

const HOUSEKEEPING_TOOLS: ReadonlySet<string> = new Set([
  BRAIN_TOOL.READ_WORKSPACE_FILE,
  BRAIN_TOOL.WRITE_WORKSPACE_FILE,
]);

export const HOUSEKEEPING_REFUSAL = {
  NOT_TODAYS_NOTE: "not written: a housekeeping turn writes only today's dated note",
  NOT_APPEND_ONLY: "not written: a housekeeping turn may only append to the note",
} as const;

export interface MemoryHousekeepingOptions {
  readonly runtime: AgentRuntime;
  /** The conversation's context as it stands, copied; the turn's own context is opened over it and dropped. */
  readonly items: readonly WireRecord[];
  readonly prompt: HousekeepingPrompt;
  /** The day the note is named for, `YYYY-MM-DD` in the developer's local time. */
  readonly dateStamp: string;
  readonly workspace: Pick<BrainWorkspaceAccess, "read" | "write">;
  readonly signal: AbortSignal;
  readonly runId: string;
}

interface PrivateTurnOptions {
  readonly runtime: AgentRuntime;
  /** A conversation's context as it stands, copied into the private context; none for a turn over nothing. */
  readonly items?: readonly WireRecord[];
  readonly tools: ToolExecutor;
  readonly toolSchemas: readonly ToolSchema[];
  readonly prompt: string;
  readonly ask: string;
  readonly maximumOutputTokens: number;
  readonly signal: AbortSignal;
  readonly runId: string;
}

/**
 * One run over a private context of the runtime's own format: opened for
 * the turn, given a copy of the items when there are any, run to its end
 * with an inert event sink, and disposed whatever happened, so nothing the
 * turn read or said outlives it or reaches a conversation.
 */
async function runPrivateTurn(options: PrivateTurnOptions): Promise<RuntimeRunEnd> {
  const opened = await options.runtime.openContext(undefined, UNKNOWN_ACTION_RESULT);
  try {
    if (options.items && options.items.length > 0) {
      await opened.context.adopt([...options.items], { signal: options.signal });
    }
    const run = options.runtime.start({
      runId: options.runId,
      context: opened.context,
      tools: options.tools,
      toolSchemas: options.toolSchemas,
      prompt: options.prompt,
      input: [{ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: options.ask }],
      ephemeral: () => [],
      maximumOutputTokens: options.maximumOutputTokens,
      signal: options.signal,
      onEvent: () => undefined,
    });
    return await run.done;
  } finally {
    await Promise.resolve(opened.context.dispose()).catch(() => undefined);
  }
}

function rejection(reason: string): ToolResult {
  return answer({ status: ACTION_RESULT_STATUS.REJECTED, reason });
}

/** Runs one housekeeping turn to its end and answers how it ended and how many writes it committed. */
export async function runMemoryHousekeeping(
  options: MemoryHousekeepingOptions,
): Promise<MemoryHousekeepingResult> {
  const schemas = brainToolCatalog()
    .filter((tool) => HOUSEKEEPING_TOOLS.has(tool.schema.name))
    .map((tool) => tool.schema);
  let writes = 0;
  const tools: ToolExecutor = {
    execute: async (call, context) => {
      if (!HOUSEKEEPING_TOOLS.has(call.name)) return rejection(REFUSAL_REASON.NOT_OFFERED);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      let args: WireRecord = {};
      try {
        args = wireRecord(JSON.parse(call.argumentsJson)) ?? {};
      } catch {
        args = {};
      }
      const name = isWireString(args.name) ? args.name : "";
      if (call.name === BRAIN_TOOL.READ_WORKSPACE_FILE) {
        const read = await options.workspace.read(name);
        return read.ok
          ? answer({ status: ACTION_RESULT_STATUS.ACCEPTED, name, content: read.content })
          : rejection(read.reason);
      }
      if (!isDailyNotePathForDay(name, options.dateStamp)) {
        return rejection(HOUSEKEEPING_REFUSAL.NOT_TODAYS_NOTE);
      }
      const content = isWireString(args.content) ? args.content : "";
      const existing = await options.workspace.read(name);
      if (!existing.ok && existing.reason !== WORKSPACE_FILE_REFUSAL.NOT_FOUND) {
        return rejection(existing.reason);
      }
      const previous = existing.ok ? existing.content : "";
      if (!isAppendOnlyRewrite(previous, content)) {
        return rejection(HOUSEKEEPING_REFUSAL.NOT_APPEND_ONLY);
      }
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      const written = await options.workspace.write(name, content);
      if (!written.ok) return rejection(written.reason);
      writes += 1;
      return answer({ status: ACTION_RESULT_STATUS.ACCEPTED, name, chars: written.chars });
    },
  };
  try {
    const end = await runPrivateTurn({
      runtime: options.runtime,
      items: options.items,
      tools,
      toolSchemas: schemas,
      prompt: options.prompt.system,
      ask: options.prompt.ask,
      maximumOutputTokens: MEMORY_FLUSH_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      signal: options.signal,
      runId: options.runId,
    });
    switch (end.reason) {
      case RUN_END_REASON.COMPLETED:
        return {
          outcome:
            writes > 0
              ? MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED
              : MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
          writes,
        };
      case RUN_END_REASON.CANCELLED:
      case RUN_END_REASON.DEADLINE:
        return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED, writes, reason: end.reason };
      case RUN_END_REASON.THROTTLED:
        return {
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
          writes,
          reason: "the model is rate limited",
        };
      case RUN_END_REASON.PROVIDER_FAILURE:
        return {
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
          writes,
          reason: `${end.failure}: ${end.detail}`,
        };
      default:
        return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED, writes, reason: end.detail };
    }
  } catch (error) {
    return {
      outcome: options.signal.aborted
        ? MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED
        : MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
      writes,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
