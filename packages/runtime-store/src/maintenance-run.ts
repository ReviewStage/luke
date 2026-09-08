import fs from "node:fs";
import {
  ARCHIVE_REASON,
  type ConversationRecord,
  type HistoryArchiveRecord,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import {
  deleteConversationHistory,
  listArchiveFiles,
  listArchives,
  measurePhysicalUsage,
  type PhysicalUsage,
  publishPendingArchives,
  removeArchive,
  removeStaleStaging,
} from "./archives.js";
import {
  archiveConversation,
  listConversations,
  removeConversationRow,
  removeConversationRows,
} from "./conversations-table.js";
import { AGENT_DATABASE_FILE, type RuntimeDatabase } from "./database.js";
import {
  capVictims,
  countUnarchived,
  diskBudgetVictims,
  HISTORY_MAINTENANCE_DEFAULTS,
  type HistoryMaintenanceConfig,
  idleThreadVictims,
  MAINTENANCE_MODE,
  type MaintenanceProtections,
  shouldRunEntryMaintenance,
  staleVictims,
} from "./maintenance.js";

/**
 * One maintenance pass over the agent's history, in the order the pinned
 * source runs its named boundaries: interrupted publications retried first,
 * then idle threads archived, then stale conversations archived or removed,
 * then the cap, then the disk budget. Each boundary commits on its own, so a
 * failure in a later one leaves the earlier ones standing. Warn mode
 * measures and reports and changes nothing.
 */

export interface MaintenanceRunOptions {
  now: number;
  /** Conversations with a run under way, and any the host wants kept whatever their age. */
  preserve: readonly SessionKey[];
  config?: Partial<HistoryMaintenanceConfig>;
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
  mode: HistoryMaintenanceConfig["mode"];
  before: number;
  after: number;
  unarchivedBefore: number;
  unarchivedAfter: number;
  archivedIdleThreads: number;
  archivedStale: number;
  removedStale: number;
  archivedByCap: number;
  removedByCap: number;
  /** Archives whose publication a crash interrupted and this pass could still not publish. */
  unpublishedArchives: readonly string[];
  disk: DiskBudgetReport | null;
  /** The archives this pass produced by deleting cap-archived conversations under disk pressure. */
  archives: readonly HistoryArchiveRecord[];
  usage: PhysicalUsage;
}

function resolvedConfig(
  config: Partial<HistoryMaintenanceConfig> | undefined,
): HistoryMaintenanceConfig {
  const merged = { ...HISTORY_MAINTENANCE_DEFAULTS, ...config };
  if (merged.maximumDiskBytes !== null && merged.maximumDiskBytes <= 0) {
    merged.maximumDiskBytes = null;
    merged.highWaterBytes = null;
  }
  if (merged.maximumDiskBytes !== null) {
    const fallback = Math.max(1, Math.floor(merged.maximumDiskBytes * 0.8));
    merged.highWaterBytes =
      merged.highWaterBytes === null || merged.highWaterBytes <= 0
        ? fallback
        : Math.min(merged.highWaterBytes, merged.maximumDiskBytes);
  }
  return merged;
}

export function runHistoryMaintenance(
  database: RuntimeDatabase,
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
  const report: MaintenanceReport = {
    mode: config.mode,
    before,
    after: before,
    unarchivedBefore,
    unarchivedAfter: unarchivedBefore,
    archivedIdleThreads: 0,
    archivedStale: 0,
    removedStale: 0,
    archivedByCap: 0,
    removedByCap: 0,
    unpublishedArchives,
    disk: null,
    archives: [],
    usage: measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE),
  };
  if (config.mode === MAINTENANCE_MODE.WARN) {
    report.disk = diskReport(config, report.usage, report.usage, 0, 0);
    return report;
  }

  const archiveAll = (
    victims: readonly ConversationRecord[],
    reason: ConversationRecord["archiveReason"],
  ) => {
    if (!reason) return 0;
    return database.transaction(() => {
      let archived = 0;
      for (const victim of victims) {
        if (archiveConversation(database, victim.sessionKey, now, reason)) archived += 1;
      }
      return archived;
    });
  };
  const removeAll = (victims: readonly ConversationRecord[]) =>
    database.transaction(() => {
      for (const victim of victims) {
        removeConversationRows(database, victim.sessionKey);
        removeConversationRow(database, victim.sessionKey);
      }
      return victims.length;
    });

  report.archivedIdleThreads = archiveAll(
    idleThreadVictims(records, now, config.idleThreadArchiveAfterMs, protections),
    ARCHIVE_REASON.IDLE_THREAD,
  );
  records = listConversations(database);
  const stale = staleVictims(records, now, config.staleAfterMs, protections);
  report.archivedStale = archiveAll(stale.archive, ARCHIVE_REASON.AGE_RETENTION);
  report.removedStale = removeAll(stale.remove);
  records = listConversations(database);
  if (
    shouldRunEntryMaintenance(countUnarchived(records), config.maximumUnarchived, options.force)
  ) {
    const cap = capVictims(records, config.maximumUnarchived, protections);
    report.archivedByCap = archiveAll(cap.archive, ARCHIVE_REASON.ACTIVE_SESSION_CAP);
    report.removedByCap = removeAll(cap.remove);
    records = listConversations(database);
  }

  if (config.maximumDiskBytes !== null && config.highWaterBytes !== null) {
    report.disk = enforceDiskBudget(database, agentRoot, {
      now,
      protections,
      maximumBytes: config.maximumDiskBytes,
      highWaterBytes: config.highWaterBytes,
      ...(options.createArchiveId ? { createArchiveId: options.createArchiveId } : undefined),
      onArchived: (archive) => {
        report.archives = [...report.archives, archive];
      },
    });
    records = listConversations(database);
  }
  report.after = records.length;
  report.unarchivedAfter = countUnarchived(records);
  report.usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
  return report;
}

function diskReport(
  config: HistoryMaintenanceConfig,
  before: PhysicalUsage,
  after: PhysicalUsage,
  removedArchives: number,
  deletedConversations: number,
): DiskBudgetReport | null {
  if (config.maximumDiskBytes === null || config.highWaterBytes === null) return null;
  return {
    before: before.totalBytes,
    after: after.totalBytes,
    maximumBytes: config.maximumDiskBytes,
    highWaterBytes: config.highWaterBytes,
    overBudget: before.totalBytes > config.maximumDiskBytes,
    removedArchives,
    deletedConversations,
    remainingPressureBytes:
      before.totalBytes > config.maximumDiskBytes
        ? Math.max(0, after.totalBytes - config.highWaterBytes)
        : 0,
  };
}

interface DiskBudgetOptions {
  now: number;
  protections: MaintenanceProtections;
  maximumBytes: number;
  highWaterBytes: number;
  createArchiveId?: () => string;
  onArchived: (archive: HistoryArchiveRecord) => void;
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
  database: RuntimeDatabase,
  agentRoot: string,
  options: DiskBudgetOptions,
): DiskBudgetReport {
  const before = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
  let usage = before;
  let removedArchives = 0;
  let deletedConversations = 0;
  const finish = (): DiskBudgetReport => ({
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
  if (before.totalBytes <= options.maximumBytes) return finish();
  removeStaleStaging(agentRoot, options.now);
  usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);

  const registered = new Map(listArchives(database).map((archive) => [archive.fileName, archive]));
  const files = listArchiveFiles(agentRoot).toSorted((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of files) {
    if (usage.totalBytes <= options.highWaterBytes) break;
    const archive = registered.get(file.name);
    const removed = archive
      ? removeArchive(database, agentRoot, archive.archiveId)
      : removeUnregisteredFile(file.path);
    if (!removed) continue;
    removedArchives += 1;
    usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
  }

  if (usage.totalBytes > options.highWaterBytes) {
    const victims = diskBudgetVictims(listConversations(database), options.protections);
    for (const victim of victims) {
      if (usage.totalBytes <= options.highWaterBytes) break;
      const deleted = deleteConversationHistory(
        database,
        agentRoot,
        victim.sessionKey,
        options.now,
        options.createArchiveId?.(),
        { removeConversation: true },
      );
      if (!deleted) continue;
      deletedConversations += 1;
      options.onArchived(deleted.archive);
      database.reclaimFreedPages();
      usage = measurePhysicalUsage(agentRoot, AGENT_DATABASE_FILE);
    }
  }
  return finish();
}

function removeUnregisteredFile(filePath: string): boolean {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}
