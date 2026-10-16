import { coderWorkerInstructions } from "@luke/service/agents/coder-host/instructions";
import { defineInstructions } from "eve/instructions";

/** The worker's standing rules, kept beside the agent's (`packages/service/src/agents/coder-host/instructions.ts`). */
export default defineInstructions({ content: coderWorkerInstructions() });
