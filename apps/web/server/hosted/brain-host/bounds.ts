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

/** The request headers a client names the conversation and the turn's kind with. */
export const BRAIN_HOST_HEADER = {
  CONVERSATION: "x-luke-conversation",
  TURN: "x-luke-turn",
} as const;

/** The attribute names the session's auth carries those two under, for the session's life. */
export const BRAIN_HOST_ATTRIBUTE = {
  CONVERSATION: "luke:conversation",
  TURN: "luke:turn",
} as const;

/** The authenticator name a Luke account bearer is admitted under. */
export const BRAIN_HOST_AUTHENTICATOR = "luke-account";

/** The principal type every account principal carries; eve's own vocabulary for a person. */
export const BRAIN_HOST_PRINCIPAL_TYPE = "user";

/** What kind of turn a request opens, as the header names it. */
export const BRAIN_HOST_TURN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  OBSERVATION: "observation",
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
} as const satisfies Record<
  BrainHostTurn,
  { readonly origin: BrainTurnOrigin; readonly trigger: BrainTurnTrigger }
>;

/** The environment the host reads beside the names every hosted route already honours. */
export const BRAIN_HOST_ENVIRONMENT = {
  /** Selects the scripted fixture model in place of OpenAI; set only by the fixture eval. */
  MODEL_FIXTURE: "LUKE_BRAIN_MODEL_FIXTURE",
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
  NO_MODEL: "Not run: this deployment holds no model key, so the hosted brain is off.",
  NOT_CURRENT_SESSION: "Not run: this conversation runs in another session now.",
} as const;

export type BrainHostRefusal = (typeof BRAIN_HOST_REFUSAL)[keyof typeof BRAIN_HOST_REFUSAL];
