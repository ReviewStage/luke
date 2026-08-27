import {
  AGENT_IDENTITY,
  agentIdentityFor,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  type SessionApplication,
} from "@sidecar/session";
import { isWireBoolean, resolveOptions, text, unparsedWire, wireRecord } from "@sidecar/wire";
import { CLI_ADAPTER_DEFAULTS, type CliRun, defaultCliRun } from "../shared/cli-session-adapter.js";
import { knownValue, recordsFromPage } from "../shared/cloud-session-adapter.js";
import {
  type WorkspaceHostContexts,
  WorkspaceHostSnapshot,
} from "../shared/workspace-host-snapshot.js";

/** Herdr writes itself lowercase as a wordmark and Herdr in every sentence. */
export const HERDR_APPLICATION_NAME = "Herdr";

/**
 * The invocations this reader is allowed to make, fixed by the build the way
 * the Codex cloud adapter's are, and read-only narrower still: `session list
 * --json` is the CLI's client-side enumeration of its named sessions, which
 * answers with no server at all and starts none, and `agent list` is its
 * documented read of the agents one running session holds. Nothing enters an
 * invocation's arguments beyond one session name the enumeration itself
 * reported, re-validated against the CLI's own published charset, as the
 * single token behind `--session`. No other herdr command is ever invoked;
 * a stopped server answers `agent list` with an error envelope rather than
 * being started, and that answer reads as a machine holding nothing.
 */
const HERDR_CLI = {
  BINARY: "herdr",
  SESSION_LIST_ARGV: ["session", "list", "--json"],
  SESSION_FLAG: "--session",
  AGENT_LIST_ARGV: ["agent", "list"],
} as const;

const HERDR_READER_DEFAULTS = {
  /** A CLI is spawned per refresh, so the pass cadence matches the CLI adapters'. */
  MINIMUM_REFRESH_INTERVAL_MS: CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS,
  /**
   * Running sessions asked about per refresh, in the CLI's own order. Each is
   * one invocation, so the walk is bounded the way the Codex environment
   * sweep is — by what a pass may spend, not by how many sessions herdr can
   * hold. Nearly every install runs only the default session.
   */
  MAXIMUM_SESSIONS_PER_PASS: 8,
  MAXIMUM_SESSION_NAME_LENGTH: 64,
  /** A session reference is an identifier, not a document; longer is distrusted. */
  MAXIMUM_SESSION_REFERENCE_LENGTH: 200,
} as const;

/**
 * Herdr's own rule for a session name — ASCII letters, numbers, '.', '_' and
 * '-' — held one character narrower at the front so the token after
 * `--session` can never read as a flag of its own.
 */
const HERDR_SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The CLI's own names for the fields this reader touches, and no others. */
const HERDR_FIELD = {
  SESSIONS: "sessions",
  NAME: "name",
  RUNNING: "running",
  RESULT: "result",
  AGENTS: "agents",
  AGENT_SESSION: "agent_session",
  AGENT: "agent",
  KIND: "kind",
  VALUE: "value",
} as const;

/**
 * How an `agent_session` reference names the hosted session: by the id the
 * agent's own hooks reported, or by its transcript's path. Only an id joins a
 * pane to a row — a path would need this reader to guess which of its parts
 * is the id, and a guessed association is worse than none.
 */
const HERDR_REFERENCE_KIND = {
  ID: "id",
  PATH: "path",
} as const;

const HERDR_AGENT_KIND = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  DEVIN: "devin",
  OPENCODE: "opencode",
} as const;

type HerdrAgentKind = (typeof HERDR_AGENT_KIND)[keyof typeof HERDR_AGENT_KIND];

/**
 * The agent kinds whose herdr integrations report a session id Luke already
 * observes that agent's sessions under. Herdr recognizes far more kinds than
 * Luke observes; a pane holding one of those carries a reference this reader
 * has no row to join, and is not read.
 */
const HERDR_PROVIDER_BY_KIND = {
  [HERDR_AGENT_KIND.CLAUDE]: AGENT_IDENTITY.CLAUDE_CODE.id,
  [HERDR_AGENT_KIND.CODEX]: AGENT_IDENTITY.CODEX.id,
  [HERDR_AGENT_KIND.CURSOR]: AGENT_IDENTITY.CURSOR.id,
  [HERDR_AGENT_KIND.DEVIN]: AGENT_IDENTITY.DEVIN.id,
  [HERDR_AGENT_KIND.OPENCODE]: AGENT_IDENTITY.OPENCODE.id,
} as const satisfies Readonly<Record<HerdrAgentKind, string>>;

/**
 * Herdr registers no URL scheme and decorates nothing per session, so a
 * matched pane contributes only its presence: the association chip is the
 * whole annotation.
 */
type HerdrSessionPresence = true;

export interface HerdrSessionApplicationReaderOptions {
  run?: CliRun;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
}

/**
 * Adds Herdr beside any app associations the provider already reported. Herdr
 * is a terminal, not a URL-scheme handler, so the association carries no
 * address and the row's own link stands untouched; and Herdr names its
 * workspaces only by directory, so a matched row keeps whatever grouping
 * another manager claimed and never groups under Herdr.
 */
export class HerdrSessionApplicationSnapshot extends WorkspaceHostSnapshot<HerdrSessionPresence> {
  protected override readonly applicationId = SESSION_APPLICATION_ID.HERDR;

  protected override annotate(observation: ProviderSessionObservation): ProviderSessionObservation {
    const application: SessionApplication = {
      id: SESSION_APPLICATION_ID.HERDR,
      displayName: HERDR_APPLICATION_NAME,
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    };
    return {
      ...observation,
      applications: [...(observation.applications ?? []), application],
    };
  }
}

/**
 * Reads which panes of the Herdr terminal manager hold sessions Luke already
 * observes, through Herdr's own CLI — the one local surface observed by
 * invocation rather than from files, because Herdr's state lives inside its
 * server and its CLI is the documented read of it. The read is bounded on
 * every side: the invocations are fixed by the build, no server is ever
 * started, and of each agent record only the hosted session reference Herdr's
 * own integrations recorded is kept — the one field that joins a pane to a
 * row. An absent binary, a stopped server, or an answer in another shape is
 * an empty snapshot; it can never make the provider's own observation
 * disappear, and a pane Herdr cannot name a session for draws no association
 * rather than a gamble.
 */
export class HerdrSessionApplicationReader {
  readonly #run: CliRun;
  readonly #now: () => number;
  readonly #minimumRefreshIntervalMs: number;

  #snapshot = new HerdrSessionApplicationSnapshot();
  #lastAttemptAt = Number.NEGATIVE_INFINITY;

  constructor(options: HerdrSessionApplicationReaderOptions = {}) {
    this.#run = options.run ?? defaultCliRun;
    this.#now = options.now ?? Date.now;
    const { minimumRefreshIntervalMs } = resolveOptions(
      options,
      { minimumRefreshIntervalMs: HERDR_READER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
      { nonNegative: ["minimumRefreshIntervalMs"] },
    );
    this.#minimumRefreshIntervalMs = minimumRefreshIntervalMs;
  }

  async read(): Promise<HerdrSessionApplicationSnapshot> {
    const now = this.#now();
    if (now - this.#lastAttemptAt < this.#minimumRefreshIntervalMs) return this.#snapshot;
    this.#lastAttemptAt = now;
    this.#snapshot = new HerdrSessionApplicationSnapshot(await this.#collect());
    return this.#snapshot;
  }

  async #collect(): Promise<WorkspaceHostContexts<HerdrSessionPresence>> {
    const sessionsByProvider = new Map<string, Map<string, HerdrSessionPresence>>();
    for (const name of await this.#runningSessionNames()) {
      const body = await this.#readJson([
        HERDR_CLI.SESSION_FLAG,
        name,
        ...HERDR_CLI.AGENT_LIST_ARGV,
      ]);
      // A session that stopped between the enumeration and its own read
      // answers an error envelope with no `result`, and holds nothing.
      const result = body ? wireRecord(body[HERDR_FIELD.RESULT]) : undefined;
      if (!result) continue;
      for (const record of recordsFromPage(result, HERDR_FIELD.AGENTS)) {
        const reference = wireRecord(record[HERDR_FIELD.AGENT_SESSION]);
        if (!reference) continue;
        if (
          knownValue(HERDR_REFERENCE_KIND, text(reference[HERDR_FIELD.KIND])) !==
          HERDR_REFERENCE_KIND.ID
        ) {
          continue;
        }
        const providerId = agentIdentityFor(
          HERDR_PROVIDER_BY_KIND,
          text(reference[HERDR_FIELD.AGENT]),
        );
        const providerSessionId = text(reference[HERDR_FIELD.VALUE]);
        if (
          !providerId ||
          !providerSessionId ||
          providerSessionId.length > HERDR_READER_DEFAULTS.MAXIMUM_SESSION_REFERENCE_LENGTH
        ) {
          continue;
        }
        const contexts = sessionsByProvider.get(providerId) ?? new Map();
        contexts.set(providerSessionId, true);
        sessionsByProvider.set(providerId, contexts);
      }
    }
    return sessionsByProvider;
  }

  /**
   * The named sessions the CLI's own enumeration reports as running, each
   * re-validated against the charset Herdr itself enforces before its name may
   * ride an invocation. A name outside that shape is not asked about at all.
   */
  async #runningSessionNames(): Promise<readonly string[]> {
    const body = await this.#readJson([...HERDR_CLI.SESSION_LIST_ARGV]);
    if (!body) return [];
    return recordsFromPage(body, HERDR_FIELD.SESSIONS)
      .filter((record) => isWireBoolean(record[HERDR_FIELD.RUNNING]) && record[HERDR_FIELD.RUNNING])
      .map((record) => text(record[HERDR_FIELD.NAME]))
      .filter(
        (name): name is string =>
          name !== undefined &&
          name.length <= HERDR_READER_DEFAULTS.MAXIMUM_SESSION_NAME_LENGTH &&
          HERDR_SESSION_NAME_PATTERN.test(name),
      )
      .slice(0, HERDR_READER_DEFAULTS.MAXIMUM_SESSIONS_PER_PASS);
  }

  /**
   * One bounded invocation, parsed as JSON or discarded. An absent binary, a
   * refused command, and an unreadable answer all read the same way here — a
   * manager annotating nothing — because an association is decoration, never
   * worth surviving on stale evidence the way a provider's own roster is.
   */
  async #readJson(argv: readonly string[]): Promise<ReturnType<typeof wireRecord>> {
    try {
      const result = await this.#run(HERDR_CLI.BINARY, argv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
      if (result.exitCode !== 0) return undefined;
      return wireRecord(unparsedWire(JSON.parse(result.stdout)));
    } catch {
      return undefined;
    }
  }
}
