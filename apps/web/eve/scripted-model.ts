import { planDocumentSchema } from "@sidecar/hosted/plan-wire";
import type { LanguageModel } from "ai";
import { Option, Schema } from "effect";
import { type MockModelRequest, type MockModelResponse, mockModel } from "eve/evals";
import { BRAIN_TOOL, WORKSPACE_FILE } from "../server/core.js";
import { BRAIN_HOST_MODEL_FIXTURE } from "../server/hosted/brain-host/bounds.js";
import { documentTextOf } from "../server/hosted/brain-host/planning.js";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that records one fact about the developer as
 * a dated directive in USER.md and then answers in words, so the eval
 * exercises eve's loop, the tool adapters, the workspace access, and the
 * relay into the store without a key or a network. Offered `update_plan`, it
 * plans instead: it reads the saved document its standing context hands it,
 * adds the developer's latest words as an unconfirmed assumption, saves the
 * whole document back, and answers with one question. It is selected only by
 * the fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_FACT = "The developer prefers short replies.";
const SCRIPTED_USER_FILE = `# USER.md\n\n- 2026-09-15: ${SCRIPTED_FACT}\n`;
const SCRIPTED_REPLY = "Noted: short replies from now on.";
export const SCRIPTED_PLANNING_REPLY = "Noted as an assumption. Who should be able to do that?";

const readDocument = Schema.decodeUnknownOption(Schema.fromJsonString(planDocumentSchema));

/** The saved document the newest standing context carries; an empty one where none reads. */
function handedDocument(request: MockModelRequest) {
  const texts = request.messages
    .filter((message) => message.role === "system")
    .map((message) => documentTextOf(message.text))
    .filter((text) => text !== undefined);
  const newest = texts.at(-1);
  const document = newest === undefined ? Option.none() : readDocument(newest);
  return Option.getOrElse(document, () => ({ body: "", assumptions: [] }));
}

function planningResponse(request: MockModelRequest): MockModelResponse {
  if (request.toolResults.length > 0 || request.lastUserMessage === null) {
    return { text: SCRIPTED_PLANNING_REPLY };
  }
  const document = handedDocument(request);
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
