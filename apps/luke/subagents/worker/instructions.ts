import { WORKER_INSTRUCTIONS } from "@luke/service/agents/brain-host/brain";
import { defineInstructions } from "eve/instructions";

/** The worker's standing rules, kept beside the brain's prompt they answer to. */
export default defineInstructions({ content: WORKER_INSTRUCTIONS });
