/**
 * `LiveAgent` as `LiveSessionService` takes it: the session reads its agent
 * from the context it is built in rather than from a field of its options,
 * so this tag is how a composition states which one it speaks through.
 * `../live-session/live-agent.js`'s interface is untouched, and so is every
 * object implementing it, so what this tag changes is where the session
 * looks, not what it finds.
 *
 * `liveAgentLayer` is how a caller that built its agent imperatively hands it
 * over: `compose-host.ts` builds the plain one where the agent composer
 * stands and provides it to `compose-live.ts`, and `apps/web`'s hosted
 * exchange provides the one it built beside the service.
 */
import { Context, Layer } from "effect";
import type { LiveAgent } from "../live-session/live-agent.js";

export class LiveAgentTag extends Context.Service<LiveAgentTag, LiveAgent>()(
  "@luke/voice/LiveAgent",
) {}

/** Hands an agent built imperatively to the session that reads `LiveAgentTag`. */
export const liveAgentLayer = (agent: LiveAgent): Layer.Layer<LiveAgentTag> =>
  Layer.succeed(LiveAgentTag, agent);
