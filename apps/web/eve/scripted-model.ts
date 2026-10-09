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
 * read nothing, in the tool's own words. It is selected only by the
 * fixture's own environment variable and a deployment never names it.
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
/** The reply to a command that did not run: the tool's own reason follows, so nothing unread is described as read. */
export const SCRIPTED_NOT_READ_REPLY = "I could not read the repository.";

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
  return { text: SCRIPTED_PLANNING_REPLY };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
