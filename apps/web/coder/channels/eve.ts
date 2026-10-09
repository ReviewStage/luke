import { Effect, Option } from "effect";
import { eveChannel } from "eve/channels/eve";
import { hostedUserId } from "../../server/hosted/bearer.js";
import { coderChannelInput } from "../../server/hosted/coder-host/channel.js";
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

/** The one door into the coding-agent service: eve's own HTTP API under the host's auth and steer policy. */
export default eveChannel(coderChannelInput(resolveUserId, seams.ownership));
