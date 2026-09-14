/**
 * The storage contracts' fixed value sets in Effect's own terms. `storage.ts`
 * is a faithful port of OpenClaw `b7528507`'s conversation directory shapes
 * and imports nothing from `effect`, so a `Schema.Literals` beside each of
 * the port's `as const` value sets lives here, for the vocabulary door to
 * re-export. The port's own `is*` guards stay exactly as they stand.
 */
import { Schema } from "effect";
import { ARCHIVE_REASON, COMPACTION_SOURCE } from "./storage.js";

export const CompactionSourceSchema = Schema.Literals(Object.values(COMPACTION_SOURCE));

export const ArchiveReasonSchema = Schema.Literals(Object.values(ARCHIVE_REASON));
