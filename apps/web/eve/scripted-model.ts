import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { ROLLOUT_ROLE } from "@sidecar/hosted/coding-agent-wire";
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
import { PLANNER_DELEGATE_TOOL } from "../server/hosted/brain-host/planning.js";
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
 * it hands it to the worker through its delegate and says so, and the worker,
 * running on the same model, looks it up; told to read something, it runs
 * that command in the plan's repository and says what it read, or why it
 * read nothing, in the tool's own words. Handed a rollout report,
 * it runs the rollout as the planning prompt says to, reading the [rollout]
 * lines its standing context carries and the agents list_coding_agents
 * names: on a pull request opened it tells the stack keeper to stack it and
 * starts every position ready to start; on a question it answers the asker
 * with the first option offered; on a merge, the keeper's or GitHub's, it
 * hands the retarget and restack to the keeper and to no builder. It is selected only
 * by the fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_PLANNING_REPLY = "Who should be able to do that?";
/** What a developer's words start with when they ask the scripted planner to research the rest. */
const SCRIPTED_LOOK_UP = "Look up: ";
const SCRIPTED_RESEARCH_REPLY = "The first source I found:";
const SCRIPTED_NO_SOURCE_REPLY = "I found no source for that, so it stays an open question.";
/** What a developer's words start with when they ask the scripted planner to hand the rest to the worker. */
export const SCRIPTED_DELEGATE = "Research: ";
const SCRIPTED_DELEGATED_REPLY = "The worker is on it.";
/** What a developer's words start with when they ask the scripted planner to draw the rest as one box. */
const SCRIPTED_DRAW = "Draw: ";
/** The id the scripted planner gives the box it draws. */
const SCRIPTED_DRAWN_ID = "sketch";
const SCRIPTED_DRAWN_REPLY = "It's on the board.";
/** What a developer's words start with when they ask the scripted planner to run the rest in the repository. */
export const SCRIPTED_READ = "Read: ";
/** The reply to a command that ran: its stdout follows. */
export const SCRIPTED_READ_REPLY = "The repository says:";
/** The reply to a command that did not run: the tool's own reason follows, so nothing unread is described as read. */
export const SCRIPTED_NOT_READ_REPLY = "I could not read the repository.";

/** What the scripted planner says once it has acted on a report. */
const SCRIPTED_REPORT_REPLY = "Done.";
/** What the scripted planner tells the keeper when a builder's pull request opens. */
export const SCRIPTED_STACK = "Stack the pull request that just opened onto its base.";
/** What the scripted planner tells the keeper when a pull request merged. */
export const SCRIPTED_RESTACK =
  "A pull request merged. Retarget what based on it to main, restack, and report `restacked`.";

/** The reports the scripted planner acts on, by the word `reportLine` says each with. */
const SCRIPTED_REPORT = {
  OPENED: "opened",
  ASKS: "asks",
  MERGED: "merged",
} as const;

type ScriptedReport = (typeof SCRIPTED_REPORT)[keyof typeof SCRIPTED_REPORT];

const SCRIPTED_REPORTS: ReadonlySet<string> = new Set(Object.values(SCRIPTED_REPORT));

/** A report's first line, `[worker 2] asks`, `[keeper] merged #415`, `[github] merged #415`: the builder's position where a builder reported, and the word for what happened. */
const REPORT_LINE = /^\[(?:worker (\d+)|keeper|github)\] (\w+)\b/u;
const READY_TO_START = /^Ready to start: (.+)$/mu;

const readListedAgents = Schema.decodeUnknownOption(
  Schema.Struct({
    agents: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        position: Schema.optionalKey(Schema.Number),
        role: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
);

/** The standing context's [rollout] lines, newest last, as the model was handed them. */
function rolloutLines(request: MockModelRequest): string {
  const text = request.messages.map((message) => message.text).join("\n");
  const at = text.lastIndexOf("[rollout]");
  return at < 0 ? "" : text.slice(at);
}

/** The rollout's agents as list_coding_agents answered them: each builder's id by its position, and the keeper's. */
function rolloutAgents(request: MockModelRequest) {
  const listed = request.toolResults.find((result) => result.name === LIST_CODING_AGENTS_TOOL.name);
  const agents = Option.match(
    listed === undefined ? Option.none() : readListedAgents(listed.output),
    { onNone: () => [], onSome: ({ agents }) => agents },
  );
  const builders = new Map(
    agents.flatMap((agent) =>
      agent.position === undefined ? [] : [[agent.position, agent.id] as const],
    ),
  );
  const keeper = agents.find((agent) => agent.role === ROLLOUT_ROLE.KEEPER);
  return { builders, keeper: keeper?.id };
}

/** The starts of every position the [rollout] lines show ready to start. */
function readyStarts(request: MockModelRequest) {
  const ready = READY_TO_START.exec(rolloutLines(request))?.[1] ?? "none";
  const positions = ready === "none" ? [] : ready.split(", ").map(Number);
  return positions.map((position) => ({
    name: START_CODING_AGENT_TOOL.name,
    input: { position },
  }));
}

/** A message to one agent, or none where the list named no such agent. */
function messageTo(agentId: string | undefined, text: string) {
  return agentId === undefined
    ? []
    : [{ name: MESSAGE_CODING_AGENT_TOOL.name, input: { agentId, text } }];
}

/** The calls a report's answer makes once the agents are listed: stack and start what is ready, answer a builder's question, or hand a merge to the keeper. */
function reportCalls(request: MockModelRequest, builder: number | undefined, kind: ScriptedReport) {
  const { builders, keeper } = rolloutAgents(request);
  if (kind === SCRIPTED_REPORT.OPENED) {
    return [...messageTo(keeper, SCRIPTED_STACK), ...readyStarts(request)];
  }
  if (kind === SCRIPTED_REPORT.ASKS) {
    const option = /^- (.+)$/mu.exec(request.lastUserMessage ?? "")?.[1];
    const asker = builder === undefined ? keeper : builders.get(builder);
    return option === undefined ? [] : messageTo(asker, `Go with ${option}.`);
  }
  return [...messageTo(keeper, SCRIPTED_RESTACK), ...readyStarts(request)];
}

function isScriptedReport(word: string): word is ScriptedReport {
  return SCRIPTED_REPORTS.has(word);
}

/** The response to a report turn: list the rollout's agents, then act on the report through them. */
function reportResponse(
  request: MockModelRequest,
  builder: number | undefined,
  kind: ScriptedReport,
): MockModelResponse {
  const acted = request.toolResults.some(
    (result) =>
      result.name === START_CODING_AGENT_TOOL.name ||
      result.name === MESSAGE_CODING_AGENT_TOOL.name,
  );
  if (acted) return { text: SCRIPTED_REPORT_REPLY };
  if (!request.toolResults.some((result) => result.name === LIST_CODING_AGENTS_TOOL.name)) {
    return { toolCalls: [{ name: LIST_CODING_AGENTS_TOOL.name, input: {} }] };
  }
  const calls = reportCalls(request, builder, kind);
  return calls.length === 0 ? { text: SCRIPTED_REPORT_REPLY } : { toolCalls: calls };
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
    const builder = report[1] === undefined ? undefined : Number(report[1]);
    return reportResponse(request, builder, kind);
  }
  const searched = request.toolResults.find((result) => result.name === SEARCH_WEB_TOOL.name);
  if (searched) return researchReply(searched);
  const read = request.toolResults.find((result) => result.name === RUN_IN_REPOSITORY_TOOL.name);
  if (read) return readReply(read);
  if (request.toolResults.some((result) => result.name === DRAW_ON_BOARD_TOOL.name)) {
    return { text: SCRIPTED_DRAWN_REPLY };
  }
  if (request.toolResults.some((result) => result.name === PLANNER_DELEGATE_TOOL.name)) {
    return { text: SCRIPTED_DELEGATED_REPLY };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_DELEGATE)) {
    const question = request.lastUserMessage.slice(SCRIPTED_DELEGATE.length);
    return {
      toolCalls: [
        {
          name: PLANNER_DELEGATE_TOOL.name,
          input: { task: `${SCRIPTED_LOOK_UP}${question}` },
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
  return { text: SCRIPTED_PLANNING_REPLY };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
