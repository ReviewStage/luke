import { OBSERVATION_WINDOW, type ProviderSessionObservation } from "@sidecar/session";
import { Effect, Ref } from "effect";
import type { SessionFileCandidate } from "./local-files.js";
import { runAdapterRead } from "./promise-face.js";

/**
 * The roster the latest pass published, and nothing else. Every action is
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
  now?: (() => number) | undefined;
  discover(): Effect.Effect<readonly Candidate[]>;
  /** Provider lookup state built once per pass, before any parse. */
  prepare?(candidates: readonly Candidate[]): Effect.Effect<void>;
  /** Called only for a candidate whose mtime moved since the last pass. */
  parse(candidate: Candidate): Effect.Effect<Parsed>;
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
  }): Effect.Effect<ProviderSessionObservation | undefined>;
}

export interface ObservationPass {
  /** Discover, prepare, parse only what changed, assemble, prune vanished parses. */
  run: Effect.Effect<readonly ProviderSessionObservation[]>;
  /**
   * @deprecated The promise face of {@link ObservationPass.run}, for the
   * plugin seam the host still holds; deleted with P7-05.
   */
  runPromise(): Promise<readonly ProviderSessionObservation[]>;
  /** The roster the last run published — what every action is re-validated against. */
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
  const parsed = Ref.unsafeMake(new Map<string, { mtimeMs: number; value: Parsed }>());
  const roster = rosterHolder();

  const parseAndCache = (candidate: Candidate): Effect.Effect<Parsed> =>
    Effect.tap(input.parse(candidate), (value) =>
      Ref.update(parsed, (held) =>
        new Map(held).set(candidate.filePath, { mtimeMs: candidate.mtimeMs, value }),
      ),
    );

  const parsedFor = (candidate: Candidate): Effect.Effect<Parsed> =>
    Effect.flatMap(Ref.get(parsed), (held) => {
      const cached = held.get(candidate.filePath);
      return cached?.mtimeMs === candidate.mtimeMs
        ? Effect.succeed(cached.value)
        : parseAndCache(candidate);
    });

  const run = Effect.gen(function* () {
    const observedAt = now();
    const candidates = yield* input.discover();
    if (input.prepare) yield* input.prepare(candidates);
    const observations = new Map<string, ProviderSessionObservation>();
    for (const candidate of candidates) {
      if (observations.has(candidate.providerSessionId)) continue;
      const value = yield* parsedFor(candidate);
      const observation = yield* input.observation({
        candidate,
        parsed: value,
        now: observedAt,
        activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
      });
      if (observation) observations.set(candidate.providerSessionId, observation);
    }
    const discovered = new Set(candidates.map((candidate) => candidate.filePath));
    yield* Ref.update(
      parsed,
      (held) => new Map([...held].filter(([filePath]) => discovered.has(filePath))),
    );
    return roster.publish([...observations.values()]);
  });

  return {
    run,
    runPromise: () => runAdapterRead(run),
    latest: () => roster.latest(),
  };
}
