/**
 * tables.ts -- every table Luke Sync captures, as one list the drift check and the migration writer read.
 *
 * A table is synced by declaring it here (`defineSyncTable`) and writing
 * its capture into a migration (`pnpm --filter @luke/database sync:render`);
 * the drift check (`__tests__/capture.test.ts`) then fails until the migrated
 * database carries exactly what these declarations render. None is synced
 * yet: each view's own change declares the tables it reads.
 */
import type { SyncTable } from "./sync-table.js";

export const SYNC_TABLES: readonly SyncTable[] = [];
