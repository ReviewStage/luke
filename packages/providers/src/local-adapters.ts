import { PROVIDER_ID } from "@sidecar/session";
import { ClaudeCodeSessionAdapter } from "./claude-code/adapter.js";
import { CodexSessionAdapter } from "./codex/adapter.js";
import type { ObservationHookProviderId } from "./hook-registry.js";
import { OmpSessionAdapter } from "./omp/adapter.js";

/**
 * Where each local adapter reads, overridable so a test can pin every
 * location to synthetic fixtures. Only read locations can be injected —
 * nothing hook-bearing beyond the spool below, nothing credential-bearing —
 * so a caller cannot widen what a local adapter reaches.
 */
export interface LocalSessionAdapterHomes {
  claudeHome?: string;
  codexHome?: string;
  ompHome?: string;
}

export interface LocalSessionAdapterOptions extends LocalSessionAdapterHomes {
  /**
   * The spool the named provider's observation hook writes into. Absent —
   * the introduction's keyless peek — every adapter reads the provider's own
   * recordings alone, which is what these adapters did before hooks existed.
   */
  hookEventsDirectory?: (providerId: ObservationHookProviderId) => () => string;
}

/**
 * The on-disk adapters, in one table. The registrations wrap some of these in
 * composites and hand the hooked ones a spool; the introduction's keyless
 * peek reads them bare. Both build from here rather than from rosters of
 * their own, so a new local provider joins observation and first-launch
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
    omp: new OmpSessionAdapter({ ompHome: options.ompHome }),
  };
}
