import type { HarnessV1 } from "@ai-sdk/harness";

/**
 * scripted-harness.ts -- SPIKE (do not merge): a `HarnessV1` adapter that plays scripted turns, the double at the sandbox's boundary.
 *
 * The real adapters run Claude Code or Codex in a sandbox behind a bridge
 * and emit `HarnessV1StreamPart`s over a WebSocket; this one emits the
 * parts a script names, in order, so the real `HarnessAgent` above it
 * validates calls, runs host tools, and builds the AI SDK stream exactly
 * as it does over a live bridge. The scripts are written in the adapters'
 * own vocabulary as their sources emit it (`toolName` is the common name
 * where the adapter maps one, the native name otherwise; Claude Code's
 * results are its `tool_use_result`, Codex's its app-server item), and a
 * host tool's result is echoed back as a `tool-result` part, as both
 * bridges do. A `WAIT_FOR_ABORT` step parks the turn until the host aborts
 * it, as a long turn would, and the adapter then answers as the bridges
 * do: the turn's `done` settles and no further part is emitted.
 */

/** A script step that parks the turn until the host aborts it. */
export const WAIT_FOR_ABORT = "wait-for-abort" as const;

/** One step of a scripted turn: a part to emit, or a park. */
export type ScriptStep = Readonly<Record<string, unknown>> | typeof WAIT_FOR_ABORT;

/** What a scripted turn is told: whether the session was resumed from a parked state. */
export interface ScriptContext {
  readonly resumed: boolean;
}

/** One usage in the harness's own shape. */
export function harnessUsage(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

/** The state a parked session hands back, which the next session resumes from. */
const PARKED = (sessionId: string) => ({
  type: "resume-session" as const,
  harnessId: "scripted",
  specificationVersion: "harness-v1" as const,
  data: { claudeSessionId: `claude-${sessionId}` },
});

/** The adapter over the turns given, played in order, one per prompt. */
export function scriptedHarness(
  turns: readonly ((context: ScriptContext) => readonly ScriptStep[])[],
  onPark: () => void = () => undefined,
): HarnessV1 {
  let played = 0;
  return {
    specificationVersion: "harness-v1",
    harnessId: "scripted",
    builtinTools: {},
    doStart: async (options) => {
      const resumed = options.resumeFrom !== undefined;
      return {
        sessionId: options.sessionId,
        isResume: resumed,
        doPromptTurn: async ({ emit, abortSignal }) => {
          const script = turns[played]?.({ resumed }) ?? [];
          played += 1;
          const hostResults = new Map<string, (output: unknown) => void>();
          const done = (async () => {
            for (const step of script) {
              if (abortSignal?.aborted) return;
              if (step === WAIT_FOR_ABORT) {
                onPark();
                await new Promise<void>((settle) => {
                  if (abortSignal?.aborted) settle();
                  abortSignal?.addEventListener("abort", () => settle(), { once: true });
                });
                return;
              }
              // SAFETY: the script is written in the harness's own part vocabulary.
              emit(step as Parameters<typeof emit>[0]);
              if (step.type === "tool-call" && step.providerExecuted !== true) {
                const callId = String(step.toolCallId);
                const output = await new Promise((settle) => hostResults.set(callId, settle));
                emit({
                  type: "tool-result",
                  toolCallId: callId,
                  toolName: String(step.toolName),
                  result: output as never,
                });
              }
            }
          })();
          return {
            done,
            submitToolResult: async ({ toolCallId, output }) => {
              hostResults.get(toolCallId)?.(output);
            },
          };
        },
        doStop: async () => PARKED(options.sessionId),
        doDetach: async () => PARKED(options.sessionId),
        doDestroy: async () => undefined,
        doCompact: async () => undefined,
        doContinueTurn: async () => {
          throw new Error("the scripted harness continues no turn");
        },
        doSuspendTurn: async () => {
          throw new Error("the scripted harness suspends no turn");
        },
      };
    },
  };
}
