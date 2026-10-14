import { Schema as EffectSchema } from "effect";

/**
 * report-vocabulary.ts -- the words of a rollout report, below both the report itself and the coding agent that last made one.
 *
 * A report's kind and its own words are read in two places: the report as
 * it lands on the plan's conversation (`rollout-wire.ts`), and the
 * worker's last report kept on its agent's summary
 * (`coding-agent-wire.ts`). The report bounds its position by the plan's
 * rollout (`plan-wire.ts`), which already reads the coding agent's words,
 * so the words the two share sit here, beneath both, rather than in either.
 */

const REPORT_BOUNDS = {
  /** The most characters a report's own words may spell: a status or a question, not a log. */
  MAX_TEXT_CHARS: 4_000,
  /** The most options a question may offer. */
  MAX_OPTIONS: 6,
  /** The most characters one option may spell. */
  MAX_OPTION_CHARS: 200,
} as const;

/** What a report says happened: a builder's milestones and asks, the keeper's restacks, merges, and conflicts, then the ends the host reports for either. */
export const REPORT_KIND = {
  PR_OPENED: "pr_opened",
  CI_GREEN: "ci_green",
  RESTACKED: "restacked",
  MERGED: "merged",
  CONFLICT: "conflict",
  BLOCKED: "blocked",
  QUESTION: "question",
  FINISHED: "finished",
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

export type ReportKind = (typeof REPORT_KIND)[keyof typeof REPORT_KIND];

/**
 * The kinds a builder reports itself, through its report tool: its pull
 * request's milestones and its asks. It never restacks, retargets, or
 * merges, so none of those is its to report.
 */
export const BUILDER_REPORT_KIND = {
  PR_OPENED: REPORT_KIND.PR_OPENED,
  CI_GREEN: REPORT_KIND.CI_GREEN,
  BLOCKED: REPORT_KIND.BLOCKED,
  QUESTION: REPORT_KIND.QUESTION,
} as const;

/** The kinds the stack keeper reports itself: a restack done, a conflict that is a judgment's, a merge, and its asks. */
export const KEEPER_REPORT_KIND = {
  RESTACKED: REPORT_KIND.RESTACKED,
  CONFLICT: REPORT_KIND.CONFLICT,
  MERGED: REPORT_KIND.MERGED,
  BLOCKED: REPORT_KIND.BLOCKED,
  QUESTION: REPORT_KIND.QUESTION,
} as const;

/**
 * The kinds a rollout's agent reports through its report tool, a builder's
 * and the keeper's together, since the two share one tool; the host holds
 * each to its own role's. How a turn ended is the host's to report, so no
 * agent can claim to have finished.
 */
export const WORKER_REPORT_KIND = { ...BUILDER_REPORT_KIND, ...KEEPER_REPORT_KIND } as const;

function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A report's own words: a status or a question, not a log. */
export const reportTextSchema = trimmedText(REPORT_BOUNDS.MAX_TEXT_CHARS);

/** The answers a question offers. */
export const reportOptionsSchema = EffectSchema.Array(
  trimmedText(REPORT_BOUNDS.MAX_OPTION_CHARS),
).check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(REPORT_BOUNDS.MAX_OPTIONS));
