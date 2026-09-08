export interface SessionId {
  readonly value: string;
}

export function sessionIdFrom(raw: string): SessionId {
  return raw as SessionId;
}
