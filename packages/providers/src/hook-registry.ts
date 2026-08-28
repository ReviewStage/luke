import path from "node:path";
import { PROVIDER_ID } from "@sidecar/session";
import { CLAUDE_HOOK_SCRIPT_NAME, defaultClaudeHome } from "./claude-code/hooks.js";
import { defaultCodexHome } from "./codex/adapter.js";
import { CODEX_HOOK_SCRIPT_NAME } from "./codex/hooks.js";
import { CURSOR_HOOK_SCRIPT_NAME } from "./cursor/hooks.js";
import { defaultCursorHome } from "./cursor/local-adapter.js";
import { DEVIN_HOOK_SCRIPT_NAME, defaultDevinConfigHome } from "./devin/hooks.js";
import { GEMINI_HOOK_SCRIPT_NAME } from "./gemini-cli/hooks.js";
import { defaultGeminiCliHome } from "./gemini-cli/records.js";
import {
  defaultOpenCodeConfigDirectory,
  OPENCODE_PLUGIN_FILE_NAME,
  openCodePluginDirectory,
} from "./opencode/hooks.js";
import type { ObservationHookInstallation } from "./shared/hook-merge.js";

const SPOOL_DIRECTORY = "events";

/**
 * The shape a channel qualifier must keep to ride an artifact's file name.
 * The qualifier is fixed by the build that supplies it, never observed, so a
 * value outside this shape is a programming error worth stopping on.
 */
const ARTIFACT_QUALIFIER_PATTERN = /^[a-z0-9]+$/;

/**
 * The installed artifact's name: the provider's base name with the channel
 * qualifier spliced in ahead of the extension, so
 * `luke-claude-observation-hook.sh` installs as
 * `luke-claude-observation-hook.dev.sh` on a qualified channel. The name is
 * also the marker a channel's registered entries are recognized by, so the
 * splice is what lets two channels' registrations stand side by side in one
 * provider configuration: neither channel's name is a substring of the
 * other's, so neither reconciles the other's entries. The extension is kept
 * last because providers select plugin files by it (OpenCode globs `*.js`).
 */
function qualifiedArtifactName(baseName: string, qualifier: string | undefined): string {
  if (qualifier === undefined) return baseName;
  if (!ARTIFACT_QUALIFIER_PATTERN.test(qualifier)) {
    throw new Error(`observation hook artifact qualifier is not a lowercase token: ${qualifier}`);
  }
  const extension = path.extname(baseName);
  return `${baseName.slice(0, baseName.length - extension.length)}.${qualifier}${extension}`;
}

interface ObservationHookProviderEntry {
  directoryName: string;
  scriptName: string;
  providerHome: () => string;
  /**
   * Where the installed artifact lives when it is not under Luke's own data:
   * a provider that loads whole plugin files from a directory of its own has
   * its one artifact resolve there, while the spool stays under Luke's.
   */
  artifactDirectory?: (providerHome: string) => string;
}

/**
 * One row per provider that registers observation hooks at all: the directory
 * each arrangement keeps under Luke's own application data, the artifact it
 * installs, and the provider home the arrangement joins. Widening this table
 * to another provider is a product decision, not an implementation detail.
 */
const OBSERVATION_HOOK_PROVIDERS = {
  [PROVIDER_ID.CLAUDE_CODE]: {
    directoryName: "claude-code-hooks",
    scriptName: CLAUDE_HOOK_SCRIPT_NAME,
    providerHome: defaultClaudeHome,
  },
  [PROVIDER_ID.CODEX]: {
    directoryName: "codex-hooks",
    scriptName: CODEX_HOOK_SCRIPT_NAME,
    providerHome: defaultCodexHome,
  },
  [PROVIDER_ID.CURSOR]: {
    directoryName: "cursor-hooks",
    scriptName: CURSOR_HOOK_SCRIPT_NAME,
    providerHome: defaultCursorHome,
  },
  [PROVIDER_ID.DEVIN]: {
    directoryName: "devin-hooks",
    scriptName: DEVIN_HOOK_SCRIPT_NAME,
    // The configuration home, not the data home the session database lives
    // under: the registration merges into the CLI's user-level config.json,
    // and the CLI creates this directory for itself on its first run.
    providerHome: defaultDevinConfigHome,
  },
  [PROVIDER_ID.GEMINI_CLI]: {
    directoryName: "gemini-cli-hooks",
    scriptName: GEMINI_HOOK_SCRIPT_NAME,
    providerHome: defaultGeminiCliHome,
  },
  [PROVIDER_ID.OPENCODE]: {
    directoryName: "opencode-hooks",
    scriptName: OPENCODE_PLUGIN_FILE_NAME,
    providerHome: defaultOpenCodeConfigDirectory,
    artifactDirectory: openCodePluginDirectory,
  },
} as const satisfies Readonly<Record<string, ObservationHookProviderEntry>>;

export type ObservationHookProviderId = keyof typeof OBSERVATION_HOOK_PROVIDERS;

/**
 * Luke's own corners of the application data, holding each provider's
 * observation hook script and the spool it writes into. Resolved lazily
 * because the application data path is not known until the app is ready, and
 * reproduced rather than stored so a run always converges on the paths this
 * build names.
 */
export class ObservationHookRegistry {
  readonly #userDataDirectory: () => string;
  readonly #artifactQualifier: string | undefined;

  /**
   * The qualifier names the channel this instance installs for — the caller's
   * build fixes it, `dev` and `test` for the desktop's non-release channels —
   * so several always-on channels each converge their own registrations
   * without reconciling a sibling's. Absent, artifacts keep their base names,
   * which is the released channel's shape and the one entries written before
   * any qualifier existed already carry.
   */
  constructor(userDataDirectory: () => string, artifactQualifier?: string) {
    this.#userDataDirectory = userDataDirectory;
    this.#artifactQualifier = artifactQualifier;
  }

  installation(providerId: ObservationHookProviderId): ObservationHookInstallation {
    const entry: ObservationHookProviderEntry = OBSERVATION_HOOK_PROVIDERS[providerId];
    const directory = path.join(this.#userDataDirectory(), entry.directoryName);
    const providerHome = entry.providerHome();
    return {
      providerHome,
      hookScriptPath: path.join(
        entry.artifactDirectory?.(providerHome) ?? directory,
        qualifiedArtifactName(entry.scriptName, this.#artifactQualifier),
      ),
      spoolDirectory: path.join(directory, SPOOL_DIRECTORY),
    };
  }
}
