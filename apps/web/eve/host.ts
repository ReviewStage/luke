import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import { productionBrainHostSeams } from "../server/hosted/brain-host/production.js";

/** The one host every authored file of this eve project shares, over the deployment's seams. */
export const host: BrainHost = brainHost(productionBrainHostSeams());
