import { isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The identities the runtime keeps apart, each a string with one meaning.
 * On the wire and in the database they are plain strings; in code each is a
 * branded string that only its own constructor can make, so a run cannot be
 * handed where a submission is expected without passing through the boundary
 * that says which it is. The constructors validate the one thing every
 * identifier shares — a non-empty string — and refuse anything else.
 *
 * - An agent owns a workspace, a configuration, and a memory.
 * - A session key is a logical conversation's stable address.
 * - A session id is one lifetime of that conversation; it changes on reset.
 * - A run is one accepted execution; a submission id is the caller's own
 *   retry identifier for the ask that opened it.
 * - A call id names one tool invocation within a run.
 * - A delivery id names one independently acknowledged delivery.
 */
declare const identifierBrand: unique symbol;

type Identifier<Brand extends string> = string & { readonly [identifierBrand]: Brand };

export type AgentId = Identifier<"agent">;
export type SessionKey = Identifier<"session-key">;
export type SessionId = Identifier<"session">;
export type RunId = Identifier<"run">;
export type SubmissionId = Identifier<"submission">;
export type CallId = Identifier<"call">;
export type DeliveryId = Identifier<"delivery">;

export function isIdentifier(value: UnparsedWireValue): value is string {
  return isWireString(value) && value.length > 0;
}

function identifier<Brand extends string>(kind: Brand, value: string): Identifier<Brand> {
  if (!isIdentifier(value)) throw new TypeError(`${kind} identifier must be a non-empty string`);
  // SAFETY: the brand is a compile-time tag; the check above is the whole runtime validation.
  return value as Identifier<Brand>;
}

export const agentId = (value: string): AgentId => identifier("agent", value);
export const sessionKey = (value: string): SessionKey => identifier("session-key", value);
export const sessionId = (value: string): SessionId => identifier("session", value);
export const runId = (value: string): RunId => identifier("run", value);
export const submissionId = (value: string): SubmissionId => identifier("submission", value);
export const callId = (value: string): CallId => identifier("call", value);
export const deliveryId = (value: string): DeliveryId => identifier("delivery", value);

/** The provider and provider-session pair that identifies an observed coding session. */
export interface SourceSessionRef {
  providerId: string;
  providerSessionId: string;
}

/** The one agent this build configures, and the name of its ordinary conversation. */
export const DEFAULT_AGENT_ID: AgentId = agentId("main");
export const MAIN_CONVERSATION_NAME = "main";

const SESSION_KEY_PREFIX = "agent";
const SESSION_KEY_SEPARATOR = ":";

/** The stable address of an agent's ordinary conversation: `agent:<agentId>:main`. */
export function mainSessionKey(agent: AgentId = DEFAULT_AGENT_ID): SessionKey {
  return sessionKey(
    [SESSION_KEY_PREFIX, agent, MAIN_CONVERSATION_NAME].join(SESSION_KEY_SEPARATOR),
  );
}

/** The default agent's ordinary conversation, the one every launch has and the talk key defaults to. */
export const MAIN_SESSION_KEY: SessionKey = mainSessionKey();

/**
 * What kind of conversation a session key addresses. Main is the agent's
 * ordinary conversation, and a thread is one the developer opened beside it.
 * A key this build cannot classify is kept by maintenance and never a
 * victim, because losing history is the worse failure.
 */
export const CONVERSATION_KIND = {
  MAIN: "main",
  THREAD: "thread",
  UNKNOWN: "unknown",
} as const;

export type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

const CONVERSATION_KIND_LIST: readonly ConversationKind[] = Object.values(CONVERSATION_KIND);

export function isConversationKind(value: UnparsedWireValue): value is ConversationKind {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && CONVERSATION_KIND_LIST.includes(value as ConversationKind);
}

const THREAD_SEGMENT = "thread";

/**
 * A private thread's stable address: `agent:<agentId>:thread:<threadId>`.
 * The thread id is minted by the host as a UUID, so nothing untrusted enters
 * the key; a reversible encoder for arbitrary provider ids arrives with the
 * observed conversations that need one.
 */
export function threadSessionKey(threadId: string, agent: AgentId = DEFAULT_AGENT_ID): SessionKey {
  if (!isIdentifier(threadId) || threadId.includes(SESSION_KEY_SEPARATOR)) {
    throw new TypeError("thread identifier must be a non-empty string without separators");
  }
  return sessionKey(
    [SESSION_KEY_PREFIX, agent, THREAD_SEGMENT, threadId].join(SESSION_KEY_SEPARATOR),
  );
}

/** The agent and the segments after it, for a key of the `agent:<id>:...` shape; nothing for any other. */
function parsedSessionKey(key: string): { agent: string; rest: readonly string[] } | undefined {
  const parts = key.split(SESSION_KEY_SEPARATOR);
  const [prefix, agent, ...rest] = parts;
  if (prefix !== SESSION_KEY_PREFIX || !agent || rest.length === 0) return undefined;
  return { agent, rest };
}

export function conversationKindOf(key: SessionKey | string): ConversationKind {
  const parsed = parsedSessionKey(key);
  if (!parsed) return CONVERSATION_KIND.UNKNOWN;
  const [head] = parsed.rest;
  if (parsed.rest.length === 1 && head === MAIN_CONVERSATION_NAME) return CONVERSATION_KIND.MAIN;
  if (head === THREAD_SEGMENT && parsed.rest.length === 2) return CONVERSATION_KIND.THREAD;
  return CONVERSATION_KIND.UNKNOWN;
}

/**
 * Where a run came from. Origin is attribution — it says who or what opened
 * the run, so the record and the thread can say so — and never by itself a
 * permission: what a run may do is decided by the policy that admits it.
 */
export const RUN_ORIGIN = {
  USER: "user",
  OBSERVATION: "observation",
  HEARTBEAT: "heartbeat",
  CRON: "cron",
  CHILD_COMPLETION: "child_completion",
  MAINTENANCE: "maintenance",
} as const;

export type RunOrigin = (typeof RUN_ORIGIN)[keyof typeof RUN_ORIGIN];

const RUN_ORIGIN_LIST: readonly RunOrigin[] = Object.values(RUN_ORIGIN);

export function isRunOrigin(value: UnparsedWireValue): value is RunOrigin {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && RUN_ORIGIN_LIST.includes(value as RunOrigin);
}
