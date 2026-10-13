import type { TurnEnding } from "@sidecar/database/models/message-reads";
import {
  CODING_AGENT_FAILURE,
  CODING_AGENT_REPORT_TOOL,
  type CodingAgentLastReport,
  ROLLOUT_ROLE,
  type RolloutRole,
} from "@sidecar/hosted/coding-agent-wire";
import {
  BUILDER_REPORT_KIND,
  KEEPER_REPORT_KIND,
  REPORT_KIND,
  type Report,
  reportLine,
  WORKER_REPORT_KIND,
  type WorkerReportInput,
  workerReportInputSchema,
} from "@sidecar/hosted/rollout-wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import type { MessageStreamEvent } from "eve/client";
import {
  ACTION_RESULT_STATUS,
  EXCESS_KEYS,
  TURN_STATUS,
  type UnparsedWireValue,
} from "../../core.js";
import { codingAgentFailureOf } from "./status.js";

/**
 * report.ts -- a rollout agent's `report` tool: a builder's milestones and asks, or the stack keeper's restacks, merges, and conflicts, handed to Luke on the plan's conversation.
 *
 * A rollout runs one builder per pull request and one stack keeper, and
 * Luke hears of each only through what it reports. A builder reports the
 * moment its pull request opens, when its checks go green, and when it is
 * blocked or has a question only the plan's owner can settle; it never
 * restacks, retargets, or merges, so it reports none of those. The keeper,
 * which owns every branch's place in its stack, reports a restack done, a
 * conflict that is a judgment rather than a mechanical one, a merge, and
 * its own asks. Each report lands as a report turn on the plan's
 * conversation (`brain-host/report.ts`), keyed by the call's id, so a call
 * eve replays is one report. The reporter is named by its row, never by
 * what it says: a builder by its position, the keeper by its role; a kind
 * that is the other role's is refused, and an agent started outside a
 * rollout is refused, since no rollout waits on it. Note that a question
 * or a block answers by telling the agent to end its turn, because a
 * coding agent's turn is its whole run and Luke's answer can only reach it
 * as its next message; any other report tells it to carry on, the keeper
 * after a conflict included, since its other stacks still want it. Beside
 * the tool, the host reports how each builder's and keeper's turn ended,
 * finished, failed with its failure word, or stopped, so Luke hears of one that
 * died without reporting. The agent's own last report is kept on its row
 * as well, standing until its next turn starts, so a standing question or block
 * reads without Luke's transcript; the host's ends are not, so a question
 * the turn ended on still stands.
 */

/** The words the tool is shown, for both roles, since each reads them every step. */
const DESCRIPTION =
  "Report to Luke, who runs the plan's rollout. If you are a builder, started at a position of " +
  "the rollout to write its one pull request: report `pr_opened` with its number the moment the " +
  "pull request is open and `ci_green` with its number when its checks pass; never report a restack or a merge, " +
  "which are the stack keeper's. If you are the stack keeper: report `restacked` once a restack " +
  "is pushed, naming the pull requests it moved, `merged` with the number once you merge one, " +
  "and `conflict` with the pull request's number when a restack meets a conflict that is a " +
  "judgment rather than mechanical, after aborting that restack. Either role reports " +
  "`question` when the brief and the code disagree, when the acceptance cannot be met, or when " +
  "a choice would change an interface another pull request of the rollout depends on, offering " +
  "the answers you see as options, and `blocked` when it cannot go on without something only " +
  "Luke or the developer can give. Decide small things yourself and record them with " +
  "`edit_plan` instead of asking. Keep the text to what Luke needs to act on: a status or a " +
  "question, not a log. After a question or a block, end your turn: Luke's answer arrives as " +
  "your next message.";

/** The tool as a rollout's agent is offered it: its name, its words, and the report's own input schema. */
export const REPORT_TOOL = {
  name: CODING_AGENT_REPORT_TOOL,
  description: DESCRIPTION,
  inputSchema: workerReportInputSchema,
} as const;

/** Why a call reported nothing, in the words the model reads. */
export const REPORT_REFUSAL = {
  UNREADABLE: "Not reported: the report does not read under the tool's schema.",
  NO_ROLLOUT:
    "Not reported: you were not started for a plan's rollout, as a builder or its stack keeper, so no one is waiting on a report. Say it in your message instead.",
  NOT_A_BUILDERS:
    "Not reported: a builder reports `pr_opened`, `ci_green`, `question`, or `blocked`; restacks, conflicts, and merges are the stack keeper's.",
  NOT_THE_KEEPERS:
    "Not reported: the stack keeper reports `restacked`, `conflict`, `merged`, `question`, or `blocked`; a pull request's opening and its checks are its builder's.",
  NO_NUMBER:
    "Not reported: `pr_opened`, `ci_green`, `merged`, and `conflict` are about one pull request, so name its number in `pullRequest` and report again.",
  UNAVAILABLE:
    "Not reported: the service could not hand the report to Luke. Carry on, and say it in your message.",
} as const;

/** What the agent is told to do once a report is taken, by whether the report waits on an answer. */
const REPORT_NEXT = {
  WAIT: "End your turn now, saying in one line that you are waiting on Luke. His answer arrives as your next message.",
  CARRY_ON: "Carry on.",
} as const;

/** The kinds that wait on Luke's answer, so the turn ends on them. */
const AWAITING_ANSWER: ReadonlySet<Report["kind"]> = new Set([
  WORKER_REPORT_KIND.QUESTION,
  WORKER_REPORT_KIND.BLOCKED,
]);

const BUILDER_KINDS: ReadonlySet<Report["kind"]> = new Set(Object.values(BUILDER_REPORT_KIND));
const KEEPER_KINDS: ReadonlySet<Report["kind"]> = new Set(Object.values(KEEPER_REPORT_KIND));

/** The kinds about one pull request, which a report names by its number so Luke knows which. */
const NUMBERED_KINDS: ReadonlySet<Report["kind"]> = new Set([
  WORKER_REPORT_KIND.PR_OPENED,
  WORKER_REPORT_KIND.CI_GREEN,
  WORKER_REPORT_KIND.MERGED,
  WORKER_REPORT_KIND.CONFLICT,
]);

/** Who in the rollout a row stands for: the builder at its position, or the keeper. */
export type RolloutReporter = { readonly position: number } | { readonly keeper: true };

/** What a call answers, as the model and the authored file read it: the line Luke reads and what to do next, or why nothing was reported. */
export type ReportToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly reported: string;
      readonly next: string;
    }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

export function reportRejected(reason: string): ReportToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

const readReport = readEither(workerReportInputSchema, { excess: EXCESS_KEYS.DROP });

/** A call's input read as a rollout agent's report, or the refusal for one that does not read. */
export function workerReport(input: UnparsedWireValue): Result.Result<WorkerReportInput, string> {
  return Result.mapError(readReport(input), () => REPORT_REFUSAL.UNREADABLE);
}

/** Who a row stands for in its plan's rollout: the keeper by its role, a builder by its position; nothing for an agent started outside one. */
export function rolloutReporterOf(
  role: RolloutRole | null,
  position: number | null,
): RolloutReporter | undefined {
  if (role === ROLLOUT_ROLE.KEEPER) return { keeper: true };
  return position === null ? undefined : { position };
}

/**
 * The report Luke hears from the reporter given, its own words named by its
 * row, or the refusal for a kind that is the other role's or one about a
 * pull request that names no number.
 */
export function reportBy(
  reporter: RolloutReporter,
  input: WorkerReportInput,
): Result.Result<Report, string> {
  const keeper = "keeper" in reporter;
  if (!(keeper ? KEEPER_KINDS : BUILDER_KINDS).has(input.kind)) {
    return Result.fail(keeper ? REPORT_REFUSAL.NOT_THE_KEEPERS : REPORT_REFUSAL.NOT_A_BUILDERS);
  }
  if (NUMBERED_KINDS.has(input.kind) && input.pullRequest === undefined) {
    return Result.fail(REPORT_REFUSAL.NO_NUMBER);
  }
  return Result.succeed(
    "keeper" in reporter ? { ...input, keeper: true } : { ...input, position: reporter.position },
  );
}

/** The agent's own report as its summary carries it while it stands, the pull request it names among it, stamped with the epoch milliseconds Luke took it. */
export function lastReportOf(input: WorkerReportInput, at: number): CodingAgentLastReport {
  return {
    kind: input.kind,
    ...(input.pullRequest === undefined ? undefined : { pullRequest: input.pullRequest }),
    text: input.text,
    ...(input.options === undefined ? undefined : { options: input.options }),
    at,
  };
}

/** The answer to a report taken: the line Luke reads, and whether to end the turn for his answer. */
export function reportTaken(report: Report): ReportToolResult {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    reported: reportLine(report),
    next: AWAITING_ANSWER.has(report.kind) ? REPORT_NEXT.WAIT : REPORT_NEXT.CARRY_ON,
  };
}

/** eve's events for a turn's end, the ones the host reports a rollout agent's end on. */
export type TurnEndEvent = Extract<
  MessageStreamEvent,
  { readonly type: "turn.completed" | "turn.failed" | "turn.cancelled" }
>;

/** The words Luke reads under the first line of a turn's end, by how it ended. */
const TURN_END_TEXT = {
  FINISHED: "Its turn ended. read_coding_agent shows what it did.",
  STOPPED: "Its turn was stopped before it ended.",
} as const;

/**
 * How a builder's or the keeper's turn ended as the report Luke hears,
 * read off the turn as the store settled it rather than eve's event, since
 * the relay may fail a turn eve completed: finished, failed with the word
 * the agent's status reads its failure as, or stopped, named as the
 * reporter its row stands for. A turn not yet settled reports nothing, so
 * the end eve replays once it settles is the one Luke hears.
 */
export function turnEndReport(reporter: RolloutReporter, turn: TurnEnding): Report | undefined {
  switch (turn.status) {
    case TURN_STATUS.SETTLED:
      return { ...reporter, kind: REPORT_KIND.FINISHED, text: TURN_END_TEXT.FINISHED };
    case TURN_STATUS.FAILED:
      return {
        ...reporter,
        kind: REPORT_KIND.FAILED,
        text: `Its turn failed: ${codingAgentFailureOf(turn) ?? CODING_AGENT_FAILURE.OTHER}.`,
      };
    case TURN_STATUS.CANCELLED:
      return { ...reporter, kind: REPORT_KIND.STOPPED, text: TURN_END_TEXT.STOPPED };
    default:
      return undefined;
  }
}
