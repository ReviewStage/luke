import { handleBrainAskCancel } from "../../../../server/hosted/brain-host/ask.js";
import { hostedBrainHostRoute } from "../../../../server/hosted/brain-host/production.js";

/** Cancels one run of the hosted brain. */
export default hostedBrainHostRoute(handleBrainAskCancel);
