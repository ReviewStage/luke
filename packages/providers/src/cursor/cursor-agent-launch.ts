import { spawn } from "node:child_process";

/** The one launch result: an exit inside the refusal window, or a turn running. */
export type CursorAgentLaunch = { exitCode: number } | "running";

export const CURSOR_AGENT_EARLY_REFUSAL_WINDOW_MS = 8_000;

/**
 * Starts a cursor-agent resume detached with no pipes and watches only for an
 * early refusal. Past the window the send is delivered and survives fiber or
 * app interruption — nothing here registers a kill finalizer after launch.
 */
export function launchCursorAgentDetached(
  binaryPath: string,
  argv: readonly string[],
  earlyRefusalWindowMs: number = CURSOR_AGENT_EARLY_REFUSAL_WINDOW_MS,
): Promise<CursorAgentLaunch> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, [...argv], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const settle = (result: CursorAgentLaunch) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const window = setTimeout(() => {
      child.unref();
      settle("running");
    }, earlyRefusalWindowMs);
    window.unref();
    child.once("exit", (code) => {
      clearTimeout(window);
      settle({ exitCode: code ?? 1 });
    });
    child.once("error", () => {
      clearTimeout(window);
      settle({ exitCode: 1 });
    });
  });
}
