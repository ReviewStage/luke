import { isWireString, type UnparsedWireValue } from "@repo/wire";

declare const identifierBrand: unique symbol;

type Identifier<Brand extends string> = string & { readonly [identifierBrand]: Brand };

export type AgentId = Identifier<"agent">;
export type SessionKey = Identifier<"session-key">;

function isIdentifier(value: UnparsedWireValue): value is string {
  return isWireString(value) && value.length > 0;
}

function identifier<Brand extends string>(kind: Brand, value: string): Identifier<Brand> {
  if (!isIdentifier(value)) throw new TypeError(`${kind} identifier must be a non-empty string`);
  return value as Identifier<Brand>;
}

const agentId = (value: string): AgentId => identifier("agent", value);
export const sessionKey = (value: string): SessionKey => identifier("session-key", value);

export const DEFAULT_AGENT_ID: AgentId = agentId("main");
