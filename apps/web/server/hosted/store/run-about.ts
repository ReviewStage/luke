import { and, eq } from "drizzle-orm";
import {
  BRAIN_TURN_TRIGGER,
  type BrainTurnTrigger,
  isRunOrigin,
  isWireString,
  RUN_END_REASON,
  type RunEndReason,
  type RunOrigin,
  type UnparsedWireValue,
} from "../../core.js";
import { conversationRun } from "../../db/schema.js";
import type { HostedStoreDatabase } from "./database.js";

/**
 * A turn's about-fields on its run row: what woke it, who opened it, how it
 * ended, and what it counted. These are the fields the development trace
 * records on the desktop, kept here on the run instead of in a log, and every
 * one describes the turn without quoting it — the kinds and names are fixed
 * vocabulary, the rest are numbers. They land after the run's record, which
 * the envelope save owns, and a later save of that record leaves them as
 * they are.
 */
export interface RunAboutFields {
  trigger?: BrainTurnTrigger;
  origin?: RunOrigin;
  ending?: RunEndReason;
  inputTokens?: number;
  outputTokens?: number;
  /** The kinds of item the turn appended, by their fixed names. */
  inputItemKinds?: readonly string[];
  transcriptBytes?: number;
  elapsedMs?: number;
  toolNames?: readonly string[];
  compacted?: boolean;
}

const TRIGGER_LIST: readonly BrainTurnTrigger[] = Object.values(BRAIN_TURN_TRIGGER);
const ENDING_LIST: readonly RunEndReason[] = Object.values(RUN_END_REASON);

function isBrainTurnTrigger(value: UnparsedWireValue): value is BrainTurnTrigger {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && TRIGGER_LIST.includes(value as BrainTurnTrigger);
}

function isRunEndReason(value: UnparsedWireValue): value is RunEndReason {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && ENDING_LIST.includes(value as RunEndReason);
}

/** Writes the about-fields onto the run named; answers false for a run the tables do not hold. */
export async function recordRunAbout(
  db: HostedStoreDatabase,
  userId: string,
  runId: string,
  about: RunAboutFields,
): Promise<boolean> {
  const updated = await db
    .update(conversationRun)
    .set({
      ...(about.trigger !== undefined ? { trigger: about.trigger } : undefined),
      ...(about.origin !== undefined ? { runOrigin: about.origin } : undefined),
      ...(about.ending !== undefined ? { ending: about.ending } : undefined),
      ...(about.inputTokens !== undefined ? { inputTokens: about.inputTokens } : undefined),
      ...(about.outputTokens !== undefined ? { outputTokens: about.outputTokens } : undefined),
      ...(about.inputItemKinds !== undefined
        ? { inputItemKinds: [...about.inputItemKinds] }
        : undefined),
      ...(about.transcriptBytes !== undefined
        ? { transcriptBytes: about.transcriptBytes }
        : undefined),
      ...(about.elapsedMs !== undefined ? { elapsedMs: about.elapsedMs } : undefined),
      ...(about.toolNames !== undefined ? { toolNames: [...about.toolNames] } : undefined),
      ...(about.compacted !== undefined ? { compacted: about.compacted } : undefined),
    })
    .where(and(eq(conversationRun.userId, userId), eq(conversationRun.runId, runId)))
    .returning({ runId: conversationRun.runId });
  return updated.length > 0;
}

/** The about-fields as the run row holds them, or nothing for a run the tables do not hold. */
export async function runAbout(
  db: HostedStoreDatabase,
  userId: string,
  runId: string,
): Promise<RunAboutFields | undefined> {
  const [row] = await db
    .select({
      trigger: conversationRun.trigger,
      runOrigin: conversationRun.runOrigin,
      ending: conversationRun.ending,
      inputTokens: conversationRun.inputTokens,
      outputTokens: conversationRun.outputTokens,
      inputItemKinds: conversationRun.inputItemKinds,
      transcriptBytes: conversationRun.transcriptBytes,
      elapsedMs: conversationRun.elapsedMs,
      toolNames: conversationRun.toolNames,
      compacted: conversationRun.compacted,
    })
    .from(conversationRun)
    .where(and(eq(conversationRun.userId, userId), eq(conversationRun.runId, runId)));
  if (!row) return undefined;
  return {
    ...(isBrainTurnTrigger(row.trigger) ? { trigger: row.trigger } : undefined),
    ...(isRunOrigin(row.runOrigin) ? { origin: row.runOrigin } : undefined),
    ...(isRunEndReason(row.ending) ? { ending: row.ending } : undefined),
    ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : undefined),
    ...(row.outputTokens !== null ? { outputTokens: row.outputTokens } : undefined),
    ...(row.inputItemKinds !== null ? { inputItemKinds: row.inputItemKinds } : undefined),
    ...(row.transcriptBytes !== null ? { transcriptBytes: row.transcriptBytes } : undefined),
    ...(row.elapsedMs !== null ? { elapsedMs: row.elapsedMs } : undefined),
    ...(row.toolNames !== null ? { toolNames: row.toolNames } : undefined),
    ...(row.compacted !== null ? { compacted: row.compacted } : undefined),
  };
}
