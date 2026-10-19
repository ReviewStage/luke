import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
} from "@luke/features/coding-agent-wire";
import type { TurnPolicy } from "eve/channels";
import { localDev } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import {
  type BearerAccount,
  DEPLOYMENT_ACT,
  type DeploymentActor,
  type DeploymentTurnTable,
  deploymentActor,
  lukeAccount,
} from "../brain-host/auth.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { BRAIN_HOST_TURN_POLICY } from "../brain-host/channel.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "../brain-host/door.js";

/**
 * channel.ts -- how the coding-agent service's eve channel is configured.
 *
 * The same door as the brain's (`brain-host/door.ts`): whoever the
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
 * What else the deployment does here is carry the three things the voice brain does for the
 * developer in a planning call, and a coding agent does for the member who
 * started it (`agents/coding-agent-tools.ts`), since neither session holds
 * a bearer of the account's: a message it sends an
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
 * agent is gone and no message reaches it.
 */
const TURN_POLICY: TurnPolicy = BRAIN_HOST_TURN_POLICY.STEER;

/**
 * The files eve takes on a message: the images and PDFs the message route
 * admits, no larger than the largest of them, where eve's default takes 25
 * MB of anything. A text file never reaches eve as a file, since the route
 * inlines it as text (`attached-files.ts`).
 */
const UPLOAD_POLICY = {
  maxBytes: CODING_AGENT_BOUNDS.MAX_PDF_BYTES,
  allowedMediaTypes: [
    CODING_AGENT_ATTACHMENT_TYPE.PNG,
    CODING_AGENT_ATTACHMENT_TYPE.JPEG,
    CODING_AGENT_ATTACHMENT_TYPE.WEBP,
    CODING_AGENT_ATTACHMENT_TYPE.PDF,
  ],
} as const;

/**
 * The two rows the deployment is admitted for here, each the typed line
 * alone, because a coding agent has no spoken turn. The follow-up is a
 * message the voice brain or another coding agent sends an agent
 * (`coding-agent-tools.ts`'s `message_agent`), delivered exactly as one the
 * developer typed in the message box, on a session the named account's
 * agent recorded. The opening is the start of an agent the voice brain or
 * another coding agent makes for the member (`start_agent`),
 * on the one path a Start takes (`coder-host/start.ts`): the row the Start
 * made stands before eve is asked, so the door's ownership check bounds the
 * opening to a conversation the named account owns, as it bounds every
 * caller. On this channel, and this one alone,
 * the deployment presents the account's own identity
 * (`DEPLOYMENT_PRESENCE.ACCOUNT`): eve steers a running turn only with a
 * message whose principal is the turn's own, and an agent's turn runs under
 * the developer's bearer, so the voice steer is minted as the developer's
 * own tuple, authenticator, type, and id, and the record says the
 * deployment carried it in the `luke:carrier` attribute rather than in the
 * principal; the opening is minted the same way, so the agent's session
 * runs as the developer whether the developer or Luke started it. A caller
 * of another role adds its row here and nowhere else.
 * Note that the table holds no row for a cancel or a reset, and needs none:
 * neither opens a turn, so the deployment's authenticator admits both on
 * every channel without asking the table (`brain-host/auth.ts`), and here
 * mints them as the account's own principal like the rest. What bounds them
 * is the door's ownership check, which admits them only on a session a
 * conversation the named account reaches recorded. A cancel is how a
 * continue the voice brain or a coding agent starts (`start_agent`'s `from`)
 * stops the agent it took over from, as the developer's own Stop would
 * (`coder-host/start.ts`); a reset is how a task's delete or an account's
 * deletion a browser asked for retires an agent's session
 * (`agents/retire-sessions.ts`).
 */
export const CODER_DEPLOYMENT_TURNS = {
  [DEPLOYMENT_ACT.OPEN]: {
    [BRAIN_HOST_TURN.TYPED]: true,
    [BRAIN_HOST_TURN.SPOKEN]: false,
  },
  [DEPLOYMENT_ACT.FOLLOW_UP]: {
    [BRAIN_HOST_TURN.TYPED]: true,
    [BRAIN_HOST_TURN.SPOKEN]: false,
  },
} as const satisfies DeploymentTurnTable;

export function coderChannelInput(
  resolveUserId: BearerAccount,
  ownership: SessionOwnership,
  deployment: DeploymentActor,
  sessionEnded: (sessionId: string) => Promise<void>,
): EveChannelInput {
  return {
    auth: ownedAuth(
      [deploymentActor(deployment), lukeAccount(resolveUserId), localDev()],
      ownership,
    ),
    turnPolicy: TURN_POLICY,
    uploadPolicy: UPLOAD_POLICY,
    onMessage: (ctx) => ({ auth: messageAuth(ctx) }),
    events: {
      "session.failed": (data) => sessionEnded(data.sessionId),
      "session.completed": (_data, _channel, ctx) => sessionEnded(ctx.session.id),
    },
  };
}
