import { defineAgent } from "eve";
import { brainModel } from "../../agent.js";
import { host } from "../../host.js";

/**
 * The explorer: a subagent the planning model hands a question about the
 * plan's code to, run by eve as a background task on the researcher's terms
 * (`../researcher/agent.ts`).
 */
export default defineAgent({
  description:
    "Read the plan's code folder in the background to answer one question about the code, and return a short summary with file paths. Returns at once; the findings arrive later.",
  defaultTools: false,
  model: brainModel(host.admitDelegated),
});
