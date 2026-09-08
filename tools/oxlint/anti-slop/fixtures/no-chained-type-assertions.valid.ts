export interface SessionId {
  readonly value: string;
}

export function sessionIdFrom(raw: string): SessionId {
  // SAFETY: the roster validated this id against the provider's own read.
  return raw as SessionId;
}

/** A chain that discards no evidence: every link of it is a const assertion. */
export const PROVIDERS = ["claude-code", "codex"] as const as const;
