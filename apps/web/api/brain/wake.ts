import { brainWakeRoute } from "../../server/hosted/brain-host/production.js";

/**
 * The scheduled wake of the hosted brain, called by Vercel's cron on the
 * cadence `vercel.json` fixes: an observation turn for every account whose
 * roster changed, and the resumption of every run a function left unfinished.
 */
export default brainWakeRoute;
