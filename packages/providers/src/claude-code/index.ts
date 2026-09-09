import type { SessionProviderPlugin } from "@sidecar/session";
import { jsonlTranscriptReader } from "../shared/jsonl-transcript.js";
import type { SessionFileCandidate } from "../shared/local-files.js";
import { observationPass } from "../shared/observation-pass.js";
import { defaultClaudeHome, readClaudeHookEvent } from "./hooks.js";
import {
  CLAUDE_CODE_PROVIDER,
  claudeObservation,
  discoverClaudeSessions,
  type ParsedClaudeSessionTail,
  parseClaudeSessionFile,
} from "./observe.js";
import { claudeTranscriptFilePath, linesFromClaudeRecord } from "./transcript.js";

export interface ClaudeCodePluginOptions {
  claudeHome?: string;
  now?: () => number;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud plugins' credentials, because the app decides
   * the path after this plugin is built. Absent — or answering nothing — the
   * pass reads the transcripts alone, exactly as it always has: the hooks
   * only ever sharpen what the tail already showed.
   */
  hookEventsDirectory?: () => string | undefined;
}

/**
 * Observes the Claude Code sessions on this machine from the JSONL
 * transcripts the CLI already writes for itself, sharpened where the
 * observation hook left a token. It names no acts: Claude Code documents no
 * endpoint a session can be written to from outside its own process, and an
 * absent handler is the unsupported answer.
 */
export function claudeCodePlugin(options: ClaudeCodePluginOptions = {}): SessionProviderPlugin {
  const claudeHome = options.claudeHome ?? defaultClaudeHome();
  const pass = observationPass<SessionFileCandidate, ParsedClaudeSessionTail>({
    now: options.now,
    discover: () => discoverClaudeSessions(claudeHome),
    parse: parseClaudeSessionFile,
    async observation({ candidate, parsed, now, activeSessionFreshnessMs }) {
      const hookEventsDirectory = options.hookEventsDirectory?.();
      const hookEvent = hookEventsDirectory
        ? await readClaudeHookEvent(hookEventsDirectory, candidate.providerSessionId).catch(
            () => undefined,
          )
        : undefined;
      return claudeObservation({
        candidate,
        parsed,
        now,
        activeSessionFreshnessMs,
        ...(hookEvent ? { hookEvent } : undefined),
      });
    },
  });
  const transcripts = jsonlTranscriptReader({
    locate: (providerSessionId) => claudeTranscriptFilePath(claudeHome, providerSessionId),
    lines: linesFromClaudeRecord,
  });
  return {
    provider: CLAUDE_CODE_PROVIDER,
    observe: () => pass.run(),
    latest: () => pass.latest(),
    reads: {
      transcript: (providerSessionId) => transcripts.read(providerSessionId),
      transcriptSince: (providerSessionId, cursor) =>
        transcripts.readSince(providerSessionId, cursor),
    },
  };
}
