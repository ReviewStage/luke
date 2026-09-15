import type { LanguageModel } from "ai";
import { mockModel } from "eve/evals";
import { BRAIN_TOOL, WORKSPACE_FILE } from "../server/core.js";
import { BRAIN_HOST_MODEL_FIXTURE } from "../server/hosted/brain-host/bounds.js";

/**
 * The fixture model the end-to-end eval runs the whole host under: a
 * scripted stand-in for OpenAI that records one fact about the developer as
 * a dated directive in USER.md and then answers in words, so the eval
 * exercises eve's loop, the tool adapters, the workspace access, and the
 * relay into the store without a key or a network. It is selected only by
 * the fixture's own environment variable and a deployment never names it.
 */

export const SCRIPTED_FACT = "The developer prefers short replies.";
const SCRIPTED_USER_FILE = `# USER.md\n\n- 2026-09-15: ${SCRIPTED_FACT}\n`;
export const SCRIPTED_REPLY = "Noted: short replies from now on.";

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: ({ toolResults, tools }) => {
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
    },
  });
}
