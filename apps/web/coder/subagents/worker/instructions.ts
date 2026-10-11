import { defineInstructions } from "eve/instructions";
import { coderWorkerInstructions } from "../../../server/hosted/coder-host/instructions.js";

/** The worker's standing rules, kept beside the agent's (`server/hosted/coder-host/instructions.ts`). */
export default defineInstructions({ content: coderWorkerInstructions() });
