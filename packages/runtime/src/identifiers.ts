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

const agentId = (value: string): AgentId => identifier("agent", value);
export const sessionKey = (value: string): SessionKey => identifier("session-key", value);

/** The one agent this build configures. */
export const DEFAULT_AGENT_ID: AgentId = agentId("main");
