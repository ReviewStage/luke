import { handleBrainAsk } from "../../server/hosted/brain-host/ask.js";
import { hostedBrainHostRoute } from "../../server/hosted/brain-host/production.js";

/** Asks Luke's hosted brain: one ask becomes a run of the account's conversation, answered by its id. */
export default hostedBrainHostRoute(handleBrainAsk);
