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
  type ToolExecutor,
  type ToolResult,
} from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, type WireRecord, wireRecord } from "@sidecar/wire";
import type { BrainWorkspaceAccess } from "./tool-executor.js";
import { BRAIN_TOOL, brainToolCatalog } from "./tools.js";
import { REFUSAL_REASON } from "./turn.js";

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

export const HOUSEKEEPING_TOOLS: ReadonlySet<string> = new Set([
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

function answer(output: WireRecord): ToolResult {
  return {
    outputJson: JSON.stringify(output),
    ...(typeof output.status === "string" ? { status: output.status } : undefined),
  };
}

function rejection(reason: string): ToolResult {
  return answer({ status: ACT_RESULT_STATUS.REJECTED, reason });
}

/** Runs one housekeeping turn to its end and answers how it ended and how many writes it committed. */
export async function runMemoryHousekeeping(
  options: MemoryHousekeepingOptions,
): Promise<MemoryHousekeepingResult> {
  const schemas = brainToolCatalog()
    .filter((tool) => HOUSEKEEPING_TOOLS.has(tool.id))
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
      const name = typeof args.name === "string" ? args.name : "";
      if (call.name === BRAIN_TOOL.READ_WORKSPACE_FILE) {
        const read = await options.workspace.read(name);
        return read.ok
          ? answer({ status: ACT_RESULT_STATUS.ACCEPTED, name, content: read.content })
          : rejection(read.reason);
      }
      if (!isDailyNotePathForDay(name, options.dateStamp)) {
        return rejection(HOUSEKEEPING_REFUSAL.NOT_TODAYS_NOTE);
      }
      const content = typeof args.content === "string" ? args.content : "";
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
      return answer({ status: ACT_RESULT_STATUS.ACCEPTED, name, chars: written.chars });
    },
  };
  const opened = await options.runtime.openContext(undefined, JSON.stringify({}));
  try {
    await opened.context.adoptCompaction([...options.items], { signal: options.signal });
    const run = options.runtime.start({
      runId: options.runId,
      context: opened.context,
      tools,
      toolSchemas: schemas,
      prompt: options.prompt.system,
      input: [{ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: options.prompt.ask }],
      ephemeral: () => [],
      maximumOutputTokens: MEMORY_FLUSH_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
      signal: options.signal,
      onEvent: () => undefined,
    });
    const end = await run.done;
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
  } finally {
    await Promise.resolve(opened.context.dispose()).catch(() => undefined);
  }
}
