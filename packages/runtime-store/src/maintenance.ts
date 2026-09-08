import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  type ConversationRecord,
  type SessionKey,
} from "@sidecar/runtime-contracts";

/**
 * The history maintenance policy, ported from OpenClaw's
 * `src/config/sessions/store-maintenance.ts` at commit `b7528507` (MIT;
 * `THIRD_PARTY_NOTICES.md`) onto the conversation directory. The rules are
 * the pinned source's, read for their behavior rather than their numbers:
 *
 * - Ordinary age and count maintenance never touches an archived conversation.
 * - Durable conversations are archived in place; disposable automation state
 *   is removed. The main conversation, a pinned one, one with a run under
 *   way, and any key this build cannot classify are never victims at all.
 * - A private thread idle past its own shorter threshold is archived as
 *   OpenClaw archives an idle dashboard session, judged by its latest
 *   activity signal.
 * - The cap counts only unarchived conversations, archives durable victims,
 *   removes synthetic ones, and orders victims by latest activity ascending
 *   with later insertion winning a tie. Protected rows count toward the cap
 *   and are never changed, so a directory whose protected rows alone exceed
 *   it stays above it.
 * - The disk budget's permanent deletion is positively limited to rows the
 *   cap itself archived, and to none of those that a non-archive protection
 *   still covers.
 *
 * Everything here is pure: it reads records and answers victims, and the
 * worker that owns the database and the disk applies them.
 */

export const MAINTENANCE_MODE = {
  ENFORCE: "enforce",
  WARN: "warn",
} as const;

export type MaintenanceMode = (typeof MAINTENANCE_MODE)[keyof typeof MAINTENANCE_MODE];

const DAY_MS = 24 * 60 * 60 * 1000;
const GIB = 1024 * 1024 * 1024;

export interface HistoryMaintenanceConfig {
  readonly mode: MaintenanceMode;
  /** A conversation untouched this long is archived (durable) or removed (synthetic). */
  readonly staleAfterMs: number;
  /** A private thread idle this long is archived; null disables the rule. */
  readonly idleThreadArchiveAfterMs: number | null;
  readonly maximumUnarchived: number;
  /** The physical budget of the database, its WAL, and the archives; null disables the budget. */
  readonly maximumDiskBytes: number | null;
  /** Where cleanup stops once the budget is crossed. */
  readonly highWaterBytes: number | null;
  /** Whether a stale conversation is reset rather than archived; OpenClaw ships it off. */
  readonly automaticReset: boolean;
  /** How long an extracted archive file is kept by age; null keeps it until disk pressure alone. */
  readonly archiveExpiryMs: number | null;
}

/** Where cleanup stops once the budget is crossed, as a share of the budget, when no high-water mark is named. */
export const DISK_BUDGET_HIGH_WATER_RATIO = 0.8;

export const HISTORY_MAINTENANCE_DEFAULTS: HistoryMaintenanceConfig = {
  mode: MAINTENANCE_MODE.ENFORCE,
  staleAfterMs: 30 * DAY_MS,
  idleThreadArchiveAfterMs: 7 * DAY_MS,
  maximumUnarchived: 5_000,
  maximumDiskBytes: 10 * GIB,
  highWaterBytes: Math.floor(10 * GIB * DISK_BUDGET_HIGH_WATER_RATIO),
  automaticReset: false,
  archiveExpiryMs: null,
};

/** The trigger the pinned source uses so a busy store batches cap runs rather than capping on every write. */
const STRICT_ENTRY_MAINTENANCE_MAX_ENTRIES = 49;
const MIN_BATCHED_ENTRY_MAINTENANCE_SLACK = 25;
const BATCHED_ENTRY_MAINTENANCE_SLACK_RATIO = 0.1;

function entryMaintenanceHighWater(maximumUnarchived: number): number {
  if (!Number.isSafeInteger(maximumUnarchived) || maximumUnarchived <= 0) return 1;
  if (maximumUnarchived <= STRICT_ENTRY_MAINTENANCE_MAX_ENTRIES) return maximumUnarchived + 1;
  const slack = Math.max(
    MIN_BATCHED_ENTRY_MAINTENANCE_SLACK,
    Math.ceil(maximumUnarchived * BATCHED_ENTRY_MAINTENANCE_SLACK_RATIO),
  );
  return maximumUnarchived + slack;
}

export function shouldRunEntryMaintenance(
  unarchivedCount: number,
  maximumUnarchived: number,
  force = false,
): boolean {
  return force || unarchivedCount >= entryMaintenanceHighWater(maximumUnarchived);
}

/** What the policy protects beyond the record itself: conversations with a run under way, and any the host names. */
export interface MaintenanceProtections {
  readonly preserve: ReadonlySet<SessionKey>;
}

export function activityAt(record: ConversationRecord): number {
  return Math.max(record.lastActivityAt, record.createdAt);
}

/** Runtime-owned, disposable state: removed rather than archived, and never protected as a conversation. */
export function isSyntheticConversation(record: ConversationRecord): boolean {
  return record.kind === CONVERSATION_KIND.AUTOMATION;
}

function isProtectedConversation(record: ConversationRecord): boolean {
  if (isSyntheticConversation(record)) return false;
  return record.kind === CONVERSATION_KIND.MAIN || record.kind === CONVERSATION_KIND.UNKNOWN;
}

function preservedUnarchived(
  record: ConversationRecord,
  protections: MaintenanceProtections,
): boolean {
  if (record.pinnedAt !== undefined && !isSyntheticConversation(record)) return true;
  return protections.preserve.has(record.sessionKey) || isProtectedConversation(record);
}

/** Whether ordinary age and count maintenance leaves the record alone. */
export function preservedFromMaintenance(
  record: ConversationRecord,
  protections: MaintenanceProtections,
): boolean {
  return record.archivedAt !== undefined || preservedUnarchived(record, protections);
}

/** Whether the disk budget may delete the record permanently: only the cap's own archives, and none still protected. */
export function evictableForDiskBudget(
  record: ConversationRecord,
  protections: MaintenanceProtections,
): boolean {
  return (
    record.archivedAt !== undefined &&
    record.archiveReason === ARCHIVE_REASON.ACTIVE_SESSION_CAP &&
    !preservedUnarchived(record, protections)
  );
}

export interface MaintenanceVictims {
  /** Durable conversations to archive, with the reason. */
  archive: readonly ConversationRecord[];
  /** Synthetic conversations to remove outright. */
  remove: readonly ConversationRecord[];
}

/** Conversations untouched for longer than the stale threshold. */
export function staleVictims(
  records: readonly ConversationRecord[],
  now: number,
  staleAfterMs: number,
  protections: MaintenanceProtections,
): MaintenanceVictims {
  if (staleAfterMs <= 0) return { archive: [], remove: [] };
  const cutoff = now - staleAfterMs;
  const archive: ConversationRecord[] = [];
  const remove: ConversationRecord[] = [];
  for (const record of records) {
    if (preservedFromMaintenance(record, protections)) continue;
    if (activityAt(record) >= cutoff) continue;
    if (isSyntheticConversation(record)) remove.push(record);
    else archive.push(record);
  }
  return { archive, remove };
}

/** Private threads idle past their own threshold, the port of OpenClaw's idle-dashboard archive. */
export function idleThreadVictims(
  records: readonly ConversationRecord[],
  now: number,
  idleAfterMs: number | null,
  protections: MaintenanceProtections,
): readonly ConversationRecord[] {
  if (idleAfterMs === null || idleAfterMs <= 0) return [];
  const cutoff = now - idleAfterMs;
  return records.filter(
    (record) =>
      record.kind === CONVERSATION_KIND.THREAD &&
      !preservedFromMaintenance(record, protections) &&
      activityAt(record) > 0 &&
      activityAt(record) < cutoff,
  );
}

/**
 * The cap's victims: as many eligible unarchived conversations as stand past
 * the cap, the longest untouched first, later-inserted winning a tie. The
 * reverse before the stable sort is what gives the later insertion the win.
 */
export function capVictims(
  records: readonly ConversationRecord[],
  maximumUnarchived: number,
  protections: MaintenanceProtections,
): MaintenanceVictims {
  const unarchived = records.filter((record) => record.archivedAt === undefined);
  const overflow = unarchived.length - Math.max(0, maximumUnarchived);
  if (overflow <= 0) return { archive: [], remove: [] };
  const eligible = unarchived.filter((record) => !preservedFromMaintenance(record, protections));
  const victims = eligible
    .toReversed()
    .toSorted((left, right) => activityAt(left) - activityAt(right))
    .slice(0, Math.min(overflow, eligible.length));
  return {
    archive: victims.filter((record) => !isSyntheticConversation(record)),
    remove: victims.filter(isSyntheticConversation),
  };
}

/** The disk budget's last resort, oldest archived first, keys breaking ties. */
export function diskBudgetVictims(
  records: readonly ConversationRecord[],
  protections: MaintenanceProtections,
): readonly ConversationRecord[] {
  return records
    .filter((record) => evictableForDiskBudget(record, protections))
    .toSorted(
      (left, right) =>
        (left.archivedAt ?? Number.POSITIVE_INFINITY) -
          (right.archivedAt ?? Number.POSITIVE_INFINITY) ||
        left.sessionKey.localeCompare(right.sessionKey),
    );
}

export function countUnarchived(records: readonly ConversationRecord[]): number {
  return records.filter((record) => record.archivedAt === undefined).length;
}
