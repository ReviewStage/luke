/**
 * native-runtime.ts -- the native harnesses a coding agent's conversation may run on, and the sessions Luke mints for them, told apart by their ids.
 *
 * A conversation's `runtime` (`conversations.runtime`) says which
 * implementation of `AgentSessions` answers it: eve, or one of the native
 * harnesses here. A native harness's session is Luke's own, minted as it
 * opens with the harness's prefix (`runner-sessions.ts`), so a call that
 * names a session and no conversation, a cancel or a reset, is answered by
 * the implementation that minted it. This module reaches nothing, so the
 * router that reads it (`runtime-sessions.ts`) bundles no harness with it.
 */

import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";

/** A runtime other than eve: a harness Luke launches in the agent's sandbox. */
export type NativeRuntime = Exclude<ConversationRuntime, typeof CONVERSATION_RUNTIME.EVE>;

/** What the id of a session Luke mints for each native harness begins with. */
export const NATIVE_SESSION_PREFIX = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: "luke-claude-code-",
  [CONVERSATION_RUNTIME.CODEX]: "luke-codex-",
} as const satisfies Record<NativeRuntime, string>;

/** The native harness that minted the session, by its id; none for a session eve minted. */
export function nativeRuntimeOfSession(sessionId: string): NativeRuntime | undefined {
  for (const [runtime, prefix] of Object.entries(NATIVE_SESSION_PREFIX)) {
    // SAFETY: the keys are `NATIVE_SESSION_PREFIX`'s own, each a native runtime.
    if (sessionId.startsWith(prefix)) return runtime as NativeRuntime;
  }
  return undefined;
}

/** Whether the runtime is a native harness rather than eve. */
export function isNativeRuntime(runtime: ConversationRuntime): runtime is NativeRuntime {
  return runtime !== CONVERSATION_RUNTIME.EVE;
}
