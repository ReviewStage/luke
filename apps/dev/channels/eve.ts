import { DEPLOYMENT_PRESENCE } from "@luke/service/agents/brain-host/auth";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "@luke/service/agents/coder-host/channel";
import { hostedUserId } from "@luke/service/auth/bearer";
import { Effect, Option } from "effect";
import { eveChannel } from "eve/channels/eve";
import { host, seams } from "../host.js";
import { runAgent } from "../runtime.js";

/**
 * The bearer's account, resolved as an effect and run once here: eve's door
 * takes a promise, and an authored file is where this deployment runs what it
 * hands eve, so nothing under `server/hosted/` keeps a promise-shaped copy of
 * the resolution for eve's sake.
 */
const resolveUserId = (request: Request): Promise<string | undefined> =>
  runAgent(Effect.map(hostedUserId(request, seams.userInfo), Option.getOrUndefined));

/** The one door into the coding-agent service: eve's own HTTP API under the host's auth and steer policy, hearing each session's end. */
export default eveChannel(
  coderChannelInput(
    resolveUserId,
    seams.ownership,
    {
      secret: seams.deploymentSecret(),
      admits: CODER_DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.ACCOUNT,
    },
    // The end of a session eve tells the channel alone, run here on the edge's runner; the host logs its own failures.
    (sessionId) => runAgent(host.sessionEnded(sessionId)),
  ),
);
