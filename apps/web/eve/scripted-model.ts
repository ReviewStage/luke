import { EMPTY_PLAN_UPDATE, type PlanUpdate } from "@sidecar/hosted/plan-template";
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
import { documentTextOf } from "../server/hosted/brain-host/planning.js";
import { SEARCH_WEB_TOOL } from "../server/hosted/public-research.js";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that records one fact about the developer as
 * a dated directive in USER.md and then answers in words, so the eval
 * exercises eve's loop, the tool adapters, the workspace access, and the
 * relay into the store without a key or a network. Offered `update_plan`, it
 * plans instead: it reads the saved document its standing context hands it,
 * adds the developer's latest words as an unconfirmed assumption, and saves
 * the whole template back with its one scripted answer, the rest unanswered,
 * and answers with one question; told to look something up, it searches
 * the public web for it instead and answers with the first source the search
 * found, or says it found none; asked for the prompt, it writes a handoff
 * prompt into the template's handoff field, keeps it on every later save, and saves it with the assumptions as
 * they stand. It reads no field back out of the body: the one thing it looks
 * for is its own handoff sentence. It is selected only by
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
/** How the scripted handoff prompt begins, the one sentence of its own the scripted planner looks for. */
export const SCRIPTED_HANDOFF_OPENING = "You are implementing this plan.";
/** The one answer the scripted planner writes into the template. */
export const SCRIPTED_PROBLEM = "Teammates cannot be invited to a workspace today.";

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

/**
 * The template as the scripted planner saves it: its one answer, the handoff
 * prompt where one is written, and the assumptions handed in.
 */
function scriptedUpdate(handoff: boolean, assumptions: PlanDocument["assumptions"]): PlanUpdate {
  return {
    ...EMPTY_PLAN_UPDATE,
    purpose: { ...EMPTY_PLAN_UPDATE.purpose, problem: SCRIPTED_PROBLEM },
    handoffPrompt: handoff ? SCRIPTED_HANDOFF_OPENING : null,
    assumptions,
  };
}

function savedUpdate(update: PlanUpdate): MockModelResponse {
  return { toolCalls: [{ name: UPDATE_PLAN_TOOL.name, input: update }] };
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
  const { assumptions } = document;
  if (request.lastUserMessage.startsWith(SCRIPTED_WRITE_PROMPT)) {
    return savedUpdate(scriptedUpdate(true, assumptions));
  }
  const handedOff = document.body.includes(SCRIPTED_HANDOFF_OPENING);
  const added = [...assumptions, { text: request.lastUserMessage, confirmed: false }];
  return savedUpdate(scriptedUpdate(handedOff, added));
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
