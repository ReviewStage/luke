import os from "node:os";
import path from "node:path";
import { isRecord, recordFromJsonLine, text, WORKSPACE_MANAGER, wholeNumber } from "@sidecar/core";
import {
  fileStats,
  readTextFile,
  type WorkspaceAnnotation,
  type WorkspaceAnnotationLookup,
} from "./local-session-adapter";

/**
 * Orca (github.com/stablyai/orca) manages coding agents in parallel git
 * worktrees. The agents it launches are the same Claude Code, Codex, OpenCode,
 * and Cursor processes Luke already observes from their own files, so Orca
 * gets no rows of its own — a second, coarser row per session would say less
 * than the row that already exists. What Orca uniquely knows is the workspace
 * *around* a session: the worktree it created, the name it gave the work, and
 * the pull request linked to it. This index reads exactly that, and the local
 * adapters wear it as an annotation on the rows they were already reporting.
 *
 * The files read are Orca's own `orca-data.json` state files. Orca builds with
 * profiles keep one per profile under `profiles/<id>/`, found through the ids
 * in `orca-profile-index.json`; builds from before keep the single legacy
 * file, which a migrated install leaves behind frozen at the migration — so
 * the legacy file is read only while no profile index exists, never merged
 * with one. Orca flushes these files coarsely rather than continuously, which
 * is why they can annotate but never carry a session's liveness: identity
 * keeps between quits, status does not. The scrollback snapshots stored beside
 * these fields are transcript content and are never read, and the worktrees
 * the files name are never opened.
 */

const ORCA_DATA_DIRECTORY_SEGMENTS = ["Library", "Application Support", "orca"] as const;
const ORCA_DATA_FILE = "orca-data.json";
const ORCA_PROFILE_INDEX_FILE = "orca-profile-index.json";
const ORCA_PROFILES_DIRECTORY = "profiles";

/** How Orca forms a worktree's id: its repo's id and its path, joined fixed. */
const ORCA_WORKTREE_ID_SEPARATOR = "::";

/** The linked work items whose address is published work rather than an ask. */
const ORCA_WORK_ITEM_TYPE = {
  PULL_REQUEST: "pr",
  MERGE_REQUEST: "mr",
} as const;

/** Where Orca puts worktrees when the user has not chosen a different root. */
const ORCA_DEFAULT_WORKSPACE_ROOT_SEGMENTS = ["orca", "workspaces"] as const;

export interface OrcaWorkspaceIndexOptions {
  dataDirectory?: string;
}

export function defaultOrcaDataDirectory(): string {
  return path.join(os.homedir(), ...ORCA_DATA_DIRECTORY_SEGMENTS);
}

/** Exported so a test can point the index at a directory it wrote. */
export function orcaDataFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, ORCA_DATA_FILE);
}

/** Exported so a test can write the profile index the way Orca lays it out. */
export function orcaProfileIndexFilePath(dataDirectory: string): string {
  return path.join(dataDirectory, ORCA_PROFILE_INDEX_FILE);
}

/** Exported so a test can write a profile's state file where Orca keeps it. */
export function orcaProfileDataDirectory(dataDirectory: string, profileId: string): string {
  return path.join(dataDirectory, ORCA_PROFILES_DIRECTORY, profileId);
}

/**
 * The profiles the index lists, the active one first so its answer wins when
 * two profiles claim the same worktree. An id is joined into a path, so one
 * that names anything but a single directory is refused rather than followed.
 */
function profileIdsFrom(state: Record<string, unknown>): readonly string[] {
  const listed = Array.isArray(state.profiles) ? state.profiles : [];
  const ids: string[] = [];
  for (const profile of listed) {
    if (!isRecord(profile)) continue;
    const id = text(profile.id);
    if (!id || id === "." || id === ".." || id.includes("/") || id.includes(path.sep)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  const active = text(state.activeProfileId);
  if (active && ids.includes(active)) {
    return [active, ...ids.filter((id) => id !== active)];
  }
  return ids;
}

/** The path half of a worktree id, which is where the id keeps it. */
function worktreePathFromId(worktreeId: string): string | undefined {
  const separatorIndex = worktreeId.indexOf(ORCA_WORKTREE_ID_SEPARATOR);
  if (separatorIndex < 0) return undefined;
  return text(worktreeId.slice(separatorIndex + ORCA_WORKTREE_ID_SEPARATOR.length));
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
 * The root Orca creates worktrees under: the setting when the user chose one,
 * the documented default otherwise. A leading `~` is Orca's own spelling for
 * the home directory.
 */
function workspaceRootFrom(state: Record<string, unknown>): string {
  const settings = isRecord(state.settings) ? state.settings : undefined;
  const configured = text(settings?.workspaceDirectory);
  if (!configured) return path.join(os.homedir(), ...ORCA_DEFAULT_WORKSPACE_ROOT_SEGMENTS);
  if (configured === "~") return os.homedir();
  if (configured.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), configured.slice(2));
  }
  return configured;
}

/**
 * Whether this worktree is one Orca manages, rather than one it merely lists.
 * Orca's sidebar also shows worktrees other tools created — Conductor's,
 * Cursor's, Codex's — and claiming those for Orca would annotate a session
 * with a manager it does not have. Orca's own are told by the markers it
 * stamps at creation, or by living under Orca's own workspace root.
 */
function isOrcaManagedWorktree(
  meta: Record<string, unknown>,
  worktreePath: string,
  workspaceRoot: string,
): boolean {
  if (wholeNumber(meta.orcaCreatedAt) !== undefined) return true;
  if (text(meta.orcaCreationSource)) return true;
  if (text(meta.createdWithAgent)) return true;
  return worktreePath.startsWith(`${workspaceRoot}${path.sep}`);
}

function annotationsFrom(state: Record<string, unknown>): Map<string, WorkspaceAnnotation> {
  const worktreeMeta = isRecord(state.worktreeMeta) ? state.worktreeMeta : {};
  const workspaceRoot = workspaceRootFrom(state);
  const annotations = new Map<string, WorkspaceAnnotation>();
  for (const [worktreeId, meta] of Object.entries(worktreeMeta)) {
    if (!isRecord(meta)) continue;
    const worktreePath = worktreePathFromId(worktreeId);
    if (!worktreePath || !path.isAbsolute(worktreePath)) continue;
    if (!isOrcaManagedWorktree(meta, worktreePath, workspaceRoot)) continue;
    const change = changeFrom(meta);
    // The workspace rides only when Orca actually named it. A lone annotated
    // session cedes its row title to the workspace name — the name the user
    // knows the work by — and an unnamed worktree has only its folder leaf to
    // offer, which would replace the session's own title with less than the
    // row already says.
    const name = text(meta.displayName);
    if (!name && !change) continue;
    annotations.set(worktreePath, {
      ...(name
        ? {
            workspace: {
              // The path is the one name both sides know the worktree by:
              // Orca's id embeds it, and the agent's own records carry it as
              // the session's working directory.
              providerWorkspaceId: worktreePath,
              name,
              manager: WORKSPACE_MANAGER.ORCA,
            },
          }
        : {}),
      ...(change ? { change } : {}),
    });
  }
  return annotations;
}

interface ParsedFile<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

/**
 * Reads Orca's worktree index and answers, for a session's working directory,
 * which Orca workspace it runs in. One stat per observation pass for the
 * profile index and one per state file it names, one parse per write of each,
 * no rows of its own.
 */
export class OrcaWorkspaceIndex {
  readonly #dataDirectory: string;
  #parsedProfileIndex?: ParsedFile<readonly string[]>;
  #parsedData = new Map<string, ParsedFile<Map<string, WorkspaceAnnotation>>>();

  constructor(options: OrcaWorkspaceIndexOptions = {}) {
    this.#dataDirectory = options.dataDirectory ?? defaultOrcaDataDirectory();
  }

  /**
   * The lookup one observation pass spends: refreshed once, then consulted
   * synchronously per session. A session's directory matches its worktree
   * exactly or from inside it — an agent started in a subdirectory is still
   * that workspace's session.
   */
  async annotations(): Promise<WorkspaceAnnotationLookup> {
    const annotations = await this.#currentAnnotations();
    if (annotations.size === 0) return () => undefined;
    return (directory) => {
      if (!directory) return undefined;
      let candidate = path.resolve(directory);
      while (true) {
        const annotation = annotations.get(candidate);
        if (annotation) return annotation;
        const parent = path.dirname(candidate);
        if (parent === candidate) return undefined;
        candidate = parent;
      }
    };
  }

  async #currentAnnotations(): Promise<Map<string, WorkspaceAnnotation>> {
    const dataFilePaths = await this.#dataFilePaths();
    for (const cachedPath of this.#parsedData.keys()) {
      if (!dataFilePaths.includes(cachedPath)) this.#parsedData.delete(cachedPath);
    }
    const merged = new Map<string, WorkspaceAnnotation>();
    for (const dataFilePath of dataFilePaths) {
      for (const [worktreePath, annotation] of await this.#annotationsIn(dataFilePath)) {
        if (!merged.has(worktreePath)) merged.set(worktreePath, annotation);
      }
    }
    return merged;
  }

  /**
   * Which state files this pass reads: each listed profile's own, or the
   * legacy single file while no profile index exists. A profile index present
   * but unreadable is no index this pass — never a reason to fall back to the
   * legacy file, which the migration to profiles left frozen behind.
   */
  async #dataFilePaths(): Promise<readonly string[]> {
    const indexFilePath = orcaProfileIndexFilePath(this.#dataDirectory);
    const stats = await fileStats(indexFilePath);
    if (!stats?.isFile()) {
      this.#parsedProfileIndex = undefined;
      return [orcaDataFilePath(this.#dataDirectory)];
    }
    if (
      this.#parsedProfileIndex === undefined ||
      this.#parsedProfileIndex.mtimeMs !== stats.mtimeMs ||
      this.#parsedProfileIndex.size !== stats.size
    ) {
      const state = recordFromJsonLine((await readTextFile(indexFilePath)) ?? "");
      this.#parsedProfileIndex = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        value: state ? profileIdsFrom(state) : [],
      };
    }
    return this.#parsedProfileIndex.value.map((profileId) =>
      orcaDataFilePath(orcaProfileDataDirectory(this.#dataDirectory, profileId)),
    );
  }

  async #annotationsIn(dataFilePath: string): Promise<Map<string, WorkspaceAnnotation>> {
    const stats = await fileStats(dataFilePath);
    if (!stats?.isFile()) {
      this.#parsedData.delete(dataFilePath);
      return new Map();
    }
    const cached = this.#parsedData.get(dataFilePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.value;
    }
    // A file mid-replacement or from a build this one cannot read is no
    // index this pass; Orca's next write is a fresh answer.
    const state = recordFromJsonLine((await readTextFile(dataFilePath)) ?? "");
    const parsed: ParsedFile<Map<string, WorkspaceAnnotation>> = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      value: state ? annotationsFrom(state) : new Map(),
    };
    this.#parsedData.set(dataFilePath, parsed);
    return parsed.value;
  }
}
