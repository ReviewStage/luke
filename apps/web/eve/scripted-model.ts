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

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that plans, so the eval exercises eve's loop,
 * the tool adapters, and the relay into the store without a key or a
 * network. It answers with one question and writes nothing, since the plan's
 * notetaker writes the document; told to look something up, it searches the
 * public web for it instead and answers with the first source the search
 * found, or says it found none; told to draw something, it draws it on the
 * plan's board as one labelled box and says so; told to research something,
 * it hands it to the researcher subagent and says so, and the researcher,
 * running on the same model, looks it up. It is selected only by the
 * fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_PLANNING_REPLY = "Who should be able to do that?";
/** What a developer's words start with when they ask the scripted planner to research the rest. */
export const SCRIPTED_LOOK_UP = "Look up: ";
export const SCRIPTED_RESEARCH_REPLY = "The first source I found:";
export const SCRIPTED_NO_SOURCE_REPLY = "I found no source for that, so it stays an open question.";
/** What a developer's words start with when they ask the scripted planner to hand the rest to the researcher. */
export const SCRIPTED_DELEGATE = "Research: ";
const SCRIPTED_DELEGATED_REPLY = "The researcher is on it.";
/** What a developer's words start with when they ask the scripted planner to draw the rest as one box. */
export const SCRIPTED_DRAW = "Draw: ";
/** The id the scripted planner gives the box it draws. */
export const SCRIPTED_DRAWN_ID = "sketch";
export const SCRIPTED_DRAWN_REPLY = "It's on the board.";

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
  if (request.toolResults.some((result) => result.name === DRAW_ON_BOARD_TOOL.name)) {
    return { text: SCRIPTED_DRAWN_REPLY };
  }
  if (request.toolResults.some((result) => result.name === EVE_DELEGATION_TOOL.RESEARCHER)) {
    return { text: SCRIPTED_DELEGATED_REPLY };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_DELEGATE)) {
    const question = request.lastUserMessage.slice(SCRIPTED_DELEGATE.length);
    return {
      toolCalls: [
        {
          name: EVE_DELEGATION_TOOL.RESEARCHER,
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
  return { text: SCRIPTED_PLANNING_REPLY };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
