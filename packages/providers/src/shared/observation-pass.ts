import { OBSERVATION_WINDOW, type ProviderSessionObservation } from "@sidecar/session";
import type { SessionFileCandidate } from "./local-files.js";

/**
 * The roster the latest pass published, and nothing else. Every act is
 * re-validated against exactly this, so the one thing a provider has to get
 * right is publishing it — which is why holding it is a function rather than
 * a protected field a subclass could forget to write.
 */
export interface RosterHolder {
  publish(
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[];
  latest(): readonly ProviderSessionObservation[];
}

export function rosterHolder(): RosterHolder {
  let observations: readonly ProviderSessionObservation[] = [];
  return {
    publish(published) {
      observations = published;
      return observations;
    },
    latest: () => observations,
  };
}

/** Everything one file-backed provider decides about its own pass. */
export interface ObservationPassInput<Candidate extends SessionFileCandidate, Parsed> {
  now?: () => number;
  discover(): Promise<readonly Candidate[]>;
  /** Provider lookup state built once per pass, before any parse. */
  prepare?(candidates: readonly Candidate[]): Promise<void> | void;
  /** Called only for a candidate whose mtime moved since the last pass. */
  parse(candidate: Candidate): Promise<Parsed>;
  observation(input: {
    readonly candidate: Candidate;
    readonly parsed: Parsed;
    readonly now: number;
    /**
     * The window the build fixes, handed over rather than imported so a
     * provider's own status lattice reads it from the pass that dated the
     * observation and cannot decay against a different clock.
     */
    readonly activeSessionFreshnessMs: number;
  }): Promise<ProviderSessionObservation | undefined> | ProviderSessionObservation | undefined;
}

export interface ObservationPass {
  /** Discover, prepare, parse only what changed, assemble, prune vanished parses. */
  run(): Promise<readonly ProviderSessionObservation[]>;
  /** The roster the last `run` published — what every act is re-validated against. */
  latest(): readonly ProviderSessionObservation[];
}

/**
 * The shared observation lifecycle for transcript-backed local providers:
 * discover, prepare provider-specific lookup state, parse only changed files,
 * assemble one observation per session, and prune parses for vanished files.
 * A candidate list arrives newest-first, so a session id two files claim
 * resolves to its latest file and the older one is skipped.
 */
export function observationPass<Candidate extends SessionFileCandidate, Parsed>(
  input: ObservationPassInput<Candidate, Parsed>,
): ObservationPass {
  const now = input.now ?? Date.now;
  const parsed = new Map<string, { mtimeMs: number; value: Parsed }>();
  const roster = rosterHolder();

  const parseAndCache = async (candidate: Candidate): Promise<Parsed> => {
    const value = await input.parse(candidate);
    parsed.set(candidate.filePath, { mtimeMs: candidate.mtimeMs, value });
    return value;
  };

  return {
    async run() {
      const observedAt = now();
      const candidates = await input.discover();
      await input.prepare?.(candidates);
      const observations = new Map<string, ProviderSessionObservation>();
      for (const candidate of candidates) {
        if (observations.has(candidate.providerSessionId)) continue;
        const cached = parsed.get(candidate.filePath);
        const value =
          cached?.mtimeMs === candidate.mtimeMs ? cached.value : await parseAndCache(candidate);
        const observation = await input.observation({
          candidate,
          parsed: value,
          now: observedAt,
          activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
        });
        if (observation) observations.set(candidate.providerSessionId, observation);
      }
      const discovered = new Set(candidates.map((candidate) => candidate.filePath));
      for (const filePath of parsed.keys()) {
        if (!discovered.has(filePath)) parsed.delete(filePath);
      }
      return roster.publish([...observations.values()]);
    },
    latest: () => roster.latest(),
  };
}
