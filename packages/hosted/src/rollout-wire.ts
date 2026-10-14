import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { ROLLOUT_BOUNDS } from "./plan-wire.js";

/**
 * rollout-wire.ts -- a report on one pull request of a plan's rollout, as it lands on the plan's conversation.
 *
 * A report is what Luke hears of a rollout he is not watching: the builder
 * at a position of the rollout saying it opened its pull request, that
 * checks went green, that it is blocked or has a question, or the
 * coding-agent host saying how the builder's turn ended; the rollout's one
 * stack keeper, which owns every branch's place in its stack, saying it
 * restacked, merged, or met a conflict it cannot resolve mechanically; and,
 * later, GitHub saying the same of a pull request someone merged by hand. Each opens a report turn on the plan's conversation, whose received
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

type ReportKind = (typeof REPORT_KIND)[keyof typeof REPORT_KIND];

/** The tags a first line names a reporter by, where it is not a builder at a position. */
const REPORTER = {
  KEEPER: "keeper",
  GITHUB: "github",
} as const;

/**
 * Each kind's words on the first line, and how a pull request's number
 * joins them: straight after a verb whose object it is ("opened #415"), or
 * after "on" where the pull request is where it happened ("blocked on #415").
 */
const REPORT_PHRASE = {
  [REPORT_KIND.PR_OPENED]: { words: "opened", joiner: "" },
  [REPORT_KIND.CI_GREEN]: { words: "checks green", joiner: "on " },
  [REPORT_KIND.RESTACKED]: { words: "restacked", joiner: "" },
  [REPORT_KIND.MERGED]: { words: "merged", joiner: "" },
  [REPORT_KIND.CONFLICT]: { words: "conflict", joiner: "on " },
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
 * A report, from the builder at a position of the rollout, from the
 * rollout's stack keeper, which holds no position, or from GitHub about the
 * repository it names. Each is a member of its own rather than one with
 * every key optional, so a report always names who made it.
 */
export const reportSchema = EffectSchema.Union([
  EffectSchema.Struct({ ...REPORT_FIELDS, position: REPORT_POSITION }),
  EffectSchema.Struct({ ...REPORT_FIELDS, keeper: EffectSchema.Literal(true) }),
  EffectSchema.Struct({ ...REPORT_FIELDS, github: githubRepositoryFullNameSchema }),
]);

export type Report = typeof reportSchema.Type;

function reporterOf(report: Report): string {
  if ("position" in report) return `worker ${report.position}`;
  return "keeper" in report ? REPORTER.KEEPER : REPORTER.GITHUB;
}

/** A report's fixed first line: who reported, what happened, and on which pull request, `[worker 3] opened #415` or `[keeper] conflict on #415`. */
export function reportLine(report: Report): string {
  const reporter = reporterOf(report);
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
