import { type PlanDocument, planDocumentSchema } from "@sidecar/hosted/plan-wire";
import type { LanguageModel } from "ai";
import { Option, Schema } from "effect";
import {
  type MockModelRequest,
  type MockModelResponse,
  type MockModelToolResult,
  mockModel,
} from "eve/evals";
import { BRAIN_TOOL, WORKSPACE_FILE } from "../server/core.js";
import { BRAIN_HOST_MODEL_FIXTURE } from "../server/hosted/brain-host/bounds.js";
import { documentTextOf, repositoryTextOf } from "../server/hosted/brain-host/planning.js";
import { SEARCH_WEB_TOOL } from "../server/hosted/public-research.js";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that records one fact about the developer as
 * a dated directive in USER.md and then answers in words, so the eval
 * exercises eve's loop, the tool adapters, the workspace access, and the
 * relay into the store without a key or a network. Offered `update_plan`, it
 * plans instead: it reads the saved document its standing context hands it,
 * adds the developer's latest words as an unconfirmed assumption, saves the
 * whole document back, and answers with one question; told to look
 * something up, it searches the public web for it instead and answers with
 * the first source the search found, or says it found none; asked for the
 * prompt, it appends a handoff prompt naming the plan's repository and
 * commit to the same body and saves it with the assumptions as they stand. It is selected only by
 * the fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_FACT = "The developer prefers short replies.";
const SCRIPTED_USER_FILE = `# USER.md\n\n- 2026-09-15: ${SCRIPTED_FACT}\n`;
const SCRIPTED_REPLY = "Noted: short replies from now on.";
export const SCRIPTED_PLANNING_REPLY = "Noted as an assumption. Who should be able to do that?";
/** What a developer's words start with when they ask the scripted planner to research the rest. */
export const SCRIPTED_LOOK_UP = "Look up: ";
export const SCRIPTED_RESEARCH_REPLY = "The first source I found:";
export const SCRIPTED_NO_SOURCE_REPLY = "I found no source for that, so it stays an open question.";
/** What a developer's words start with when they ask the scripted planner for the handoff prompt. */
export const SCRIPTED_WRITE_PROMPT = "Write the prompt.";
export const SCRIPTED_HANDOFF_HEADING = "## Handoff prompt";

const readDocument = Schema.decodeUnknownOption(Schema.fromJsonString(planDocumentSchema));

/** What the newest standing context carries, read by the reader handed in. */
function newestStanding(
  request: MockModelRequest,
  read: (standingContext: string) => string | undefined,
): string | undefined {
  const texts = request.messages
    .filter((message) => message.role === "system")
    .map((message) => read(message.text))
    .filter((text) => text !== undefined);
  return texts.at(-1);
}

/** The saved document the newest standing context carries; an empty one where none reads. */
function handedDocument(request: MockModelRequest) {
  const newest = newestStanding(request, documentTextOf);
  const document = newest === undefined ? Option.none() : readDocument(newest);
  return Option.getOrElse(document, () => ({ body: "", assumptions: [] }));
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

/** The handoff prompt appended to the saved body, saved with the assumptions exactly as handed. */
function handoffResponse(request: MockModelRequest, document: PlanDocument): MockModelResponse {
  const repository = newestStanding(request, repositoryTextOf) ?? "an unknown repository";
  const prompt = `${SCRIPTED_HANDOFF_HEADING}\n\nYou are implementing this plan in ${repository}.\n`;
  const body = document.body.trimEnd();
  return {
    toolCalls: [
      {
        name: UPDATE_PLAN_TOOL.name,
        input: {
          body: body.length === 0 ? prompt : `${body}\n\n${prompt}`,
          assumptions: document.assumptions,
        },
      },
    ],
  };
}

function planningResponse(request: MockModelRequest): MockModelResponse {
  const searched = request.toolResults.find((result) => result.name === SEARCH_WEB_TOOL.name);
  if (searched) return researchReply(searched);
  if (request.toolResults.length > 0 || request.lastUserMessage === null) {
    return { text: SCRIPTED_PLANNING_REPLY };
  }
  if (request.lastUserMessage.startsWith(SCRIPTED_LOOK_UP)) {
    const query = request.lastUserMessage.slice(SCRIPTED_LOOK_UP.length);
    return { toolCalls: [{ name: SEARCH_WEB_TOOL.name, input: { query } }] };
  }
  const document = handedDocument(request);
  if (request.lastUserMessage.startsWith(SCRIPTED_WRITE_PROMPT)) {
    return handoffResponse(request, document);
  }
  return {
    toolCalls: [
      {
        name: UPDATE_PLAN_TOOL.name,
        input: {
          body: document.body,
          assumptions: [
            ...document.assumptions,
            { text: request.lastUserMessage, confirmed: false },
          ],
        },
      },
    ],
  };
}

/** The scripted responder, one response per model call. */
function scriptedResponse(request: MockModelRequest): MockModelResponse {
  const { toolResults, tools } = request;
  if (tools.some((tool) => tool.name === UPDATE_PLAN_TOOL.name)) return planningResponse(request);
  const write = tools.find((tool) => tool.name === BRAIN_TOOL.WRITE_WORKSPACE_FILE);
  if (write && toolResults.length === 0) {
    return {
      toolCalls: [
        {
          name: write.name,
          input: { name: WORKSPACE_FILE.USER, content: SCRIPTED_USER_FILE },
        },
      ],
    };
  }
  return { text: SCRIPTED_REPLY };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
