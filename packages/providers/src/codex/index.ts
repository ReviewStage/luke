import { OBSERVATION_WINDOW, type SessionProviderPlugin } from "@sidecar/session";
import { Effect } from "effect";
import { jsonlTranscriptReader, promiseTranscriptReads } from "../shared/jsonl-transcript.js";
import { defaultSqliteModule, type SqliteModuleLoader } from "../shared/local-sqlite.js";
import { rosterHolder } from "../shared/observation-pass.js";
import { runAdapterRead } from "../shared/promise-face.js";
import { defaultCodexHome } from "./config.js";
import { CODEX_PROVIDER, codexObservations } from "./observe.js";
import { type CodexStateLocation, rolloutPathForThread, threadRows } from "./state.js";
import { codexRolloutRefusal, linesFromCodexRecord } from "./transcript.js";

export interface CodexLocalPluginOptions {
  codexHome?: string | undefined;
  sqliteHome?: string;
  now?: () => number;
  sqlite?: SqliteModuleLoader;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud plugins' credentials, because the app decides
   * the path after this plugin is built. Absent — or answering nothing — the
   * pass reads the state database and rollouts alone, exactly as it always
   * has: the hooks only ever sharpen what those already showed.
   */
  hookEventsDirectory?: () => string | undefined;
}

/**
 * Observes the Codex sessions on this machine from the state database Codex
 * writes for itself and the rollout each thread names, sharpened where the
 * observation hook left a token. It names no actions: Codex documents no
 * endpoint a local thread can be written to from outside its own process,
 * and an absent handler is the unsupported answer.
 *
 * The pass is its own rather than `observationPass`'s: a Codex thread is a
 * SQL row, not a file with an mtime, so there is nothing for a parse cache
 * keyed on a path to key on.
 */
export function codexLocalPlugin(options: CodexLocalPluginOptions = {}): SessionProviderPlugin {
  const now = options.now ?? Date.now;
  const location: CodexStateLocation = {
    codexHome: options.codexHome ?? defaultCodexHome(),
    ...(options.sqliteHome === undefined ? undefined : { sqliteHome: options.sqliteHome }),
    sqlite: options.sqlite ?? defaultSqliteModule,
  };
  const roster = rosterHolder();
  const transcripts = jsonlTranscriptReader({
    locate: (providerSessionId) => rolloutPathForThread(location, providerSessionId),
    refuses: codexRolloutRefusal,
    lines: linesFromCodexRecord,
  });
  const observe = Effect.gen(function* () {
    const observedAt = now();
    const rows = yield* threadRows(location);
    const observations = yield* codexObservations({
      codexHome: location.codexHome,
      rows,
      hookEventsDirectory: options.hookEventsDirectory?.(),
      now: observedAt,
      activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
    });
    return roster.publish(observations);
  });
  return {
    provider: CODEX_PROVIDER,
    observe: () => runAdapterRead(observe),
    latest: () => roster.latest(),
    reads: promiseTranscriptReads(transcripts),
  };
}
