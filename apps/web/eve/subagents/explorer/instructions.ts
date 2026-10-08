import { defineInstructions } from "eve/instructions";
import { EXPLORER_INSTRUCTIONS } from "../../../server/hosted/brain-host/planning.js";

/** The explorer's standing rules, kept beside the planning prompt they answer to. */
export default defineInstructions({ content: EXPLORER_INSTRUCTIONS });
