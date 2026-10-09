import type { TurnPolicy } from "eve/channels";
import { localDev } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import { type BearerAccount, lukeAccount } from "../brain-host/auth.js";
import { BRAIN_HOST_TURN_POLICY } from "../brain-host/channel.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "../brain-host/door.js";

/**
 * channel.ts -- how the coding-agent service's eve channel is configured.
 *
 * The same door as the planning brain's (`brain-host/door.ts`): whoever the
 * inner walk admits is refused for a session or a conversation that is not
 * theirs before any route runs, and every message carries the request's
 * conversation and turn kind into the session's auth. What differs is who
 * walks in. A coding agent is started, messaged, and stopped by routes
 * still holding the developer's own bearer, which reach eve as that
 * developer, so the walk is the account's bearer and, where eve is a
 * development server, the development principal; the deployment acts for
 * nobody here, since no service of Luke's opens a coding turn without the
 * developer's request in hand. The channel's policy for a message that
 * arrives while a turn is under way is `steer`: the message joins the turn
 * at its next step, and a model call still generating is cut short and run
 * again with it, because a message to a coding agent is the developer's
 * word to act on now. Nothing is ever handed to eve to hold for later: eve
 * can neither withdraw nor edit a message once it queues one, so there is
 * no queue, and a developer who wants the agent to finish first waits to
 * send.
 */
const TURN_POLICY: TurnPolicy = BRAIN_HOST_TURN_POLICY.STEER;

export function coderChannelInput(
  resolveUserId: BearerAccount,
  ownership: SessionOwnership,
): EveChannelInput {
  return {
    auth: ownedAuth([lukeAccount(resolveUserId), localDev()], ownership),
    turnPolicy: TURN_POLICY,
    onMessage: (ctx) => ({ auth: messageAuth(ctx) }),
  };
}
