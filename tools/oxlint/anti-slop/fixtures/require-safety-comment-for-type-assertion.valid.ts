export interface SessionId {
  readonly value: string;
}

export function sessionIdFrom(raw: string): SessionId {
  // SAFETY: the roster validated this id against the provider's own read.
  return raw as SessionId;
}

/** A const assertion narrows rather than asserts, so it states no invariant. */
export const PROVIDERS = ["claude-code", "codex"] as const;
