import { defineInstructions } from "eve/instructions";
import { RESEARCHER_INSTRUCTIONS } from "../../../server/hosted/brain-host/planning.js";

/** The researcher's standing rules, kept beside the planning prompt they answer to. */
export default defineInstructions({ content: RESEARCHER_INSTRUCTIONS });
