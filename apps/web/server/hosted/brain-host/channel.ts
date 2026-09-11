import { localDev } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import type { UserInfoEndpoint } from "../bearer.js";
import { lukeAccount } from "./auth.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "./door.js";

/**
 * How the eve channel is configured: a Luke account's bearer first, the
 * development principal only where eve is a development server, and a queue
 * for follow-ups, so an ask that arrives while a turn is under way waits for
 * it rather than cutting it short; steering is for an explicit cancel and
 * never the default. Ownership stands at the door: whoever the inner walk
 * admits is refused for a session or a conversation that is not theirs
 * before any route runs. Every message carries the request's conversation
 * and turn kind into the session's auth, where the host reads them back,
 * and a message naming no kind of turn is refused before it dispatches.
 */
export function brainHostChannelInput(
  userInfo: UserInfoEndpoint,
  ownership: SessionOwnership,
): EveChannelInput {
  return {
    auth: ownedAuth([lukeAccount(userInfo), localDev()], ownership),
    turnPolicy: "queue",
    onMessage: (ctx) => ({ auth: messageAuth(ctx) }),
  };
}
