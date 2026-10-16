import { DEPLOYMENT_PRESENCE } from "@luke/service/agents/brain-host/auth";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "@luke/service/agents/brain-host/channel";
import { hostedUserId } from "@luke/service/auth/bearer";
import { Effect, Option } from "effect";
import { eveChannel } from "eve/channels/eve";
import { seams } from "../host.js";
import { runAgent } from "../runtime.js";

/**
 * The bearer's account, resolved as an effect and run once here: eve's door
 * takes a promise, and an authored file is where this deployment runs what it
 * hands eve, so nothing under `server/hosted/` keeps a promise-shaped copy of
 * the resolution for eve's sake.
 */
const resolveUserId = (request: Request): Promise<string | undefined> =>
  runAgent(Effect.map(hostedUserId(request, seams.userInfo), Option.getOrUndefined));

/** The one door into the hosted brain: eve's own HTTP API under the host's auth and queue policy. */
export default eveChannel(
  brainHostChannelInput(resolveUserId, seams.ownership, {
    secret: seams.deploymentSecret(),
    admits: DEPLOYMENT_TURNS,
    presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
  }),
);
