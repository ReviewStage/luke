import type { BrainTurnTrigger } from "../../core.js";
import { BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER, type BrainTurnOrigin } from "../../core.js";

/**
 * The bounds and names the hosted brain host runs under: how a request names
 * the conversation and the kind of turn it opens, how long the runtime keeps
 * one session, and the workspace's label in the prompt. Every one is a
 * product knob as much as an implementation detail.
 */
export const BRAIN_HOST = {
  /** The name the prompt's workspace section gives the row-backed workspace; a label, never a path anything reads. */
  WORKSPACE_NAME: "workspace",
  /** The model's context window as the runtime is told it; the compaction threshold is a fraction of this. */
  MODEL_CONTEXT_WINDOW_TOKENS: 400_000,
  /** The fraction of the window at which eve folds the session's context. */
  COMPACTION_THRESHOLD: 0.8,
  /** How many stored messages the standing context carries of the recent exchange. */
  RECENT_MESSAGES: 20,
  /** The longest one recent message is rendered, in characters. */
  RECENT_MESSAGE_CHARS: 600,
  /** How many stored messages a rotated session is seeded with, newest last. */
  SEED_MESSAGES: 60,
  /** The longest the seed grows, in characters, cut from the front. */
  SEED_CHARS: 40_000,
  /** The most characters one observation turn's transcript delta carries per session. */
  TRANSCRIPT_DELTA_CHARS: 20_000,
} as const;

/** A conversation id as the header carries it: a uuid, and nothing else names a row. */
export const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request headers a client names the conversation and the turn's kind
 * with, and the one the deployment names the account it acts for with: read
 * only from a request the deployment's own credential admitted, never from
 * an account's bearer, whose account is the bearer's.
 */
export const BRAIN_HOST_HEADER = {
  CONVERSATION: "x-luke-conversation",
  TURN: "x-luke-turn",
  ACCOUNT: "x-luke-account",
} as const;

/** An account id as the header carries it: the auth service's own id shape, bounded, and nothing else names a user row. */
export const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The attribute names the session's auth carries those under, for the
 * session's life: the conversation and the turn from any request's headers,
 * and the acted-for account only on a principal the deployment's own
 * credential minted, never laid over from a request.
 */
export const BRAIN_HOST_ATTRIBUTE = {
  CONVERSATION: "luke:conversation",
  TURN: "luke:turn",
  ACCOUNT: "luke:account",
} as const;

/**
 * The authenticator names the door admits a principal under: an account's
 * own bearer, or the deployment acting for an account it names under the
 * deployment's one secret. The deployment's name is one name whatever role
 * it acts in — the scheduled observation today, the voice service next —
 * because one secret proves no more than that something holding it acted;
 * which role is the turn kind on the principal, recorded as such, and never
 * a name the credential cannot support.
 */
export const BRAIN_HOST_AUTHENTICATOR = {
  ACCOUNT: "luke-account",
  DEPLOYMENT: "luke-deployment",
} as const;

/**
 * The principal types the door mints, in eve's own vocabulary: a person for
 * an account's bearer, a service for the deployment acting for an account.
 * The two are different types rather than one type with a flag, so a reader
 * of a session's initiator can tell a developer's opening from the
 * deployment's without remembering to check a field.
 */
export const BRAIN_HOST_PRINCIPAL_TYPE = {
  ACCOUNT: "user",
  DEPLOYMENT: "service",
} as const;

/** The one principal id the deployment acts under; the account it acts for is its attribute, never its id. */
export const BRAIN_HOST_DEPLOYMENT_PRINCIPAL = "luke-deployment";

/** What kind of turn a request opens, as the header names it. */
export const BRAIN_HOST_TURN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  OBSERVATION: "observation",
  /** A hold's release: the briefings a meeting or a pause held back, handed to the conversation that decided them for one re-decision. */
  HOLD_RELEASE: "hold_release",
} as const;

export type BrainHostTurn = (typeof BRAIN_HOST_TURN)[keyof typeof BRAIN_HOST_TURN];

const BRAIN_HOST_TURN_LIST: readonly string[] = Object.values(BRAIN_HOST_TURN);

export function isBrainHostTurn(value: string): value is BrainHostTurn {
  return BRAIN_HOST_TURN_LIST.includes(value);
}

/** The run stream's origin and trigger for each kind of turn a request opens. */
export const BRAIN_HOST_TURN_KIND = {
  [BRAIN_HOST_TURN.TYPED]: { origin: BRAIN_TURN_ORIGIN.TYPED, trigger: BRAIN_TURN_TRIGGER.ASK },
  [BRAIN_HOST_TURN.SPOKEN]: { origin: BRAIN_TURN_ORIGIN.SPOKEN, trigger: BRAIN_TURN_TRIGGER.ASK },
  [BRAIN_HOST_TURN.OBSERVATION]: {
    origin: BRAIN_TURN_ORIGIN.OBSERVATION,
    trigger: BRAIN_TURN_TRIGGER.ROSTER,
  },
  [BRAIN_HOST_TURN.HOLD_RELEASE]: {
    origin: BRAIN_TURN_ORIGIN.HOLD_RELEASE,
    trigger: BRAIN_TURN_TRIGGER.HOLD_RELEASED,
  },
} as const satisfies Record<
  BrainHostTurn,
  { readonly origin: BrainTurnOrigin; readonly trigger: BrainTurnTrigger }
>;

/** The environment the host reads beside the names every hosted route already honours. */
export const BRAIN_HOST_ENVIRONMENT = {
  /** Selects the scripted fixture model in place of OpenAI; set only by the fixture eval. */
  MODEL_FIXTURE: "LUKE_BRAIN_MODEL_FIXTURE",
  /** The origin the ask routes reach eve on; unset, eve is the deployment's own origin behind its `/eve/v1/*` rewrite. */
  EVE_ORIGIN: "LUKE_EVE_ORIGIN",
} as const;

/** The one fixture the model environment may name, and the model id its turns are recorded under. */
export const BRAIN_HOST_MODEL_FIXTURE = {
  SCRIPTED: "scripted",
  SCRIPTED_MODEL_ID: "luke-scripted",
} as const;

/** Why the host refused a request's standing, in words the model or a route can read. */
export const BRAIN_HOST_REFUSAL = {
  NO_PRINCIPAL: "Not run: the session has no signed-in account.",
  NO_CONVERSATION: "Not run: the session names no conversation of this account.",
  NOT_OWNER: "Not run: this conversation belongs to another account.",
  NOT_INITIATOR: "Not run: this session was opened by another account.",
  NO_TURN_KIND: "Not run: the request names no kind of turn.",
  NO_ACCOUNT: "Not run: the deployment's request names no account.",
  NOT_DEPLOYMENT_ACT: "Not run: the deployment may only open the turns it is admitted for.",
  NO_MODEL: "Not run: this deployment holds no model key, so the hosted brain is off.",
  NOT_CURRENT_SESSION: "Not run: this conversation runs in another session now.",
} as const;

export type BrainHostRefusal = (typeof BRAIN_HOST_REFUSAL)[keyof typeof BRAIN_HOST_REFUSAL];
