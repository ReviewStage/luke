import { defineAgent } from "eve";
import { BRAIN_HOST } from "../../../server/hosted/brain-host/bounds.js";
import { brainModel } from "../../agent.js";
import { host } from "../../host.js";

/**
 * The researcher: a subagent the planning model hands a research question to,
 * run by eve as a background task so the planning turn answers without
 * waiting for it. Its findings reach the planning model as a task
 * notification, never the developer directly.
 */
export default defineAgent({
  description:
    "Research one question on the public Internet in the background and return a short summary with its sources. Returns at once; the findings arrive later.",
  defaultTools: false,
  model: brainModel(host.admitDelegated),
  limits: {
    maxInputTokensPerSession: BRAIN_HOST.SUBAGENT_INPUT_TOKENS,
    maxOutputTokensPerSession: BRAIN_HOST.SUBAGENT_OUTPUT_TOKENS,
  },
});
