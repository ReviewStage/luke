import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVE_REASON,
  type ArchiveReason,
  type ConversationRecord,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  ARCHIVE_STAGING_STALE_MS,
  archiveDirectory,
  deleteConversation,
  isArchiveStagingName,
  listArchives,
  publishPendingArchives,
  removeArchive,
} from "./archives.js";
import { archiveConversation, listConversations } from "./conversations-table.js";
import { AGENT_DATABASE_FILE, type StoreDatabase } from "./database.js";
import {
  CONVERSATION_MAINTENANCE_DEFAULTS,
  type ConversationMaintenanceConfig,
  capVictims,
  countUnarchived,
  DISK_BUDGET_HIGH_WATER_RATIO,
  diskBudgetVictims,
  idleThreadVictims,
  type MaintenanceProtections,
  shouldRunEntryMaintenance,
  staleVictims,
} from "./maintenance.js";

/**
 * One maintenance pass over the agent's history, in the order the pinned
 * source runs its named boundaries: interrupted publications retried first,
 * then idle threads archived, then stale conversations archived, then the
 * cap, then the disk budget. Each boundary commits on its own, so a failure
 * in a later one leaves the earlier ones standing.
 */

export interface MaintenanceRunOptions {
  now: number;
  /** Conversations with a run under way, and any the host wants kept whatever their age. */
  preserve: readonly SessionKey[];
  /** Overrides for a test; the app runs the pinned defaults. */
  config?: Partial<ConversationMaintenanceConfig>;
  /** Runs the cap without waiting for the batched trigger, as a forced cleanup does. */
  force?: boolean;
  createArchiveId?: () => string;
}

export interface DiskBudgetReport {
  before: number;
  after: number;
  maximumBytes: number;
  highWaterBytes: number;
  overBudget: boolean;
  removedArchives: number;
  deletedConversations: number;
  /** Bytes still above the high-water mark once everything eligible went; zero when the target was reached. */
  remainingPressureBytes: number;
}

export interface MaintenanceReport {
  before: number;
  after: number;
  unarchivedBefore: number;
  unarchivedAfter: number;
  archivedIdleThreads: number;
  archivedStale: number;
  archivedByCap: number;
  /** Archives whose publication a crash interrupted and this pass could still not publish. */
  unpublishedArchives: readonly string[];
  disk: DiskBudgetReport | null;
  usage: PhysicalUsage;
}

function resolvedConfig(
  config: Partial<ConversationMaintenanceConfig> | undefined,
): ConversationMaintenanceConfig {
  const merged = { ...CONVERSATION_MAINTENANCE_DEFAULTS, ...config };
  if (merged.maximumDiskBytes !== null && merged.maximumDiskBytes <= 0) {
    merged.maximumDiskBytes = null;
    merged.highWaterBytes = null;
  }
  if (merged.maximumDiskBytes !== null) {
    const fallback = Math.max(
      1,
      Math.floor(merged.maximumDiskBytes * DISK_BUDGET_HIGH_WATER_RATIO),
    );
    merged.highWaterBytes =
      merged.highWaterBytes === null || merged.highWaterBytes <= 0
        ? fallback
        : Math.min(merged.highWaterBytes, merged.maximumDiskBytes);
  }
  return merged;
}

export function runConversationMaintenance(
  database: StoreDatabase,
  agentRoot: string,
  options: MaintenanceRunOptions,
): MaintenanceReport {
  const config = resolvedConfig(options.config);
  const protections: MaintenanceProtections = { preserve: new Set(options.preserve) };
  const now = options.now;
  const unpublishedArchives = publishPendingArchives(database, agentRoot);
  let records = listConversations(database);
  const before = records.length;
  const unarchivedBefore = countUnarchived(records);

  const archiveAll = (victims: readonly ConversationRecord[], reason: ArchiveReason) =>
    database.transaction(() => {
      let archived = 0;
      for (const victim of victims) {
        if (archiveConversation(database, victim.sessionKey, now, reason)) archived += 1;
      }
      return archived;
    });

  const archivedIdleThreads = archiveAll(
    idleThreadVictims(records, now, config.idleThreadArchiveAfterMs, protections),
    ARCHIVE_REASON.IDLE_THREAD,
  );
  records = listConversations(database);
  const archivedStale = archiveAll(
    staleVictims(records, now, config.staleAfterMs, protections),
    ARCHIVE_REASON.AGE_RETENTION,
  );
  records = listConversations(database);
  let archivedByCap = 0;
  if (
    shouldRunEntryMaintenance(countUnarchived(records), config.maximumUnarchived, options.force)
  ) {
    archivedByCap = archiveAll(
      capVictims(records, config.maximumUnarchived, protections),
      ARCHIVE_REASON.ACTIVE_SESSION_CAP,
    );
    records = listConversations(database);
  }

  let disk: DiskBudgetReport | null = null;
  if (config.maximumDiskBytes !== null && config.highWaterBytes !== null) {
    disk = enforceDiskBudget(database, agentRoot, {
      now,
      protections,
      maximumBytes: config.maximumDiskBytes,
      highWaterBytes: config.highWaterBytes,
      ...(options.createArchiveId ? { createArchiveId: options.createArchiveId } : undefined),
    });
    records = listConversations(database);
  }
  return {
    before,
    after: records.length,
    unarchivedBefore,
    unarchivedAfter: countUnarchived(records),
    archivedIdleThreads,
    archivedStale,
    archivedByCap,
    unpublishedArchives,
    disk,
    usage: measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE),
  };
}

interface DiskBudgetOptions {
  now: number;
  protections: MaintenanceProtections;
  maximumBytes: number;
  highWaterBytes: number;
  createArchiveId?: () => string;
}

/**
 * The disk budget, in the pinned order: nothing while under the budget;
 * once over it, stale staging first, then the oldest archive files, then
 * the cap's own archived conversations oldest first, each deleted through
 * the recoverable archive and committed before the next, remeasuring after
 * every step and stopping at the high-water mark. Protected data is never a
 * victim, and pressure it leaves is reported rather than resolved.
 */
export function enforceDiskBudget(
  database: StoreDatabase,
  agentRoot: string,
  options: DiskBudgetOptions,
): DiskBudgetReport {
  const before = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
  let usage = before;
  let removedArchives = 0;
  let deletedConversations = 0;
  const report = (): DiskBudgetReport => ({
    before: before.totalBytes,
    after: usage.totalBytes,
    maximumBytes: options.maximumBytes,
    highWaterBytes: options.highWaterBytes,
    overBudget: before.totalBytes > options.maximumBytes,
    removedArchives,
    deletedConversations,
    remainingPressureBytes:
      before.totalBytes > options.maximumBytes
        ? Math.max(0, usage.totalBytes - options.highWaterBytes)
        : 0,
  });
  if (before.totalBytes <= options.maximumBytes) return report();
  removeStaleStaging(agentRoot, options.now);
  usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);

  const registered = new Map(listArchives(database).map((archive) => [archive.fileName, archive]));
  const files = listArchiveFiles(agentRoot).toSorted((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of files) {
    if (usage.totalBytes <= options.highWaterBytes) break;
    const archive = registered.get(file.name);
    const removed = archive
      ? removeArchive(database, agentRoot, archive.archiveId)
      : removeFile(file.path);
    if (!removed) continue;
    removedArchives += 1;
    usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
  }

  if (usage.totalBytes > options.highWaterBytes) {
    const victims = diskBudgetVictims(listConversations(database), options.protections);
    for (const victim of victims) {
      if (usage.totalBytes <= options.highWaterBytes) break;
      const deleted = deleteConversation(database, agentRoot, victim.sessionKey, options.now, {
        ...(options.createArchiveId ? { archiveId: options.createArchiveId() } : undefined),
        removeConversation: true,
      });
      if (!deleted) continue;
      deletedConversations += 1;
      database.reclaimFreedPages();
      usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
    }
  }
  return report();
}

function removeFile(filePath: string): boolean {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export interface PhysicalUsage {
  databaseBytes: number;
  walBytes: number;
  archiveBytes: number;
  totalBytes: number;
}

function sizeOf(file: string): number {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/**
 * What the agent's history weighs on disk: the database's main file, its
 * WAL, and every published archive. Staging files still being written are
 * left out, as OpenClaw leaves its rollback staging out, so an archive
 * half-published cannot evict a live conversation; a sweep removes stale
 * staging on its own terms.
 */
export function measurePhysicalUsage(agentRoot: string, databaseFile: string): PhysicalUsage {
  const databasePath = path.join(agentRoot, databaseFile);
  const databaseBytes = sizeOf(databasePath);
  const walBytes = sizeOf(`${databasePath}-wal`);
  let archiveBytes = 0;
  for (const file of listArchiveFiles(agentRoot)) archiveBytes += file.size;
  return {
    databaseBytes,
    walBytes,
    archiveBytes,
    totalBytes: databaseBytes + walBytes + archiveBytes,
  };
}

interface ArchiveEntry {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  staging: boolean;
}

/** Every regular file in the archive directory, published archives and staging alike; nothing for a directory not yet made. */
function archiveEntries(agentRoot: string): ArchiveEntry[] {
  const directory = archiveDirectory(agentRoot);
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const entries: ArchiveEntry[] = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      entries.push({
        name,
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        staging: isArchiveStagingName(name),
      });
    } catch {
      // Removed between the listing and the stat: not on disk, not counted.
    }
  }
  return entries;
}

export function listArchiveFiles(agentRoot: string): ArchiveEntry[] {
  return archiveEntries(agentRoot).filter((entry) => !entry.staging);
}

/** Removes staging files older than the stale window; a fresh one may be another publication in flight. */
export function removeStaleStaging(agentRoot: string, now: number): number {
  let removed = 0;
  for (const entry of archiveEntries(agentRoot)) {
    if (!entry.staging || now - entry.mtimeMs <= ARCHIVE_STAGING_STALE_MS) continue;
    if (removeFile(entry.path)) removed += 1;
  }
  return removed;
}
