import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";

export type NativeRuntime = Exclude<ConversationRuntime, typeof CONVERSATION_RUNTIME.EVE>;

export const NATIVE_SESSION_PREFIX = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: "claude-code-",
  [CONVERSATION_RUNTIME.CODEX]: "codex-",
} as const satisfies Record<NativeRuntime, string>;

const NATIVE_SESSION_PREFIX_BEFORE_RENAME = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: "luke-claude-code-",
  [CONVERSATION_RUNTIME.CODEX]: "luke-codex-",
} as const satisfies Record<NativeRuntime, string>;

export function nativeRuntimeOfSession(sessionId: string): NativeRuntime | undefined {
  for (const prefixes of [NATIVE_SESSION_PREFIX, NATIVE_SESSION_PREFIX_BEFORE_RENAME]) {
    for (const [runtime, prefix] of Object.entries(prefixes)) {
      if (sessionId.startsWith(prefix)) return runtime as NativeRuntime;
    }
  }
  return undefined;
}

export function harnessOf(runtime: ConversationRuntime | undefined): NativeRuntime | undefined {
  return runtime === CONVERSATION_RUNTIME.CLAUDE_CODE || runtime === CONVERSATION_RUNTIME.CODEX
    ? runtime
    : undefined;
}
