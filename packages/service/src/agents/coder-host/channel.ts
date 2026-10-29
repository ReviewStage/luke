import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS } from "@luke/features/agent-wire";
import type { TurnPolicy } from "eve/channels";
import { localDev } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import {
  type BearerAccount,
  DEPLOYMENT_ACT,
  DEPLOYMENT_PRESENCE,
  type DeploymentActor,
  type DeploymentTurnTable,
  deploymentActor,
  lukeAccount,
} from "../eve-host/auth.js";
import { EVE_HOST_TURN } from "../eve-host/bounds.js";
import { EVE_HOST_TURN_POLICY } from "../eve-host/channel.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "../eve-host/door.js";
import type { EveFailure } from "../eve-host/relay.js";

/**
 * channel.ts -- how the coding-agent service's eve channel is configured.
 *
 * The same door as the brain's (`eve-host/door.ts`): whoever the
 * inner walk admits is refused for a session or a conversation that is not
 * theirs before any route runs, and every message carries the request's
 * conversation and turn kind into the session's auth. Who walks in is the
 * same walk too, in the same order: the deployment acting for an account
 * first, over the two-row table below, then the account's bearer, then,
 * where eve is a development server, the development principal. A coding
 * agent is started, messaged, and stopped by routes that reach eve as the
 * developer: over the developer's own bearer, or, where a browser reached
 * the route on its session cookie alone, as the deployment acting for the
 * account the cookie named (`stop.ts`'s `eveFor`), on the same rows below.
 * What else the deployment does here is carry the three things a coding
 * agent does for the member who started it (`agents/agent-tools.ts`),
 * since its session holds no bearer of the account's: a message it sends an
 * agent, admitted only on a session the named account's agent recorded, the
 * opening that starts an agent, admitted only on a conversation the named
 * account owns, as every other caller is, and the cancel that stops the
 * agent a continue took over from, admitted only on a session the named
 * account reaches. The channel's policy for a message that
 * arrives while a turn is under way is `steer`: the message joins the turn
 * at its next step, and a model call still generating is cut short and run
 * again with it, because a message to a coding agent is the developer's
 * word to act on now. Nothing is ever handed to eve to hold for later: eve
 * can neither withdraw nor edit a message once it queues one, so there is
 * no queue, and a developer who wants the agent to finish first waits to
 * send.
 *
 * The channel also hears the end of a session, which eve tells only its
 * channel adapter and never the stream-event hooks the relay is fed from
 * (`eve/execution/publish-session-events`'s `publishTerminalSessionEvent`):
 * `session.failed` where the session's run threw, and `session.completed`
 * where it expired. Either way nothing will end a turn the session
 * was still running, so each is handed to `sessionEnded`, which settles that
 * turn failed for its session's end (`host.ts`'s `sessionEnded`) and the
 * agent reads as failed at once. A completed session is settled with the
 * same word as a failed one, because to the developer the two are one: the
 * agent is gone and no message reaches it. A failed session hands on eve's
 * code and message too, which the turn keeps as why it failed.
 */
const TURN_POLICY: TurnPolicy = EVE_HOST_TURN_POLICY.STEER;

/**
 * The files eve takes on a message: the images and PDFs the message route
 * admits, no larger than the largest of them, where eve's default takes 25
 * MB of anything. A text file never reaches eve as a file, since the route
 * inlines it as text (`attached-files.ts`).
 */
const UPLOAD_POLICY = {
  maxBytes: AGENT_BOUNDS.MAX_PDF_BYTES,
  allowedMediaTypes: [
    AGENT_ATTACHMENT_TYPE.PNG,
    AGENT_ATTACHMENT_TYPE.JPEG,
    AGENT_ATTACHMENT_TYPE.WEBP,
    AGENT_ATTACHMENT_TYPE.PDF,
  ],
} as const;

/**
 * The two rows the deployment is admitted for here, each the typed line
 * alone. The typed follow-up is another agent's message to an agent
 * (`agent-message.ts`), delivered exactly as one the developer typed in the
 * message box, on a session the named account's agent recorded. The typed
 * opening is the start of an agent another coding agent makes for the
 * member (`start_agent`), on the one path a Start takes
 * (`coder-host/start.ts`): the row the Start made stands before eve is
 * asked, so the door's ownership check bounds the opening to a
 * conversation the named account owns, as it bounds every caller. A typed
 * message presents the account's own identity (`eve-host/auth.ts`'s
 * `DEPLOYMENT_PRESENCE`): eve steers a running turn only with a message
 * whose principal is the turn's own, and an agent's turn runs under the
 * developer's bearer, so the message is minted as the developer's own
 * tuple, authenticator, type, and id, and the record says the deployment
 * carried it in the `luke:carrier` attribute rather than in the principal;
 * the opening is minted the same way, so the agent's session runs as the
 * developer whether the developer or Luke started it. A caller of another role
 * adds its row here and nowhere else.
 * Note that the table holds no row for a cancel or a reset, and needs none:
 * neither opens a turn, so the deployment's authenticator admits both on
 * every channel without asking the table (`eve-host/auth.ts`). What
 * bounds them is the door's ownership check, which admits them only on a
 * session a conversation the named account reaches recorded. A cancel is
 * how a continue a coding agent starts (`start_agent`'s `from`) stops the
 * agent it took over from, as the developer's own Stop would
 * (`coder-host/start.ts`); a reset is how a task's delete or an account's
 * deletion a browser asked for retires an agent's session
 * (`agents/retire-sessions.ts`).
 */
export const CODER_DEPLOYMENT_TURNS = {
  [DEPLOYMENT_ACT.OPEN]: { [EVE_HOST_TURN.TYPED]: true },
  [DEPLOYMENT_ACT.FOLLOW_UP]: { [EVE_HOST_TURN.TYPED]: true },
} as const satisfies DeploymentTurnTable;

/**
 * Whose identity the deployment presents here: the account's, with the
 * deployment named as its carrier. eve steers a running turn only with a
 * message whose principal is the turn's own (`eve-host/auth.ts`'s
 * `DEPLOYMENT_PRESENCE`), and an agent's turn runs under the developer's
 * bearer, so another agent's message joins the turn under way at its next
 * step, as a line the developer typed does. A cancel and a reset are minted
 * as the account's too, which eve's cancel and reset routes read nothing of.
 */
export const CODER_DEPLOYMENT_PRESENCE = DEPLOYMENT_PRESENCE.ACCOUNT;

export function coderChannelInput(
  resolveUserId: BearerAccount,
  ownership: SessionOwnership,
  deployment: DeploymentActor,
  sessionEnded: (sessionId: string, failed?: EveFailure) => Promise<void>,
): EveChannelInput {
  return {
    auth: ownedAuth(
      [deploymentActor(deployment), lukeAccount(resolveUserId), localDev()],
      ownership,
    ),
    turnPolicy: TURN_POLICY,
    uploadPolicy: UPLOAD_POLICY,
    onMessage: (context) => ({ auth: messageAuth(context) }),
    events: {
      "session.failed": (data) => sessionEnded(data.sessionId, data),
      "session.completed": (_data, _channel, ctx) => sessionEnded(ctx.session.id),
    },
  };
}
