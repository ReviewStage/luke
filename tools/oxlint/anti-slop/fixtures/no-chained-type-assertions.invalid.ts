export interface SessionId {
  readonly value: string;
}

export function sessionIdFrom(raw: string): SessionId {
  // SAFETY: the fixture exercises the chain, so the assertion is justified here
  // and only `no-chained-type-assertions` may report it.
  return raw as string as SessionId;
}
