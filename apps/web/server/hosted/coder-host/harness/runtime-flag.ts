/**
 * runtime-flag.ts -- SPIKE (do not merge): which runtime a coding agent's turns run on.
 *
 * eve's coder is the only runtime a deployment runs today and stays the
 * default: the flag is read from `LUKE_CODER_HARNESS`, which no
 * environment sets, and anything it does not name is eve. Naming
 * `claude-code` or `codex` routes a Start, a message, and a Stop through
 * `harness-sessions.ts` instead of eve's channel, on the AI SDK's
 * `HarnessAgent` with the official adapter of that name.
 */

/** The runtimes a coding agent's turns can run on. */
export const CODER_RUNTIME = {
  EVE: "eve",
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
} as const;

export type CoderRuntime = (typeof CODER_RUNTIME)[keyof typeof CODER_RUNTIME];

/** The official harnesses alone, which is what the harness path is built for. */
export type HarnessRuntime = Exclude<CoderRuntime, typeof CODER_RUNTIME.EVE>;

/** The environment variable the spike reads; unset everywhere, so eve runs. */
export const CODER_HARNESS_VARIABLE = "LUKE_CODER_HARNESS";

/** The runtime the variable names, or eve for anything else, an absent variable included. */
export function coderRuntimeOf(raw: string | undefined): CoderRuntime {
  if (raw === CODER_RUNTIME.CLAUDE_CODE) return CODER_RUNTIME.CLAUDE_CODE;
  if (raw === CODER_RUNTIME.CODEX) return CODER_RUNTIME.CODEX;
  return CODER_RUNTIME.EVE;
}
