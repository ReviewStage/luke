import type { LanguageModel } from "ai";
import { type MockModelRequest, type MockModelResponse, mockModel } from "eve/evals";
import { CODER_MODEL_FIXTURE } from "../server/hosted/coder-host/bounds.js";

/**
 * The fixture model the end-to-end eval runs the coding agent under: a
 * scripted stand-in for the providers, so the eval exercises eve's loop and
 * the relay into the store without a key, a network, or a sandbox. Handed a
 * plan, it answers in words that it read the plan and has nothing to
 * publish, and calls no tool, so no sandbox opens and no repository is
 * checked out. It is selected only by the fixture's own environment
 * variable and a deployment never names it.
 */

/** What the scripted agent answers a plan with: the plan's first line, read back, and no pull request. */
export const SCRIPTED_CODER_REPLY = "I read the plan and have nothing to publish:";

function scriptedResponse(request: MockModelRequest): MockModelResponse {
  const firstLine = request.lastUserMessage?.split("\n")[0]?.trim() ?? "";
  return { text: `${SCRIPTED_CODER_REPLY} ${firstLine}` };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
