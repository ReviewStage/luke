import { type BrainHost, brainHost } from "../server/hosted/brain-host/host.js";
import { productionBrainHostSeams } from "../server/hosted/brain-host/production.js";
import { runWeb } from "../server/runtime.js";

/**
 * The one host every authored file of this eve project shares, over the
 * deployment's seams. The edge's own runner is handed down here: the seams
 * whose readers hold a promise — eve's door, the model middleware's meter —
 * run on it, so nothing under `server/hosted/` keeps a runner of its own.
 */
export const host: BrainHost = brainHost(productionBrainHostSeams(runWeb));
