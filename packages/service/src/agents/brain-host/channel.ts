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
} from "./auth.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { messageAuth, ownedAuth, type SessionOwnership } from "./door.js";

/** The two ways eve can take a message that arrives while the session's turn is under way. */
export const BRAIN_HOST_TURN_POLICY = {
  /** The message joins the turn under way: a parked turn resumes on it at once, and a model call still generating is cut short and run again with it. */
  STEER: "steer",
  /** The message waits for the turn to end and opens the next. */
  QUEUE: "queue",
} as const satisfies Record<string, TurnPolicy>;

/**
 * The policy the brain channel runs under. Note that it is `steer`,
 * because a brain turn that handed work to the worker stays open until
 * the worker's result reaches the model inside it (eve runs every subagent
 * call as a task the turn waits on), and a spoken follow-up under `queue`
 * would wait out that research, minutes of it, before Luke read it; under
 * `steer` the parked turn takes the follow-up at once, answers it, parks
 * again, and the worker's result still lands in the same turn, which is
 * what the scripted model showed when the two were tried against it. What
 * `steer` costs is the case the queue was chosen for: a follow-up that
 * arrives while the model is still generating cuts that call short, and
 * the correction runs in the same turn. A message steers only from the
 * principal the turn runs under, so a typed ask during a spoken turn, and
 * the reverse, still waits, whether the typed ask came over the member's
 * bearer or as the deployment carrying it for a browser's session cookie,
 * which presents the member's own principal (`auth.ts`'s
 * `DEPLOYMENT_PRESENCE`). Either value stands here; the relay binds a
 * joining ask the moment eve names its delivery (`relay.ts`).
 */
const TURN_POLICY: TurnPolicy = BRAIN_HOST_TURN_POLICY.STEER;

/**
 * How the eve channel is configured: the deployment acting for an account
 * first, then a Luke account's bearer, then the development principal only
 * where eve is a development server, and the turn policy above for a message
 * that arrives while a turn is under way. The
 * deployment goes first because it refuses rather than skips a request under
 * its secret that asks for anything but the turns its table admits, a
 * cancel of a turn, or a reset of a session, and a later entry must not get
 * the chance to read that request as something else; for the same reason
 * there is one of it, over
 * one table, and a deployment-side caller that needs another kind of turn
 * adds a row.
 * Ownership stands at the door: whoever the inner walk admits is refused for
 * a session or a conversation that is not theirs before any route runs.
 * Every message carries the request's conversation and turn kind into the
 * session's auth, where the host reads them back, and a message naming no
 * kind of turn is refused before it dispatches.
 */
export function brainHostChannelInput(
  resolveUserId: BearerAccount,
  ownership: SessionOwnership,
  deployment: DeploymentActor,
): EveChannelInput {
  return {
    auth: ownedAuth(
      [deploymentActor(deployment), lukeAccount(resolveUserId), localDev()],
      ownership,
    ),
    turnPolicy: TURN_POLICY,
    onMessage: (ctx) => ({ auth: messageAuth(ctx) }),
  };
}

/**
 * The kinds of turn the deployment may open or follow up for an account, in
 * the roles it acts in, whether the message opens the session or follows it
 * up. A spoken ask is the voice function's, handed to eve for the account
 * it resolved at its own handshake and holds no bearer for by the time a
 * delegation arrives. A typed ask is a member's own words to Luke, which a
 * comment that mentions him hands over (`tasks/comment-ask.ts`): over the
 * member's own bearer from the desktop, which needs no row, and from a
 * hosted route a browser reached on its session cookie alone as the
 * deployment acting for the account the cookie named (`coder-host/stop.ts`'s
 * `eveFor`), since eve takes no cookie. The two present different
 * identities (`auth.ts`'s `DEPLOYMENT_PRESENCE`): a spoken ask the
 * deployment's own, and a typed ask the member's, minted as their own
 * principal with the deployment as its carrier, so it waits behind a call's
 * spoken turn, and joins only the member's own typed turn, exactly as their
 * bearer's would. A row admits anything that holds the secret, whatever role
 * it acts in, so what keeps the deployment's typed asks to a comment's is the
 * code: no code path but the comment hand-over sends one, and the voice
 * function's client is typed to send none (`voice/deployment-exchange.ts`).
 * What else such a route asks of eve needs no row: a plan's
 * Stop, which is a cancel, and a delete's retire, which is a reset. A
 * caller of another role adds its row here and nowhere else; the coder
 * channel keeps a table of its own (`coder-host/channel.ts`).
 */
export const DEPLOYMENT_TURNS = {
  [DEPLOYMENT_ACT.OPEN]: {
    [BRAIN_HOST_TURN.TYPED]: true,
    [BRAIN_HOST_TURN.SPOKEN]: true,
  },
  [DEPLOYMENT_ACT.FOLLOW_UP]: {
    [BRAIN_HOST_TURN.TYPED]: true,
    [BRAIN_HOST_TURN.SPOKEN]: true,
  },
} as const satisfies DeploymentTurnTable;
