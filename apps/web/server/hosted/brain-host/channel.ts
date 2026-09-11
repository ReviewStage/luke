import { localDev } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import type { UserInfoEndpoint } from "../bearer.js";
import { type DeploymentActor, deploymentActor, lukeAccount } from "./auth.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "./bounds.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "./door.js";

/**
 * How the eve channel is configured: the deployment acting for an account
 * first, then a Luke account's bearer, then the development principal only
 * where eve is a development server, and a queue for follow-ups, so an ask
 * that arrives while a turn is under way waits for it rather than cutting it
 * short; steering is for an explicit cancel and never the default. The
 * deployment goes first because it refuses rather than skips a request under
 * its secret that asks for anything but the turns its table admits, and a
 * later entry must not get the chance to read that request as something
 * else; for the same reason there is one of it, over one table, and a
 * deployment-side caller that needs another kind of turn adds a row.
 * Ownership stands at the door: whoever the inner walk admits is refused for
 * a session or a conversation that is not theirs before any route runs.
 * Every message carries the request's conversation and turn kind into the
 * session's auth, where the host reads them back, and a message naming no
 * kind of turn is refused before it dispatches.
 */
export function brainHostChannelInput(
  userInfo: UserInfoEndpoint,
  ownership: SessionOwnership,
  deployment: DeploymentActor,
): EveChannelInput {
  return {
    auth: ownedAuth([deploymentActor(deployment), lukeAccount(userInfo), localDev()], ownership),
    turnPolicy: "queue",
    onMessage: (ctx) => ({ auth: messageAuth(ctx) }),
  };
}

/**
 * The kinds of turn the deployment may open for an account, in the roles it
 * acts in: the scheduled observation's turns today. A caller of another role
 * adds its row here and nowhere else.
 */
export const DEPLOYMENT_TURNS = {
  [BRAIN_HOST_TURN.TYPED]: false,
  [BRAIN_HOST_TURN.SPOKEN]: false,
  [BRAIN_HOST_TURN.OBSERVATION]: true,
} as const satisfies Record<BrainHostTurn, boolean>;
