import type { LanguageModel } from "ai";
import { mockModel } from "eve/evals";
import { ACTION_TOOL } from "../server/core.js";
import { BRAIN_HOST_MODEL_FIXTURE } from "../server/hosted/brain-host/bounds.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that asks for one remembered fact and then
 * answers in words, so the eval exercises eve's loop, the tool adapters,
 * admission, the carrier, and the relay into the store without a key or a
 * network. It is selected only by the fixture's own environment variable and
 * a deployment never names it.
 */

export const SCRIPTED_FACT = "The developer prefers short replies.";
export const SCRIPTED_REPLY = "Noted: short replies from now on.";

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: ({ toolResults, tools }) => {
      const remember = tools.find((tool) => tool.name === ACTION_TOOL.REMEMBER_FACT);
      if (remember && toolResults.length === 0) {
        return { toolCalls: [{ name: remember.name, input: { words: SCRIPTED_FACT } }] };
      }
      return { text: SCRIPTED_REPLY };
    },
  });
}
