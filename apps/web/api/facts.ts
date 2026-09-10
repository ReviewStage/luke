import { handleFacts } from "../server/hosted/brain-host/facts.js";
import { hostedBrainHostRoute } from "../server/hosted/brain-host/production.js";

/** The facts Luke remembers about the signed-in developer (GET). */
export default hostedBrainHostRoute(handleFacts);
