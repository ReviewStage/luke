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
 * ordinary conversation; a thread is one the developer opened beside it; an
 * observed conversation follows one coding session. A key this build cannot
 * classify is kept by maintenance and never a victim, because losing a conversation
 * is the worse failure.
 */
export const CONVERSATION_KIND = {
  MAIN: "main",
  THREAD: "thread",
  OBSERVED: "observed",
  /** A child's conversation: delegated work of the same agent, archived on the child service's clock. */
  CHILD: "child",
  UNKNOWN: "unknown",
} as const;

export type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

const CONVERSATION_KIND_LIST: readonly ConversationKind[] = Object.values(CONVERSATION_KIND);

export function isConversationKind(value: UnparsedWireValue): value is ConversationKind {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && CONVERSATION_KIND_LIST.includes(value as ConversationKind);
}

const THREAD_SEGMENT = "thread";
const OBSERVED_SEGMENT = "observed";
const SUBAGENT_SEGMENT = "subagent";

/**
 * A private thread's stable address: `agent:<agentId>:thread:<threadId>`.
 * The thread id is minted by the host as a UUID, so nothing untrusted enters
 * the key; an observed conversation's provider ids go through the encoder
 * below instead.
 */
export function threadSessionKey(threadId: string, agent: AgentId = DEFAULT_AGENT_ID): SessionKey {
  if (!isIdentifier(threadId) || threadId.includes(SESSION_KEY_SEPARATOR)) {
    throw new TypeError("thread identifier must be a non-empty string without separators");
  }
  return sessionKey(
    [SESSION_KEY_PREFIX, agent, THREAD_SEGMENT, threadId].join(SESSION_KEY_SEPARATOR),
  );
}

/** A child's conversation: `agent:<agentId>:subagent:<childId>`, the id minted by the host. */
export function childSessionKey(childId: string, agent: AgentId = DEFAULT_AGENT_ID): SessionKey {
  if (!isIdentifier(childId) || childId.includes(SESSION_KEY_SEPARATOR)) {
    throw new TypeError("child identifier must be a non-empty string without separators");
  }
  return sessionKey(
    [SESSION_KEY_PREFIX, agent, SUBAGENT_SEGMENT, childId].join(SESSION_KEY_SEPARATOR),
  );
}

/** The child id a key addresses, or nothing for a key of any other shape. */
export function childIdOf(key: SessionKey | string): string | undefined {
  const parsed = parsedSessionKey(key);
  const [segment, childId] = parsed?.rest ?? [];
  return parsed?.rest.length === 2 && segment === SUBAGENT_SEGMENT ? childId : undefined;
}

/**
 * The reversible encoding a provider's own identifiers take inside a session
 * key. A provider id or a provider's session id is untrusted text that may
 * carry the key's own separator or anything else; each is percent-encoded so
 * that only unreserved characters stand bare, the key splits on its separator
 * exactly as a key with fixed segments does, and the original is read back
 * with no ambiguity. Encoding twice never collides with encoding once: the
 * percent sign is itself encoded.
 */
export function encodeKeyComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The component as it was before encoding, or nothing for text the encoder never produced. */
export function decodeKeyComponent(encoded: string): string | undefined {
  if (encoded.length === 0 || /[^A-Za-z0-9._~%-]/.test(encoded)) return undefined;
  try {
    const decoded = decodeURIComponent(encoded);
    return encodeKeyComponent(decoded) === encoded ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An observed coding session's conversation:
 * `agent:<agentId>:observed:<encoded-provider-id>:<encoded-session-id>`. The
 * two provider components go through the encoder, never straight into the
 * key, and come back out of it through `observedSessionRefOf`.
 */
export function observedSessionKey(
  source: SourceSessionRef,
  agent: AgentId = DEFAULT_AGENT_ID,
): SessionKey {
  if (!isIdentifier(source.providerId) || !isIdentifier(source.providerSessionId)) {
    throw new TypeError("an observed session needs a provider id and a provider session id");
  }
  return sessionKey(
    [
      SESSION_KEY_PREFIX,
      agent,
      OBSERVED_SEGMENT,
      encodeKeyComponent(source.providerId),
      encodeKeyComponent(source.providerSessionId),
    ].join(SESSION_KEY_SEPARATOR),
  );
}

/** The observed session a key addresses, or nothing for a key of any other shape. */
export function observedSessionRefOf(key: SessionKey | string): SourceSessionRef | undefined {
  const parsed = parsedSessionKey(key);
  if (parsed?.rest.length !== 3 || parsed.rest[0] !== OBSERVED_SEGMENT) return undefined;
  const providerId = decodeKeyComponent(parsed.rest[1] ?? "");
  const providerSessionId = decodeKeyComponent(parsed.rest[2] ?? "");
  if (providerId === undefined || providerSessionId === undefined) return undefined;
  return { providerId, providerSessionId };
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
  if (head === OBSERVED_SEGMENT) {
    return observedSessionRefOf(key) ? CONVERSATION_KIND.OBSERVED : CONVERSATION_KIND.UNKNOWN;
  }
  if (head === SUBAGENT_SEGMENT && parsed.rest.length === 2) return CONVERSATION_KIND.CHILD;
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
  /** A child's own run, opened by its requester's spawn. */
  CHILD: "child",
  CHILD_COMPLETION: "child_completion",
  MAINTENANCE: "maintenance",
} as const;

export type RunOrigin = (typeof RUN_ORIGIN)[keyof typeof RUN_ORIGIN];

const RUN_ORIGIN_LIST: readonly RunOrigin[] = Object.values(RUN_ORIGIN);

export function isRunOrigin(value: UnparsedWireValue): value is RunOrigin {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && RUN_ORIGIN_LIST.includes(value as RunOrigin);
}
