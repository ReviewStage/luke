import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  brainGenerationExpired,
  brainStateFromStored,
  retainedBrainState,
} from "@sidecar/brain";
import {
  MIGRATION_OUTCOME,
  type MigrationOutcome,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import type { RuntimeDatabase } from "./database.js";
import { rememberedFactsFromStored } from "./facts.js";
import { legacyConversationEntries } from "./history.js";

/**
 * The one-time import of what an earlier build kept in JSON files, into the
 * database that owns it from now on. Each source is read once, hashed, and
 * consumed under the same readers and the same expiry and Clear rules the
 * old writer applied at load — an expired generation imports nothing, a line
 * at or before the last Clear imports nothing, a file this build cannot read
 * imports nothing and says so — and the receipt for each is written in the
 * same transaction as what it imported, so a retry finds the receipt and
 * imports nothing twice.
 *
 * Once the receipts are durable, all three files — the brain's, the
 * conversation's, and the remembered facts' — are moved into a recovery
 * directory under the agent's own root, so no older writer can keep updating
 * them where a launch would read them; the database is the one writer of
 * each from then on. Recovery copies live exactly one generation lifetime
 * from their retirement and go with the next Clear, because they hold the
 * words the same rules bound; nothing ever reads them back.
 */

export interface LegacySources {
  brainState: string;
  conversation: string;
  personalFacts: string;
}

export interface LegacySourceImport {
  outcome: MigrationOutcome;
  /** Whether the receipt already stood, so nothing was read into the database this time. */
  alreadyImported: boolean;
  /** For an unreadable source, what the read said; nothing was written and the file stands. */
  error?: string;
}

export interface LegacyImportReport {
  brainState?: LegacySourceImport;
  conversation?: LegacySourceImport;
  personalFacts?: LegacySourceImport;
  /** The files moved into the recovery directory this time. */
  retired: readonly string[];
  /** Recovery copies past their lifetime and removed this time. */
  expiredRecoveries: readonly string[];
  /** What could not be done, in words for the log; the database is correct regardless. */
  failures: readonly string[];
}

export interface LegacyImportOptions {
  database: RuntimeDatabase;
  sessionKey: SessionKey;
  sources: LegacySources;
  recoveryDirectory: string;
  now: number;
  /** How a source's bytes are read; the file system's own read unless a test injects a failing one. */
  readFile?: (location: string) => Buffer;
}

export const RECOVERY_DIRECTORY_NAME = "recovery";
const RECOVERY_BATCH_PREFIX = "legacy-";

/**
 * What a source path holds: nothing at all, bytes this build can hash, or a
 * file that is there but would not be read. The last is kept apart from the
 * first on purpose — a permission failure is not an empty migration — and
 * leaves no receipt, so the next launch tries again.
 */
type ReadSource =
  | { kind: "missing" }
  | { kind: "read"; contents: string; sha256: string }
  | { kind: "unreadable"; error: string };

function readSource(location: string, readFile: (location: string) => Buffer): ReadSource {
  let bytes: Buffer;
  try {
    bytes = readFile(location);
  } catch (error) {
    if (!(error instanceof Error)) return { kind: "unreadable", error: String(error) };
    if (isMissingFile(error)) return { kind: "missing" };
    return { kind: "unreadable", error: error.message };
  }
  return {
    kind: "read",
    contents: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function isMissingFile(error: Error): boolean {
  // SAFETY: a failed file read reports an errno-like error whose code names the failure.
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function unreadable(read: ReadSource & { kind: "unreadable" }): LegacySourceImport {
  return { outcome: MIGRATION_OUTCOME.UNREADABLE, alreadyImported: false, error: read.error };
}

export function importLegacyState(options: LegacyImportOptions): LegacyImportReport {
  const { database, sessionKey, sources, now } = options;
  const failures: string[] = [];
  const report: LegacyImportReport = { retired: [], expiredRecoveries: [], failures };
  const readFile = options.readFile ?? ((location: string) => fs.readFileSync(location));
  const brain = readSource(sources.brainState, readFile);
  const conversation = readSource(sources.conversation, readFile);
  const facts = readSource(sources.personalFacts, readFile);
  const brainReceipt = database.migrationReceipt(sources.brainState);
  const conversationReceipt = database.migrationReceipt(sources.conversation);
  const factsReceipt = database.migrationReceipt(sources.personalFacts);

  // The brain file's Clear marker bounds the conversation import whatever
  // else is true of the generation, exactly as the old launch read it.
  const brainState = brain.kind === "read" ? brainStateFromStored(brain.contents) : undefined;
  const clearedAt = brainState?.reset?.clearedAt;
  for (const [source, read] of [
    [sources.brainState, brain],
    [sources.conversation, conversation],
    [sources.personalFacts, facts],
  ] as const) {
    if (read.kind === "unreadable") failures.push(`${source} could not be read: ${read.error}`);
  }
  if (brain.kind === "unreadable") report.brainState = unreadable(brain);
  if (conversation.kind === "unreadable") report.conversation = unreadable(conversation);
  if (facts.kind === "unreadable") report.personalFacts = unreadable(facts);
  // The thread can only be imported once the marker that bounds it has been
  // read: a brain file that is there but would not be read may hold a Clear
  // whose cutoff this thread's lines fall under, so the thread waits with it.
  const conversationDeferred =
    brain.kind === "unreadable" && conversation.kind === "read" && !conversationReceipt;
  if (conversationDeferred) {
    report.conversation = { outcome: MIGRATION_OUTCOME.DEFERRED, alreadyImported: false };
  }

  database.transaction(() => {
    if (brain.kind === "read" && !brainReceipt) {
      let outcome: MigrationOutcome;
      if (!brainState) {
        outcome = MIGRATION_OUTCOME.REFUSED;
      } else if (brainGenerationExpired(brainState, now)) {
        outcome = MIGRATION_OUTCOME.EMPTY;
      } else {
        const retained = retainedBrainState(brainState);
        if (retained.oversized) {
          outcome = MIGRATION_OUTCOME.REFUSED;
        } else if (database.loadBrainState(sessionKey).state) {
          // A generation already stands in the database: the file is the
          // older writer's, and it does not replace what the newer one kept.
          outcome = MIGRATION_OUTCOME.EMPTY;
        } else {
          database.saveBrainState(sessionKey, {
            expectGeneration: undefined,
            full: retained.state,
          });
          outcome = MIGRATION_OUTCOME.IMPORTED;
        }
      }
      database.recordMigrationReceipt({
        source: sources.brainState,
        sha256: brain.sha256,
        importedAt: now,
        outcome,
      });
      report.brainState = { outcome, alreadyImported: false };
    } else if (brainReceipt) {
      report.brainState = { outcome: brainReceipt.outcome, alreadyImported: true };
    }

    if (conversation.kind === "read" && !conversationReceipt && !conversationDeferred) {
      const entries = legacyConversationEntries(conversation.contents, clearedAt);
      const appended = database.appendHistory(sessionKey, entries, now);
      const outcome = appended.changed ? MIGRATION_OUTCOME.IMPORTED : MIGRATION_OUTCOME.EMPTY;
      database.recordMigrationReceipt({
        source: sources.conversation,
        sha256: conversation.sha256,
        importedAt: now,
        outcome,
      });
      report.conversation = { outcome, alreadyImported: false };
    } else if (conversationReceipt) {
      report.conversation = { outcome: conversationReceipt.outcome, alreadyImported: true };
    }

    if (facts.kind === "read" && !factsReceipt) {
      const imported = database.importPersonalFacts(rememberedFactsFromStored(facts.contents));
      const outcome = imported > 0 ? MIGRATION_OUTCOME.IMPORTED : MIGRATION_OUTCOME.EMPTY;
      database.recordMigrationReceipt({
        source: sources.personalFacts,
        sha256: facts.sha256,
        importedAt: now,
        outcome,
      });
      report.personalFacts = { outcome, alreadyImported: false };
    } else if (factsReceipt) {
      report.personalFacts = { outcome: factsReceipt.outcome, alreadyImported: true };
    }
  });

  // Receipts are durable: the old writers' files leave the paths a launch
  // reads. Whatever is at the path goes — the file, and a temporary write
  // beside it — because an older writer mid-write is the very thing the move
  // is for. A file that would not be read stays, for the next launch to try.
  const readable: readonly (readonly [string, ReadSource])[] = [
    [sources.brainState, brain],
    [sources.conversation, conversation],
    [sources.personalFacts, facts],
  ];
  const retiring = readable
    .filter(([, read]) => read.kind !== "unreadable")
    .filter(([location]) => !(conversationDeferred && location === sources.conversation))
    .map(([location]) => location)
    .filter((location) => fs.existsSync(location) || fs.existsSync(`${location}.tmp`));
  if (retiring.length > 0) {
    const batch = path.join(options.recoveryDirectory, `${RECOVERY_BATCH_PREFIX}${now}`);
    try {
      fs.mkdirSync(batch, { recursive: true, mode: 0o700 });
      const retired: string[] = [];
      for (const location of retiring) {
        for (const candidate of [location, `${location}.tmp`]) {
          if (!fs.existsSync(candidate)) continue;
          fs.renameSync(candidate, path.join(batch, path.basename(candidate)));
          retired.push(candidate);
        }
      }
      report.retired = retired;
    } catch (error) {
      failures.push(
        `legacy files could not be moved to recovery: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  report.expiredRecoveries = pruneRecovery(options.recoveryDirectory, now, failures);
  return report;
}

/** Removes recovery batches retired a generation lifetime ago or more; they were never read and are now overdue. */
export function pruneRecovery(
  recoveryDirectory: string,
  now: number,
  failures: string[],
): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(recoveryDirectory);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(RECOVERY_BATCH_PREFIX)) continue;
    const retiredAt = Number(name.slice(RECOVERY_BATCH_PREFIX.length));
    const overdue = !Number.isFinite(retiredAt) || now - retiredAt >= BRAIN_GENERATION_LIFETIME_MS;
    if (!overdue) continue;
    try {
      fs.rmSync(path.join(recoveryDirectory, name), { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      failures.push(
        `recovery copy ${name} could not be removed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return removed;
}

/** The Clear's reach into the recovery copies: every batch goes, and the directory with it. */
export function eraseRecovery(recoveryDirectory: string): boolean {
  try {
    fs.rmSync(recoveryDirectory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
