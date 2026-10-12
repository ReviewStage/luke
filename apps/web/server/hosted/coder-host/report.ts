import {
  CODING_AGENT_FAILURE,
  CODING_AGENT_REPORT_TOOL,
  type CodingAgentFailure,
} from "@sidecar/hosted/coding-agent-wire";
import {
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
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "../../core.js";

/**
 * report.ts -- a rollout worker's `report` tool: a milestone of its pull request, or a question, handed to Luke on the plan's conversation.
 *
 * A worker started at a position of a plan's rollout is one of several
 * Luke runs at once, and Luke hears of it only through what it reports:
 * the moment its pull request opens, when its checks go green, after it
 * rebases, after it merges, and when it is blocked or has a question only
 * the plan's owner can settle. Each report lands as a report turn on the
 * plan's conversation (`brain-host/report.ts`), keyed by the call's id, so
 * a call eve replays is one report. The worker is named by the position
 * its row holds, never by what it says, and an agent with no position is
 * refused, since no rollout waits on it. Note that a question or a block
 * answers by telling the worker to end its turn, because a coding agent's
 * turn is its whole run and Luke's answer can only reach it as its next
 * message; any other report tells it to carry on. Beside the tool, the
 * host reports how each of a worker's turns ended, finished, failed with
 * its failure word, or stopped, so Luke hears of a worker that died
 * without reporting.
 */

/** The words the tool is shown, when to report and when to ask among them, since the worker reads them every step. */
const DESCRIPTION =
  "Report to Luke, who runs the plan's rollout, on the pull request you were started at a " +
  "position of the rollout to open. Report `pr_opened` with its number the moment the pull " +
  "request is open, `ci_green` when its checks pass, `rebased` after you rebase it onto a new " +
  "base, and `merged` after you merge it. Report `question` when the brief and the code " +
  "disagree, when the acceptance cannot be met, or when a choice would change an interface " +
  "another pull request of the rollout depends on, offering the answers you see as options; " +
  "report `blocked` when you cannot go on without something only Luke or the developer can " +
  "give. Decide small things yourself and record them with `edit_plan` instead of asking. " +
  "Keep the text to what Luke needs to act on: a status or a question, not a log. After a " +
  "question or a block, end your turn: Luke's answer arrives as your next message.";

/** The tool as a worker is offered it: its name, its words, and the report's own input schema. */
export const REPORT_TOOL = {
  name: CODING_AGENT_REPORT_TOOL,
  description: DESCRIPTION,
  inputSchema: workerReportInputSchema,
} as const;

/** Why a call reported nothing, in the words the model reads. */
export const REPORT_REFUSAL = {
  UNREADABLE: "Not reported: the report does not read under the tool's schema.",
  NO_ROLLOUT:
    "Not reported: you were not started at a position of a plan's rollout, so no one is waiting on a report. Say it in your message instead.",
  UNAVAILABLE:
    "Not reported: the service could not hand the report to Luke. Carry on, and say it in your message.",
} as const;

/** What the worker is told to do once a report is taken, by whether the report waits on an answer. */
const REPORT_NEXT = {
  WAIT: "End your turn now, saying in one line that you are waiting on Luke. His answer arrives as your next message.",
  CARRY_ON: "Carry on.",
} as const;

/** The kinds that wait on Luke's answer, so the turn ends on them. */
const AWAITING_ANSWER: ReadonlySet<Report["kind"]> = new Set([
  WORKER_REPORT_KIND.QUESTION,
  WORKER_REPORT_KIND.BLOCKED,
]);

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

/** A call's input read as the worker's report, or the refusal for one that does not read. */
export function workerReport(input: UnparsedWireValue): Result.Result<WorkerReportInput, string> {
  return Result.mapError(readReport(input), () => REPORT_REFUSAL.UNREADABLE);
}

/** The report Luke hears from the worker at the position given: its own words, named by its row's position. */
export function reportAt(position: number, input: WorkerReportInput): Report {
  return { ...input, position };
}

/** The answer to a report taken: the line Luke reads, and whether to end the turn for his answer. */
export function reportTaken(report: Report): ReportToolResult {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    reported: reportLine(report),
    next: AWAITING_ANSWER.has(report.kind) ? REPORT_NEXT.WAIT : REPORT_NEXT.CARRY_ON,
  };
}

/** eve's events for a turn's end, the ones the host reports a worker's end on. */
export type TurnEndEvent = Extract<
  MessageStreamEvent,
  { readonly type: "turn.completed" | "turn.failed" | "turn.cancelled" }
>;

/** The words Luke reads under the first line of a turn's end, by how it ended. */
const TURN_END_TEXT = {
  FINISHED:
    "Its turn ended. read_coding_agent shows what it did and where its pull request stands.",
  STOPPED: "Its turn was stopped before it ended.",
} as const;

/**
 * How a worker's turn ended as the report Luke hears: finished, failed
 * with the word the agent's status reads its failure as, or stopped. The
 * failure word is the caller's to read from the settled turn, since eve's
 * event alone does not carry the host's own refusals; a turn whose word
 * could not be read fails as `other`.
 */
export function turnEndReport(
  position: number,
  event: TurnEndEvent,
  failure: CodingAgentFailure | undefined,
): Report {
  switch (event.type) {
    case "turn.completed":
      return { kind: REPORT_KIND.FINISHED, position, text: TURN_END_TEXT.FINISHED };
    case "turn.failed":
      return {
        kind: REPORT_KIND.FAILED,
        position,
        text: `Its turn failed: ${failure ?? CODING_AGENT_FAILURE.OTHER}.`,
      };
    case "turn.cancelled":
      return { kind: REPORT_KIND.STOPPED, position, text: TURN_END_TEXT.STOPPED };
  }
}
