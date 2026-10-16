import { WORKER_INSTRUCTIONS } from "@luke/service/agents/brain-host/planning";
import { defineInstructions } from "eve/instructions";

/** The worker's standing rules, kept beside the planning prompt they answer to. */
export default defineInstructions({ content: WORKER_INSTRUCTIONS });
