import { defineInstructions } from "eve/instructions";
import { WORKER_INSTRUCTIONS } from "../../../server/hosted/brain-host/planning.js";

/** The worker's standing rules, kept beside the planning prompt they answer to. */
export default defineInstructions({ content: WORKER_INSTRUCTIONS });
