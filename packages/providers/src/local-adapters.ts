import { PROVIDER_ID } from "@sidecar/session";
import { ClaudeCodeSessionAdapter } from "./claude-code/adapter.js";
import { CodexSessionAdapter } from "./codex/adapter.js";
import type { ObservationHookProviderId } from "./hook-registry.js";
import { ompPlugin } from "./omp/index.js";

/**
 * Where each local observer reads, overridable so a test can pin every
 * location to synthetic fixtures. Only read locations can be injected —
 * nothing hook-bearing beyond the spool below, nothing credential-bearing —
 * so a caller cannot widen what a local observer reaches.
 */
export interface LocalSessionAdapterHomes {
  claudeHome?: string;
  codexHome?: string;
  ompHome?: string;
}

export interface LocalSessionAdapterOptions extends LocalSessionAdapterHomes {
  /**
   * The spool the named provider's observation hook writes into. Absent —
   * the introduction's keyless peek — every observer reads the provider's own
   * recordings alone, which is what they did before hooks existed.
   */
  hookEventsDirectory?: (providerId: ObservationHookProviderId) => () => string;
}

/**
 * The on-disk observers, in one table. The registrations merge some of these
 * with a cloud half and hand the hooked ones a spool; the introduction's
 * keyless peek reads them bare. Both build from here rather than from rosters
 * of their own, so a new local provider joins observation and first-launch
 * detection in the same edit — two hand-kept lists drifted silently.
 */
export function localSessionAdapters(options: LocalSessionAdapterOptions = {}) {
  const spool = (providerId: ObservationHookProviderId) =>
    options.hookEventsDirectory
      ? { hookEventsDirectory: options.hookEventsDirectory(providerId) }
      : undefined;
  return {
    claudeCode: new ClaudeCodeSessionAdapter({
      claudeHome: options.claudeHome,
      ...spool(PROVIDER_ID.CLAUDE_CODE),
    }),
    codexLocal: new CodexSessionAdapter({
      codexHome: options.codexHome,
      ...spool(PROVIDER_ID.CODEX),
    }),
    omp: ompPlugin({ ompHome: options.ompHome }),
  };
}
