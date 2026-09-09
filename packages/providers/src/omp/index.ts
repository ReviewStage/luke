import type { SessionProviderPlugin } from "@sidecar/session";
import { jsonlTranscriptReader } from "../shared/jsonl-transcript.js";
import { observationPass } from "../shared/observation-pass.js";
import {
  discoverOmpSessions,
  OMP_PROVIDER,
  type OmpSessionFileCandidate,
  ompObservation,
  type ParsedOmpSession,
  parseOmpSessionFile,
} from "./observe.js";
import { defaultOmpHome } from "./records.js";
import { linesFromOmpRecord, ompTranscriptFilePath } from "./transcript.js";

export interface OmpPluginOptions {
  ompHome?: string;
  now?: () => number;
}

/**
 * Observes the OMP sessions on this machine from the JSONL recordings the CLI
 * already writes for itself. It names no actions at all: OMP documents no way in
 * from outside its own process, and an absent handler is the unsupported
 * answer, so the plugin carries an observation pass and the two transcript
 * reads and nothing that could reach a write.
 */
export function ompPlugin(options: OmpPluginOptions = {}): SessionProviderPlugin {
  const ompHome = options.ompHome ?? defaultOmpHome();
  const pass = observationPass<OmpSessionFileCandidate, ParsedOmpSession>({
    now: options.now,
    discover: () => discoverOmpSessions(ompHome),
    parse: parseOmpSessionFile,
    observation: ompObservation,
  });
  const transcripts = jsonlTranscriptReader({
    locate: (providerSessionId) => ompTranscriptFilePath(ompHome, providerSessionId),
    lines: linesFromOmpRecord,
  });
  return {
    provider: OMP_PROVIDER,
    observe: () => pass.run(),
    latest: () => pass.latest(),
    reads: {
      transcript: (providerSessionId) => transcripts.read(providerSessionId),
      transcriptSince: (providerSessionId, cursor) =>
        transcripts.readSince(providerSessionId, cursor),
    },
  };
}
