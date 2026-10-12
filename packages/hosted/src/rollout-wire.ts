import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { ROLLOUT_BOUNDS } from "./plan-wire.js";

/**
 * rollout-wire.ts -- a report on one pull request of a plan's rollout, as it lands on the plan's conversation.
 *
 * A report is what Luke hears of a rollout he is not watching: a worker at
 * a position of the rollout saying it opened its pull request, that checks
 * went green, that it rebased or merged, that it is blocked or has a
 * question, or the coding-agent host saying how the worker's turn ended;
 * and, later, GitHub saying the same of a pull request someone merged by
 * hand. Each opens a report turn on the plan's conversation, whose received
 * line is `reportText`: the fixed first line `reportLine` draws, so Luke and
 * the transcript read the same words for one report, then the reporter's
 * own words, then the options a question offers.
 */

const REPORT_BOUNDS = {
  /** The most characters a report's own words may spell: a status or a question, not a log. */
  MAX_TEXT_CHARS: 4_000,
  /** The most options a question may offer. */
  MAX_OPTIONS: 6,
  /** The most characters one option may spell. */
  MAX_OPTION_CHARS: 200,
} as const;

/** What a report says happened: a worker's milestones and asks, then the ends the host reports for it. */
export const REPORT_KIND = {
  PR_OPENED: "pr_opened",
  CI_GREEN: "ci_green",
  REBASED: "rebased",
  MERGED: "merged",
  BLOCKED: "blocked",
  QUESTION: "question",
  FINISHED: "finished",
  FAILED: "failed",
  STOPPED: "stopped",
} as const;

type ReportKind = (typeof REPORT_KIND)[keyof typeof REPORT_KIND];

/**
 * The kinds a worker reports itself, through its report tool: its
 * milestones and its asks. How its turn ended is the host's to report, so
 * a worker cannot claim to have finished.
 */
export const WORKER_REPORT_KIND = {
  PR_OPENED: REPORT_KIND.PR_OPENED,
  CI_GREEN: REPORT_KIND.CI_GREEN,
  REBASED: REPORT_KIND.REBASED,
  MERGED: REPORT_KIND.MERGED,
  BLOCKED: REPORT_KIND.BLOCKED,
  QUESTION: REPORT_KIND.QUESTION,
} as const;

/** The tag a GitHub report's first line names its reporter by. */
const GITHUB_REPORTER = "github";

/**
 * Each kind's words on the first line, and how a pull request's number
 * joins them: straight after a verb whose object it is ("opened #415"), or
 * after "on" where the pull request is where it happened ("blocked on #415").
 */
const REPORT_PHRASE = {
  [REPORT_KIND.PR_OPENED]: { words: "opened", joiner: "" },
  [REPORT_KIND.CI_GREEN]: { words: "checks green", joiner: "on " },
  [REPORT_KIND.REBASED]: { words: "rebased", joiner: "" },
  [REPORT_KIND.MERGED]: { words: "merged", joiner: "" },
  [REPORT_KIND.BLOCKED]: { words: "blocked", joiner: "on " },
  [REPORT_KIND.QUESTION]: { words: "asks", joiner: "on " },
  [REPORT_KIND.FINISHED]: { words: "finished", joiner: "on " },
  [REPORT_KIND.FAILED]: { words: "failed", joiner: "on " },
  [REPORT_KIND.STOPPED]: { words: "stopped", joiner: "on " },
} as const satisfies Record<ReportKind, { readonly words: string; readonly joiner: string }>;

/** A position of the rollout, counted from one, as the plan's list numbers it. */
const REPORT_POSITION = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(1),
  EffectSchema.isLessThanOrEqualTo(ROLLOUT_BOUNDS.MAX_PULL_REQUESTS),
);

function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** What every report says, whoever reports it. */
const REPORT_FIELDS = {
  kind: EffectSchema.Literals(Object.values(REPORT_KIND)),
  /** The pull request's number on GitHub, where the report is about one. */
  pullRequest: EffectSchema.optionalKey(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  ),
  text: trimmedText(REPORT_BOUNDS.MAX_TEXT_CHARS),
  /** The answers a question offers, where it offers any. */
  options: EffectSchema.optionalKey(
    EffectSchema.Array(trimmedText(REPORT_BOUNDS.MAX_OPTION_CHARS)).check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(REPORT_BOUNDS.MAX_OPTIONS),
    ),
  ),
};

/**
 * A report, from the worker at a position of the rollout or from GitHub
 * about the repository it names. The two are different members rather than
 * one with both keys optional, so a report always names who made it.
 */
export const reportSchema = EffectSchema.Union([
  EffectSchema.Struct({ ...REPORT_FIELDS, position: REPORT_POSITION }),
  EffectSchema.Struct({ ...REPORT_FIELDS, github: githubRepositoryFullNameSchema }),
]);

export type Report = typeof reportSchema.Type;

/**
 * What a worker hands its report tool: a report with no reporter, since the
 * host names the worker by the position its row holds, and one of the
 * worker's own kinds. The model is shown this schema and eve holds the call
 * to it, so its bounds are the report's own.
 */
export const workerReportInputSchema = EffectSchema.Struct({
  ...REPORT_FIELDS,
  kind: EffectSchema.Literals(Object.values(WORKER_REPORT_KIND)),
});

export type WorkerReportInput = typeof workerReportInputSchema.Type;

/** A report's fixed first line: who reported, what happened, and on which pull request, `[worker 3] opened #415`. */
export function reportLine(report: Report): string {
  const reporter = "position" in report ? `worker ${report.position}` : GITHUB_REPORTER;
  const phrase = REPORT_PHRASE[report.kind];
  const on = report.pullRequest !== undefined ? ` ${phrase.joiner}#${report.pullRequest}` : "";
  return `[${reporter}] ${phrase.words}${on}`;
}

/** The whole of a report as the turn receives it: its first line, the reporter's words, and a question's options one to a line. */
export function reportText(report: Report): string {
  const options = report.options?.map((option) => `- ${option}`) ?? [];
  return [
    reportLine(report),
    "",
    report.text,
    ...(options.length > 0 ? ["", ...options] : []),
  ].join("\n");
}
