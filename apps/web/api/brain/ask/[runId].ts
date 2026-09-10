import { handleBrainAskWait } from "../../../server/hosted/brain-host/ask.js";
import { hostedBrainHostRoute } from "../../../server/hosted/brain-host/production.js";

/** Waits on one run of the hosted brain, answering it when it ends or as it stands after a bounded hold. */
export default hostedBrainHostRoute(handleBrainAskWait);
