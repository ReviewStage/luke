import os from "node:os";
import path from "node:path";
import {
  AGENT_IDENTITY,
  agentIdentityFor,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  type SessionApplication,
  type SessionProvider,
} from "@sidecar/session";
import {
  isWireNumber,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { fileStats, readTextFile, workspaceLabel } from "../shared/local-session-adapter.js";
import { unclaimedWorkspace, WorkspaceHostSnapshot } from "../shared/workspace-host-snapshot.js";

export const ORCA_APPLICATION_NAME = "Orca";

const ORCA_DATA_DIRECTORY = "orca";
const ORCA_HOOK_STATUS_DIRECTORY = "agent-hooks";
const ORCA_HOOK_STATUS_FILE = "last-status.json";
const ORCA_STATE_FILE = "orca-data.json";

/**
 * The one version of Orca's hook-status file this build can read. Orca itself
 * hydrates an unknown version as empty rather than guessing at moved fields,
 * and reading someone else's file earns no more license than they take.
 */
const ORCA_HOOK_STATUS_VERSION = 2;

const ORCA_AGENT_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  CURSOR: "cursor",
  DEVIN: "devin",
  GEMINI: "gemini",
  OPENCODE: "opencode",
} as const;

type OrcaAgentType = (typeof ORCA_AGENT_TYPE)[keyof typeof ORCA_AGENT_TYPE];

/**
 * The agents Orca names in its own vocabulary, each mapped to the identity
 * Luke already draws that agent's sessions under. Orca hosts more agent kinds
 * than these; one Luke does not observe has no row to annotate, so its
 * bindings are simply never indexed.
 */
export const ORCA_AGENT_BY_TYPE = {
  [ORCA_AGENT_TYPE.CLAUDE]: AGENT_IDENTITY.CLAUDE_CODE,
  [ORCA_AGENT_TYPE.CODEX]: AGENT_IDENTITY.CODEX,
  [ORCA_AGENT_TYPE.CURSOR]: AGENT_IDENTITY.CURSOR,
  [ORCA_AGENT_TYPE.DEVIN]: AGENT_IDENTITY.DEVIN,
  [ORCA_AGENT_TYPE.GEMINI]: AGENT_IDENTITY.GEMINI_CLI,
  [ORCA_AGENT_TYPE.OPENCODE]: AGENT_IDENTITY.OPENCODE,
} as const satisfies Readonly<Record<OrcaAgentType, SessionProvider>>;

const ORCA_HOOK_STATUS_FIELD = {
  VERSION: "version",
  ENTRIES: "entries",
  PROVIDER_SESSION: "providerSession",
  PROVIDER_SESSION_ID: "id",
  WORKTREE_ID: "worktreeId",
  RECEIVED_AT: "receivedAt",
  PAYLOAD: "payload",
  AGENT_TYPE: "agentType",
} as const;

const ORCA_STATE_FIELD = {
  WORKTREE_META: "worktreeMeta",
  DISPLAY_NAME: "displayName",
} as const;

/** Orca's worktree ids are `<repoId>::<path>`; the path names the folder. */
const ORCA_WORKTREE_ID_SEPARATOR = "::";

/** What Orca's own hook index says about one session it holds. */
interface OrcaSessionContext {
  worktreeId: string;
  workspaceName?: string;
}

export interface OrcaWorkspaceReaderOptions {
  dataDirectory?: string;
}

export function defaultOrcaDataDirectory(): string {
  return path.join(os.homedir(), "Library", "Application Support", ORCA_DATA_DIRECTORY);
}

function orcaAgent(value: UnparsedWireValue): SessionProvider | undefined {
  return agentIdentityFor(ORCA_AGENT_BY_TYPE, text(value));
}

/** The folder half of a worktree id, for naming a worktree Orca has not named. */
function worktreePathFromId(worktreeId: string): string | undefined {
  const separator = worktreeId.indexOf(ORCA_WORKTREE_ID_SEPARATOR);
  if (separator < 0) return undefined;
  const worktreePath = worktreeId.slice(separator + ORCA_WORKTREE_ID_SEPARATOR.length);
  return worktreePath || undefined;
}

/**
 * Annotates already-observed local sessions with the Orca worktree that holds
 * them. An absent app, an unreadable file, or a version this build does not
 * know means no annotation; it can never make the provider's own observation
 * disappear.
 */
export class OrcaWorkspaceSnapshot extends WorkspaceHostSnapshot<OrcaSessionContext> {
  protected override readonly applicationId = SESSION_APPLICATION_ID.ORCA;

  /**
   * Adds Orca beside any app associations the provider already reported, and
   * groups the chat under the Orca worktree it belongs to, the way a
   * Superset-managed chat groups under its Superset workspace. A sub-agent
   * takes its nearest Orca-known ancestor's worktree: the child is Orca's
   * work even though only the parent is in its index.
   */
  protected override annotate(
    observation: ProviderSessionObservation,
    context: OrcaSessionContext,
  ): ProviderSessionObservation {
    // The workspace is claimed only where no other manager already grouped
    // the chat, and the association's scope follows it: carried by the
    // workspace, the mark sits once on the tray header; carried by the
    // session alone, it stays on the row.
    const workspace = unclaimedWorkspace(observation, {
      providerWorkspaceId: context.worktreeId,
      ...(context.workspaceName ? { name: context.workspaceName } : undefined),
      scopeId: SESSION_APPLICATION_ID.ORCA,
      managerName: ORCA_APPLICATION_NAME,
    });
    const application: SessionApplication = {
      id: SESSION_APPLICATION_ID.ORCA,
      displayName: ORCA_APPLICATION_NAME,
      scope: workspace ? SESSION_APPLICATION_SCOPE.WORKSPACE : SESSION_APPLICATION_SCOPE.SESSION,
    };
    return {
      ...observation,
      applications: [...(observation.applications ?? []), application],
      ...(workspace ? { workspace } : undefined),
    };
  }
}

/** One file's parse, reused until the file itself moves. */
interface CachedFileRecord {
  mtimeMs: number;
  size: number;
  record: WireRecord | undefined;
}

/**
 * Reads Orca's own session-to-worktree bindings without opening any agent
 * transcript. Orca's hook-status file also caches conversational fields — the
 * last prompt, a message preview, a tool's input — and this reader takes none
 * of them: an entry is read for its provider session id, its agent kind, its
 * worktree, and its timestamp, and its worktree's record for the name Orca
 * gives that worktree. Both files are parsed again only when they change on
 * disk, because the state file grows with everything Orca remembers.
 */
export class OrcaWorkspaceReader {
  readonly #dataDirectory: string;
  readonly #cache = new Map<string, CachedFileRecord>();

  constructor(options: OrcaWorkspaceReaderOptions = {}) {
    this.#dataDirectory = options.dataDirectory ?? defaultOrcaDataDirectory();
  }

  async read(): Promise<OrcaWorkspaceSnapshot> {
    const hookStatus = await this.#readRecord(
      path.join(this.#dataDirectory, ORCA_HOOK_STATUS_DIRECTORY, ORCA_HOOK_STATUS_FILE),
    );
    if (!hookStatus) return new OrcaWorkspaceSnapshot();
    if (hookStatus[ORCA_HOOK_STATUS_FIELD.VERSION] !== ORCA_HOOK_STATUS_VERSION) {
      return new OrcaWorkspaceSnapshot();
    }
    const entries = wireRecord(hookStatus[ORCA_HOOK_STATUS_FIELD.ENTRIES]);
    if (!entries) return new OrcaWorkspaceSnapshot();

    const bindings = new Map<
      string,
      Map<string, { worktreeId: string; receivedAt: number; providerId: string }>
    >();
    for (const value of Object.values(entries)) {
      const entry = wireRecord(value);
      if (!entry) continue;
      const providerSession = wireRecord(entry[ORCA_HOOK_STATUS_FIELD.PROVIDER_SESSION]);
      const payload = wireRecord(entry[ORCA_HOOK_STATUS_FIELD.PAYLOAD]);
      if (!providerSession || !payload) continue;
      const providerSessionId = text(providerSession[ORCA_HOOK_STATUS_FIELD.PROVIDER_SESSION_ID]);
      const agent = orcaAgent(payload[ORCA_HOOK_STATUS_FIELD.AGENT_TYPE]);
      const worktreeId = text(entry[ORCA_HOOK_STATUS_FIELD.WORKTREE_ID]);
      if (!providerSessionId || !agent || !worktreeId) continue;
      const receivedAt = entry[ORCA_HOOK_STATUS_FIELD.RECEIVED_AT];
      const observedAt = isWireNumber(receivedAt) ? receivedAt : 0;
      const sessions = bindings.get(agent.id) ?? new Map();
      const previous = sessions.get(providerSessionId);
      // Two panes can have carried one conversation — a session resumed in a
      // new terminal, or moved between worktrees — and the newest binding is
      // where Orca itself shows it.
      if (!previous || previous.receivedAt <= observedAt) {
        sessions.set(providerSessionId, {
          worktreeId,
          receivedAt: observedAt,
          providerId: agent.id,
        });
      }
      bindings.set(agent.id, sessions);
    }
    if (bindings.size === 0) return new OrcaWorkspaceSnapshot();

    const worktreeNames = await this.#worktreeNames();
    const sessionsByProvider = new Map<string, Map<string, OrcaSessionContext>>();
    for (const [providerId, sessions] of bindings) {
      const contexts = new Map<string, OrcaSessionContext>();
      for (const [providerSessionId, binding] of sessions) {
        const workspaceName =
          worktreeNames.get(binding.worktreeId) ??
          workspaceLabel(worktreePathFromId(binding.worktreeId));
        contexts.set(providerSessionId, {
          worktreeId: binding.worktreeId,
          ...(workspaceName ? { workspaceName } : undefined),
        });
      }
      sessionsByProvider.set(providerId, contexts);
    }
    return new OrcaWorkspaceSnapshot(sessionsByProvider);
  }

  /**
   * The name Orca's own state gives each worktree. The state file holds far
   * more than names; only the worktree table's display names are read, and a
   * missing or unreadable file costs the chosen names, never the annotation —
   * the worktree's folder still names it.
   */
  async #worktreeNames(): Promise<ReadonlyMap<string, string>> {
    const state = await this.#readRecord(path.join(this.#dataDirectory, ORCA_STATE_FILE));
    const worktreeMeta = state ? wireRecord(state[ORCA_STATE_FIELD.WORKTREE_META]) : undefined;
    const names = new Map<string, string>();
    if (!worktreeMeta) return names;
    for (const [worktreeId, value] of Object.entries(worktreeMeta)) {
      const meta = wireRecord(value);
      const displayName = meta ? text(meta[ORCA_STATE_FIELD.DISPLAY_NAME]) : undefined;
      if (displayName) names.set(worktreeId, displayName);
    }
    return names;
  }

  /** Parses a JSON file into a record, re-reading only when the file moved. */
  async #readRecord(filePath: string): Promise<WireRecord | undefined> {
    const stats = await fileStats(filePath);
    if (!stats) {
      this.#cache.delete(filePath);
      return undefined;
    }
    const cached = this.#cache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.record;
    }
    const body = await readTextFile(filePath);
    let record: WireRecord | undefined;
    if (body !== undefined) {
      try {
        const parsed: WireBoundaryInput = JSON.parse(body);
        record = wireRecord(unparsedWire(parsed));
      } catch {
        // A half-written or foreign file is no annotation, not a failed pass.
        record = undefined;
      }
    }
    this.#cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, record });
    return record;
  }
}
