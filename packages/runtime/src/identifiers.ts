import { isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The identities the runtime keeps apart, each a string with one meaning.
 * On the wire and in the database they are plain strings; in code each is a
 * branded string that only its own constructor can make, so an agent cannot
 * be handed where a conversation's address is expected without passing
 * through the boundary that says which it is. The constructors validate the
 * one thing every identifier shares — a non-empty string — and refuse
 * anything else.
 *
 * - An agent owns a workspace, a configuration, and a memory.
 * - A session key is a logical conversation's stable address.
 */
declare const identifierBrand: unique symbol;

type Identifier<Brand extends string> = string & { readonly [identifierBrand]: Brand };

export type AgentId = Identifier<"agent">;
export type SessionKey = Identifier<"session-key">;

function isIdentifier(value: UnparsedWireValue): value is string {
  return isWireString(value) && value.length > 0;
}

function identifier<Brand extends string>(kind: Brand, value: string): Identifier<Brand> {
  if (!isIdentifier(value)) throw new TypeError(`${kind} identifier must be a non-empty string`);
  // SAFETY: the brand is a compile-time tag; the check above is the whole runtime validation.
  return value as Identifier<Brand>;
}

export const agentId = (value: string): AgentId => identifier("agent", value);
export const sessionKey = (value: string): SessionKey => identifier("session-key", value);

/** The one agent this build configures, and the name of its ordinary conversation. */
export const DEFAULT_AGENT_ID: AgentId = agentId("main");
const MAIN_CONVERSATION_NAME = "main";

const SESSION_KEY_PREFIX = "agent";
const SESSION_KEY_SEPARATOR = ":";

/**
 * The default agent's ordinary conversation, the one every launch has and the
 * talk key defaults to: `agent:<agentId>:main`.
 */
export const MAIN_SESSION_KEY: SessionKey = sessionKey(
  [SESSION_KEY_PREFIX, DEFAULT_AGENT_ID, MAIN_CONVERSATION_NAME].join(SESSION_KEY_SEPARATOR),
);

/**
 * What kind of conversation a record names. Main is the agent's ordinary
 * conversation; a thread is one the developer opened beside it; an observed
 * conversation follows one coding session. `UNKNOWN` is what a reader answers
 * for a kind it cannot place, because losing a conversation is the worse
 * failure.
 */
export const CONVERSATION_KIND = {
  MAIN: "main",
  THREAD: "thread",
  OBSERVED: "observed",
  /** A child's conversation: delegated work of the same agent. */
  CHILD: "child",
  UNKNOWN: "unknown",
} as const;

export type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

const SUBAGENT_SEGMENT = "subagent";

/** A child's conversation: `agent:<agentId>:subagent:<childId>`, the id being that conversation's uuid. */
export function childSessionKey(childId: string, agent: AgentId = DEFAULT_AGENT_ID): SessionKey {
  if (!isIdentifier(childId) || childId.includes(SESSION_KEY_SEPARATOR)) {
    throw new TypeError("child identifier must be a non-empty string without separators");
  }
  return sessionKey(
    [SESSION_KEY_PREFIX, agent, SUBAGENT_SEGMENT, childId].join(SESSION_KEY_SEPARATOR),
  );
}

/**
 * Where a run came from. Origin is attribution — it says who or what opened
 * the run, so the record and the thread can say so — and never by itself a
 * permission: what a run may do is decided by the policy that admits it.
 */
export const RUN_ORIGIN = {
  USER: "user",
  OBSERVATION: "observation",
  /** A child's own run, opened by its requester's spawn. */
  CHILD: "child",
  CHILD_COMPLETION: "child_completion",
  MAINTENANCE: "maintenance",
} as const;

export type RunOrigin = (typeof RUN_ORIGIN)[keyof typeof RUN_ORIGIN];
