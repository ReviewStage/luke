import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { LanguageModel } from "ai";
import { Option, Schema } from "effect";
import {
  type MockModelRequest,
  type MockModelResponse,
  type MockModelToolResult,
  mockModel,
} from "eve/evals";
import { DRAW_ON_BOARD_TOOL } from "../server/hosted/board-tool.js";
import { BRAIN_HOST_MODEL_FIXTURE } from "../server/hosted/brain-host/bounds.js";
import { EVE_DELEGATION_TOOL } from "../server/hosted/brain-host/planning.js";
import {
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  START_CODING_AGENT_TOOL,
} from "../server/hosted/coding-agent-tools.js";
import { SEARCH_WEB_TOOL } from "../server/hosted/public-research.js";
import {
  REPOSITORY_SHELL_STATUS,
  RUN_IN_REPOSITORY_TOOL,
} from "../server/hosted/repository-shell.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that plans, so the eval exercises eve's loop,
 * the tool adapters, and the relay into the store without a key or a
 * network. It answers with one question and writes nothing, since the plan's
 * notetaker writes the document; told to look something up, it searches the
 * public web for it instead and answers with the first source the search
 * found, or says it found none; told to draw something, it draws it on the
 * plan's board as one labelled box and says so; told to research something,
 * it hands it to the worker subagent and says so, and the worker,
 * running on the same model, looks it up; told to read something, it runs
 * that command in the plan's repository and says what it read, or why it
 * read nothing, in the tool's own words; told to cut, it proposes the rest
 * as the rollout in words and notes nothing. Handed a rollout worker's report,
 * it runs the rollout as the planning prompt says to, reading the [rollout]
 * lines its standing context carries: on a pull request opened it starts
 * every position ready to start; on a question it answers the asking worker
 * with the first option it offered; on a merge it tells each worker whose
 * position bases on the merged one to retarget to main. It is selected only
 * by the fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_PLANNING_REPLY = "Who should be able to do that?";
/** What a developer's words start with when they ask the scripted planner to research the rest. */
export const SCRIPTED_LOOK_UP = "Look up: ";
export const SCRIPTED_RESEARCH_REPLY = "The first source I found:";
export const SCRIPTED_NO_SOURCE_REPLY = "I found no source for that, so it stays an open question.";
/** What a developer's words start with when they ask the scripted planner to hand the rest to the worker. */
export const SCRIPTED_DELEGATE = "Research: ";
const SCRIPTED_DELEGATED_REPLY = "The worker is on it.";
/** What a developer's words start with when they ask the scripted planner to draw the rest as one box. */
export const SCRIPTED_DRAW = "Draw: ";
/** The id the scripted planner gives the box it draws. */
export const SCRIPTED_DRAWN_ID = "sketch";
export const SCRIPTED_DRAWN_REPLY = "It's on the board.";
/** What a developer's words start with when they ask the scripted planner to run the rest in the repository. */
export const SCRIPTED_READ = "Read: ";
/** The reply to a command that ran: its stdout follows. */
export const SCRIPTED_READ_REPLY = "The repository says:";
/** What a developer's words start with when they ask the scripted planner to propose the rest as the rollout, said back as its reply. */
export const SCRIPTED_CUT = "Cut: ";
/** The reply to a command that did not run: the tool's own reason follows, so nothing unread is described as read. */
export const SCRIPTED_NOT_READ_REPLY = "I could not read the repository.";

/** What the scripted planner says once it has acted on a report. */
const SCRIPTED_REPORT_REPLY = "Done.";
/** What the scripted planner tells a worker whose base merged. */
export const SCRIPTED_RETARGET =
  "Your base merged. Retarget your pull request to main with `gh pr edit <number> --base main`, rebase it onto the merge commit on main, push, and report `rebased`.";

/** The reports the scripted planner acts on, by the word `reportLine` says each with. */
const SCRIPTED_REPORT = {
  OPENED: "opened",
  ASKS: "asks",
  MERGED: "merged",
} as const;

type ScriptedReport = (typeof SCRIPTED_REPORT)[keyof typeof SCRIPTED_REPORT];

const SCRIPTED_REPORTS: ReadonlySet<string> = new Set(Object.values(SCRIPTED_REPORT));

/** A worker's report line, `[worker 2] asks`: who reported and the word for what happened. */
const REPORT_LINE = /^\[worker (\d+)\] (\w+)\b/u;
const READY_TO_START = /^Ready to start: (.+)$/mu;
/** A position's line under [rollout], `2. "Route" · base: 1 · …`. */
const ROLLOUT_POSITION = /^(\d+)\. .* · base: (\w+) · /gmu;

const readListedAgents = Schema.decodeUnknownOption(
  Schema.Struct({
    agents: Schema.Array(
      Schema.Struct({ id: Schema.String, position: Schema.optionalKey(Schema.Number) }),
    ),
  }),
);

/** The standing context's [rollout] lines, newest last, as the model was handed them. */
function rolloutLines(request: MockModelRequest): string {
  const text = request.messages.map((message) => message.text).join("\n");
  const at = text.lastIndexOf("[rollout]");
  return at < 0 ? "" : text.slice(at);
}

/** The id of the worker at each position, as list_coding_agents answered it. */
function workersByPosition(request: MockModelRequest): ReadonlyMap<number, string> {
  const listed = request.toolResults.find((result) => result.name === LIST_CODING_AGENTS_TOOL.name);
  const agents = listed === undefined ? Option.none() : readListedAgents(listed.output);
  return new Map(
    Option.match(agents, {
      onNone: () => [],
      onSome: ({ agents }) =>
        agents.flatMap((agent) =>
          agent.position === undefined ? [] : [[agent.position, agent.id] as const],
        ),
    }),
  );
}

/** The messages a report's answer sends once the workers are listed: the asking worker's first option, or each dependent's retarget. */
function reportMessages(request: MockModelRequest, reporter: number, kind: ScriptedReport) {
  const workers = workersByPosition(request);
  if (kind === SCRIPTED_REPORT.ASKS) {
    const option = /^- (.+)$/mu.exec(request.lastUserMessage ?? "")?.[1];
    const agentId = workers.get(reporter);
    if (option === undefined || agentId === undefined) return [];
    return [
      { name: MESSAGE_CODING_AGENT_TOOL.name, input: { agentId, text: `Go with ${option}.` } },
    ];
  }
  return [...rolloutLines(request).matchAll(ROLLOUT_POSITION)].flatMap(([, position, base]) => {
    const agentId = workers.get(Number(position));
    if (base !== String(reporter) || agentId === undefined) return [];
    return [{ name: MESSAGE_CODING_AGENT_TOOL.name, input: { agentId, text: SCRIPTED_RETARGET } }];
  });
}

function isScriptedReport(word: string): word is ScriptedReport {
  return SCRIPTED_REPORTS.has(word);
}

/** The response to a report turn: start what became ready, or list the workers and then message them. */
function reportResponse(
  request: MockModelRequest,
  reporter: number,
  kind: ScriptedReport,
): MockModelResponse {
  const acted = request.toolResults.some(
    (result) =>
      result.name === START_CODING_AGENT_TOOL.name ||
      result.name === MESSAGE_CODING_AGENT_TOOL.name,
  );
  if (acted) return { text: SCRIPTED_REPORT_REPLY };
  if (kind === SCRIPTED_REPORT.OPENED) {
    const ready = READY_TO_START.exec(rolloutLines(request))?.[1] ?? "none";
    const positions = ready === "none" ? [] : ready.split(", ").map(Number);
    if (positions.length === 0) return { text: SCRIPTED_REPORT_REPLY };
    return {
      toolCalls: positions.map((position) => ({
        name: START_CODING_AGENT_TOOL.name,
        input: { position },
      })),
    };
  }
  if (!request.toolResults.some((result) => result.name === LIST_CODING_AGENTS_TOOL.name)) {
    return { toolCalls: [{ name: LIST_CODING_AGENTS_TOOL.name, input: {} }] };
  }
  const messages = reportMessages(request, reporter, kind);
  return messages.length === 0 ? { text: SCRIPTED_REPORT_REPLY } : { toolCalls: messages };
}

const readCommandResult = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({
      status: Schema.Literal(REPOSITORY_SHELL_STATUS.RAN),
      exitCode: Schema.Number,
      stdout: Schema.String,
    }),
    Schema.Struct({
      status: Schema.Literal(REPOSITORY_SHELL_STATUS.NOT_RUN),
      reason: Schema.String,
    }),
  ]),
);

/** The reply to a repository read: what it answered, or that nothing was read and why. */
function readReply(read: MockModelToolResult): MockModelResponse {
  return Option.match(readCommandResult(read.output), {
    onNone: () => ({ text: SCRIPTED_NOT_READ_REPLY }),
    onSome: (result) =>
      result.status === REPOSITORY_SHELL_STATUS.RAN
        ? { text: `${SCRIPTED_READ_REPLY} ${result.stdout.trim()}` }
        : { text: `${SCRIPTED_NOT_READ_REPLY} ${result.reason}` },
  });
}

const readFoundSearch = Schema.decodeUnknownOption(
  Schema.Struct({ findings: Schema.NonEmptyArray(Schema.Struct({ url: Schema.String })) }),
);

/** The reply to a search's result: its first source, or that there was none. */
function researchReply(searched: MockModelToolResult): MockModelResponse {
  return Option.match(readFoundSearch(searched.output), {
    onNone: () => ({ text: SCRIPTED_NO_SOURCE_REPLY }),
    onSome: (found) => ({ text: `${SCRIPTED_RESEARCH_REPLY} ${found.findings[0].url}` }),
  });
}

/** The scripted responder, one response per model call. */
function scriptedResponse(request: MockModelRequest): MockModelResponse {
  const report = REPORT_LINE.exec(request.lastUserMessage ?? "");
  const kind = report?.[2];
  if (report && kind !== undefined && isScriptedReport(kind)) {
    return reportResponse(request, Number(report[1]), kind);
  }
  const searched = request.toolResults.find((result) => result.name === SEARCH_WEB_TOOL.name);
  if (searched) return researchReply(searched);
  const read = request.toolResults.find((result) => result.name === RUN_IN_REPOSITORY_TOOL.name);
  if (read) return readReply(read);
  if (request.toolResults.some((result) => result.name === DRAW_ON_BOARD_TOOL.name)) {
    return { text: SCRIPTED_DRAWN_REPLY };
  }
  if (request.toolResults.some((result) => result.name === EVE_DELEGATION_TOOL.WORKER)) {
    return { text: SCRIPTED_DELEGATED_REPLY };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_DELEGATE)) {
    const question = request.lastUserMessage.slice(SCRIPTED_DELEGATE.length);
    return {
      toolCalls: [
        {
          name: EVE_DELEGATION_TOOL.WORKER,
          input: { message: `${SCRIPTED_LOOK_UP}${question}` },
        },
      ],
    };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_DRAW)) {
    const label = request.lastUserMessage.slice(SCRIPTED_DRAW.length);
    const elements = [
      { type: BOARD_ELEMENT_TYPE.RECTANGLE, id: SCRIPTED_DRAWN_ID, x: 0, y: 0, label },
    ];
    return { toolCalls: [{ name: DRAW_ON_BOARD_TOOL.name, input: { elements } }] };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_LOOK_UP)) {
    const query = request.lastUserMessage.slice(SCRIPTED_LOOK_UP.length);
    return { toolCalls: [{ name: SEARCH_WEB_TOOL.name, input: { query } }] };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_READ)) {
    const command = request.lastUserMessage.slice(SCRIPTED_READ.length);
    return { toolCalls: [{ name: RUN_IN_REPOSITORY_TOOL.name, input: { command } }] };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_CUT)) {
    return { text: request.lastUserMessage.slice(SCRIPTED_CUT.length) };
  }
  return { text: SCRIPTED_PLANNING_REPLY };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
