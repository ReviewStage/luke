import path from "node:path";
import {
  CLAUDE_HOOK_SCRIPT_NAME,
  type ClaudeCodeHookInstallation,
  defaultClaudeHome,
} from "./claude-code-hooks";
import { defaultCodexHome } from "./codex-adapter";
import { CODEX_HOOK_SCRIPT_NAME, type CodexHookInstallation } from "./codex-hooks";

const HOOK_DIRECTORY = {
  CLAUDE_CODE: "claude-code-hooks",
  CODEX: "codex-hooks",
} as const;
const SPOOL_DIRECTORY = "events";

/**
 * Luke's own corners of the application data, holding each provider's
 * observation hook script and the spool it writes into. Resolved lazily
 * because the application data path is not known until the app is ready, and
 * reproduced rather than stored so a run always converges on the paths this
 * build names.
 */
export class ObservationHookRegistry {
  readonly #userDataDirectory: () => string;

  constructor(userDataDirectory: () => string) {
    this.#userDataDirectory = userDataDirectory;
  }

  claudeInstallation(): ClaudeCodeHookInstallation {
    return {
      claudeHome: defaultClaudeHome(),
      ...this.#paths(HOOK_DIRECTORY.CLAUDE_CODE, CLAUDE_HOOK_SCRIPT_NAME),
    };
  }

  codexInstallation(): CodexHookInstallation {
    return {
      codexHome: defaultCodexHome(),
      ...this.#paths(HOOK_DIRECTORY.CODEX, CODEX_HOOK_SCRIPT_NAME),
    };
  }

  #paths(directoryName: string, scriptName: string) {
    const directory = path.join(this.#userDataDirectory(), directoryName);
    return {
      hookScriptPath: path.join(directory, scriptName),
      spoolDirectory: path.join(directory, SPOOL_DIRECTORY),
    };
  }
}
