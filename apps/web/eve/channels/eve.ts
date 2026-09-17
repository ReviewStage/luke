import { Effect, Option } from "effect";
import { eveChannel } from "eve/channels/eve";
import { hostedUserId } from "../../server/hosted/bearer.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../../server/hosted/brain-host/channel.js";
import { runWeb } from "../../server/runtime.js";
import { seams } from "../host.js";

/**
 * The bearer's account, resolved as an effect and run once here: eve's door
 * takes a promise, and an authored file is where this deployment runs what it
 * hands eve, so nothing under `server/hosted/` keeps a promise-shaped copy of
 * the resolution for eve's sake.
 */
const resolveUserId = (request: Request): Promise<string | undefined> =>
  runWeb(Effect.map(hostedUserId(request, seams.userInfo), Option.getOrUndefined));

/** The one door into the hosted brain: eve's own HTTP API under the host's auth and queue policy. */
export default eveChannel(
  brainHostChannelInput(resolveUserId, seams.ownership, {
    secret: seams.deploymentSecret(),
    admits: DEPLOYMENT_TURNS,
  }),
);
