import { eveChannel } from "eve/channels/eve";
import { hostedUserId } from "../../server/hosted/bearer.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../../server/hosted/brain-host/channel.js";
import { productionBrainHostSeams } from "../../server/hosted/brain-host/production.js";
import { runWeb } from "../../server/runtime.js";

/** The one door into the hosted brain: eve's own HTTP API under the host's auth and queue policy. */
const seams = productionBrainHostSeams(runWeb);

/**
 * The bearer's account, resolved as an effect and run once here: eve's door
 * takes a promise, and an authored file is where this deployment runs what it
 * hands eve, so nothing under `server/hosted/` keeps a promise-shaped copy of
 * the resolution for eve's sake.
 */
const resolveUserId = (request: Request): Promise<string | undefined> =>
  runWeb(hostedUserId(request, seams.userInfo));

export default eveChannel(
  brainHostChannelInput(resolveUserId, seams.ownership, {
    secret: seams.deploymentSecret(),
    admits: DEPLOYMENT_TURNS,
  }),
);
