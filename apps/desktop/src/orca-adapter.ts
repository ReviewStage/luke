import os from "node:os";
import path from "node:path";
import {
  agedStatus,
  isRecord,
  maximumSessionTitleLength,
  OBSERVATION_WINDOW,
  oneLine,
  PROVIDER_ID,
  type ProviderSessionObservation,
  recordFromJsonLine,
  resolveOptions,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionProviderAdapter,
  type SessionStatus,
  text,
  wholeNumber,
} from "@sidecar/core";
import { fileStats, readTextFile, workspaceLabel } from "./local-session-adapter";

const ORCA_PROVIDER_ID = PROVIDER_ID.ORCA;
const ORCA_PROVIDER_NAME = "Orca";

/** Orca is an Electron app, so its state lives in the platform's app-data home. */
const ORCA_DATA_DIRECTORY_SEGMENTS = ["Library", "Application Support", "Orca"] as const;

/**
 * The one file Orca persists itself into: repos, workspace metadata, and the
 * terminal-tab arrangement, written atomically on a debounce while Orca runs.
 * Everything below reads this file and nothing else — the worktrees it names
 * are never opened, and the scrollback snapshots stored beside the fields read
 * here are transcript content, which observation never touches.
 */
const ORCA_DATA_FILE = "orca-data.json";

/** How Orca forms a worktree's id: its repo's id and its path, joined fixed. */
const ORCA_WORKTREE_ID_SEPARATOR = "::";

/**
 * Newer Orca builds key per-workspace state by a kind-prefixed workspace key
 * rather than the raw worktree id; both spellings appear in installs today.
 */
const ORCA_WORKTREE_KEY_PREFIX = "worktree:";

/** The linked work items whose address is published work rather than an ask. */
const ORCA_WORK_ITEM_TYPE = {
  PULL_REQUEST: "pr",
  MERGE_REQUEST: "mr",
} as const;

/**
 * The agents Orca launches, by the id its tab records carry, named the way
 * their own products are. Orca's roster grows faster than any table here; an
 * id this build does not know titles the row as Orca wrote it rather than
 * being dropped, so the set is a courtesy of wording and never a gate.
 */
const ORCA_AGENT_LABEL: ReadonlyMap<string, string> = new Map([
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["opencode", "OpenCode"],
  ["cursor", "Cursor"],
  ["gemini", "Gemini CLI"],
  ["copilot", "GitHub Copilot CLI"],
  ["amp", "Amp"],
  ["aider", "Aider"],
  ["goose", "Goose"],
  ["droid", "Factory Droid"],
]);

export const ORCA_PROVIDER: SessionProvider = {
  id: ORCA_PROVIDER_ID,
  displayName: ORCA_PROVIDER_NAME,
};

export interface OrcaAdapterOptions {
  dataDirectory?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
}

/** One agent tab in one worktree — the unit Orca itself calls a session. */
interface OrcaAgentTab {
  providerSessionId: string;
  title?: string;
  agent?: string;
  createdAt?: number;
}

interface OrcaWorktreeSnapshot {
  worktreeId: string;
  worktreePath?: string;
  name?: string;
  repository?: string;
  unread: boolean;
  observedAt: number;
  change?: string;
  tabs: readonly OrcaAgentTab[];
}

export function defaultOrcaDataDirectory(): string {
  return path.join(os.homedir(), ...ORCA_DATA_DIRECTORY_SEGMENTS);
}

/** Exported so a test can point the adapter at a directory it wrote. */
export function orcaDataFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, ORCA_DATA_FILE);
}

/** The path half of a worktree id, which is where the id keeps it. */
function worktreePathFromId(worktreeId: string): string | undefined {
  const separatorIndex = worktreeId.indexOf(ORCA_WORKTREE_ID_SEPARATOR);
  if (separatorIndex < 0) return undefined;
  return text(worktreeId.slice(separatorIndex + ORCA_WORKTREE_ID_SEPARATOR.length));
}

function repoIdFromWorktreeId(worktreeId: string): string | undefined {
  const separatorIndex = worktreeId.indexOf(ORCA_WORKTREE_ID_SEPARATOR);
  if (separatorIndex < 0) return undefined;
  return text(worktreeId.slice(0, separatorIndex));
}

/** Each repo's own display name, keyed by the id worktree ids carry. */
function repositoryNames(state: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(state.repos)) return names;
  for (const repo of state.repos) {
    if (!isRecord(repo)) continue;
    const id = text(repo.id);
    const displayName = text(repo.displayName) ?? workspaceLabel(text(repo.path));
    if (id) names.set(id, displayName);
  }
  return names;
}

/**
 * The name a tab's session goes by, most deliberate first: the name its user
 * typed, the conversation name Orca bound to the provider session, the name
 * Orca generated from the first prompt, then the live terminal title the agent
 * CLI itself wrote — unless it is still the tab's stock label, which names a
 * terminal rather than a session.
 */
function tabTitle(tab: Record<string, unknown>): string | undefined {
  const liveTitle = text(tab.title);
  const stockTitle = text(tab.defaultTitle);
  return (
    text(tab.customTitle) ??
    (isRecord(tab.aiVaultTitle) ? text(tab.aiVaultTitle.title) : undefined) ??
    text(tab.generatedTitle) ??
    (liveTitle !== stockTitle ? liveTitle : undefined)
  );
}

/**
 * The agent tabs of one worktree. A tab is a session only when Orca launched a
 * coding agent in it or bound a provider conversation to it; a plain shell is
 * a terminal, not a session, and takes no row.
 */
function agentTabsFrom(value: unknown): OrcaAgentTab[] {
  if (!Array.isArray(value)) return [];
  const tabs: OrcaAgentTab[] = [];
  for (const tab of value) {
    if (!isRecord(tab)) continue;
    const providerSessionId = text(tab.id);
    if (!providerSessionId) continue;
    const agent = text(tab.launchAgent);
    if (!agent && !isRecord(tab.aiVaultTitle)) continue;
    tabs.push({
      providerSessionId,
      title: tabTitle(tab),
      ...(agent ? { agent } : {}),
      createdAt: wholeNumber(tab.createdAt),
    });
  }
  return tabs;
}

/** The published address a worktree's linked work item carries, when it is one. */
function changeFrom(meta: Record<string, unknown>): string | undefined {
  const linked = isRecord(meta.linkedWorkItem) ? meta.linkedWorkItem : undefined;
  const type = text(linked?.type);
  if (type !== ORCA_WORK_ITEM_TYPE.PULL_REQUEST && type !== ORCA_WORK_ITEM_TYPE.MERGE_REQUEST) {
    return undefined;
  }
  return text(linked?.url);
}

/**
 * What the worktree's own bookkeeping says of its sessions. Orca's live
 * working/waiting state flows through its hooks in memory and is never
 * persisted, so the file offers exactly two honest signals: the unread flag
 * Orca sets when an agent finishes — or rings the terminal bell — while the
 * user is looking elsewhere, and the activity clock its terminals bump while
 * output streams. Unread is a turn holding for the developer; fresh activity
 * in a workspace being watched is work under way; a workspace both read and
 * quiet has nothing this file can say, which is unknown rather than a guess.
 */
function statusFromWorktree(
  worktree: OrcaWorktreeSnapshot,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (worktree.unread) {
    return agedStatus(SESSION_STATUS.WAITING, worktree.observedAt, now, freshnessMs);
  }
  return now - worktree.observedAt <= freshnessMs ? SESSION_STATUS.WORKING : SESSION_STATUS.UNKNOWN;
}

/**
 * The worktrees worth a row, from the persisted state as one snapshot. An
 * archived worktree has been put away, and one with no agent tab holds no
 * session; neither is observed further.
 */
function worktreeSnapshotsFrom(state: Record<string, unknown>): OrcaWorktreeSnapshot[] {
  const repositories = repositoryNames(state);
  const session = isRecord(state.workspaceSession) ? state.workspaceSession : undefined;
  const tabsByWorktree = isRecord(session?.tabsByWorktree) ? session.tabsByWorktree : {};
  const worktreeMeta = isRecord(state.worktreeMeta) ? state.worktreeMeta : {};

  const snapshots: OrcaWorktreeSnapshot[] = [];
  for (const [worktreeId, meta] of Object.entries(worktreeMeta)) {
    if (!isRecord(meta)) continue;
    if (meta.isArchived === true) continue;
    const tabs = agentTabsFrom(
      tabsByWorktree[worktreeId] ?? tabsByWorktree[`${ORCA_WORKTREE_KEY_PREFIX}${worktreeId}`],
    );
    if (tabs.length === 0) continue;

    // The newest clock the worktree carries. A record with no clock at all
    // cannot be placed in time and is left off the roster rather than pinned
    // to the epoch as decades-old news.
    const observedAt = Math.max(
      wholeNumber(meta.lastActivityAt) ?? 0,
      wholeNumber(meta.createdAt) ?? 0,
      ...tabs.map((tab) => tab.createdAt ?? 0),
    );
    if (observedAt <= 0) continue;

    const repoId = repoIdFromWorktreeId(worktreeId);
    snapshots.push({
      worktreeId,
      worktreePath: worktreePathFromId(worktreeId),
      name: text(meta.displayName),
      repository: repoId ? repositories.get(repoId) : undefined,
      unread: meta.isUnread === true,
      observedAt,
      change: changeFrom(meta),
      tabs,
    });
  }
  return snapshots;
}

function detailFromWorktree(worktree: OrcaWorktreeSnapshot): SessionDetail {
  return {
    ...(worktree.repository ? { repository: worktree.repository } : {}),
    ...(worktree.change ? { change: worktree.change } : {}),
  };
}

/**
 * One observation per agent tab, each carrying the worktree around it as its
 * group: a worktree is Orca's workspace and routinely holds more than one
 * agent, and a row per worktree would make two sessions indistinguishable.
 * Status and recency are the worktree's own — Orca keeps both at that level —
 * so siblings share them, which says exactly as much as the file does.
 */
function observationsFromWorktree(
  worktree: OrcaWorktreeSnapshot,
  now: number,
  freshnessMs: number,
): ProviderSessionObservation[] {
  const status = statusFromWorktree(worktree, now, freshnessMs);
  const workspaceName = worktree.name ?? workspaceLabel(worktree.worktreePath);
  const detail = detailFromWorktree(worktree);
  return worktree.tabs.map((tab) => ({
    providerSessionId: tab.providerSessionId,
    // The tab's own name titles the row, because the row is the tab's session;
    // a tab Orca never named is titled by the agent running in it, and failing
    // even that by the workspace name that groups it.
    title:
      oneLine(tab.title, maximumSessionTitleLength) ??
      (tab.agent ? (ORCA_AGENT_LABEL.get(tab.agent) ?? tab.agent) : workspaceName),
    status,
    observedAt: worktree.observedAt,
    workspace: { providerWorkspaceId: worktree.worktreeId, name: workspaceName },
    detail,
  }));
}

/**
 * Observes the Orca sessions on this machine from the state file Orca already
 * writes for itself. It runs no server, needs no credential, and opens the one
 * file read-only; the sessions it reports are read-only rows, because Orca
 * documents no endpoint an observer could carry a message or control through.
 */
export class OrcaSessionAdapter implements SessionProviderAdapter {
  readonly provider = ORCA_PROVIDER;

  readonly #dataFilePath: string;
  readonly #now: () => number;
  readonly #activeSessionFreshnessMs: number;
  /**
   * What the state file said as of the write it was read at. The file is
   * rewritten whole on Orca's debounce, so one parse per write is the floor —
   * and the cache is what keeps a quiet Orca costing a stat per pass.
   */
  #parsed?: { mtimeMs: number; size: number; worktrees: readonly OrcaWorktreeSnapshot[] };

  constructor(options: OrcaAdapterOptions = {}) {
    this.#dataFilePath = orcaDataFilePath(options.dataDirectory ?? defaultOrcaDataDirectory());
    this.#now = options.now ?? Date.now;
    const resolved = resolveOptions(
      options,
      {
        activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
      },
      {
        nonNegative: ["activeSessionFreshnessMs"],
      },
    );
    this.#activeSessionFreshnessMs = resolved.activeSessionFreshnessMs;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const stats = await fileStats(this.#dataFilePath);
    if (!stats?.isFile()) {
      this.#parsed = undefined;
      return [];
    }
    if (
      this.#parsed === undefined ||
      this.#parsed.mtimeMs !== stats.mtimeMs ||
      this.#parsed.size !== stats.size
    ) {
      // A file mid-replacement or from a build this one cannot read parses to
      // nothing this pass; Orca's next debounced write is a fresh answer.
      const state = recordFromJsonLine((await readTextFile(this.#dataFilePath)) ?? "");
      this.#parsed = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        worktrees: state ? worktreeSnapshotsFrom(state) : [],
      };
    }
    const now = this.#now();
    return this.#parsed.worktrees.flatMap((worktree) =>
      observationsFromWorktree(worktree, now, this.#activeSessionFreshnessMs),
    );
  }
}
