/**
 * native-runtime.ts -- the native harnesses a coding agent's conversation may run on, and the sessions we mint for them, told apart by their ids.
 *
 * A conversation's `runtime` (`conversations.runtime`) says which native
 * harness answers it (`harnessOf`), and one that names none, on eve or from
 * before the column, ran on eve, which runs nothing any more: its session
 * has ended for good. A native harness's session is our own, minted as it
 * opens with the harness's prefix (`runner-sessions.ts`), so a call that
 * names a session and no conversation, a cancel or a reset, is answered by
 * the implementation that minted it. This module reaches nothing, so the
 * router that reads it (`runtime-sessions.ts`) bundles no harness with it.
 */

import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";

/** A runtime other than eve: a harness we launch in the agent's sandbox. */
export type NativeRuntime = Exclude<ConversationRuntime, typeof CONVERSATION_RUNTIME.EVE>;

/** What the id of a session we mint for each native harness begins with. */
export const NATIVE_SESSION_PREFIX = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: "claude-code-",
  [CONVERSATION_RUNTIME.CODEX]: "codex-",
} as const satisfies Record<NativeRuntime, string>;

/**
 * What the id of a session minted before the product's rename began with,
 * read and never written. Note that it is read for good, because a
 * conversation keeps its session's id, and its sandbox the `sessionId` tag
 * that finds it, for as long as the agent lives.
 */
const NATIVE_SESSION_PREFIX_BEFORE_RENAME = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: "luke-claude-code-",
  [CONVERSATION_RUNTIME.CODEX]: "luke-codex-",
} as const satisfies Record<NativeRuntime, string>;

/** The native harness that minted the session, by its id; none for a session eve minted. */
export function nativeRuntimeOfSession(sessionId: string): NativeRuntime | undefined {
  for (const prefixes of [NATIVE_SESSION_PREFIX, NATIVE_SESSION_PREFIX_BEFORE_RENAME]) {
    for (const [runtime, prefix] of Object.entries(prefixes)) {
      // SAFETY: the keys are the prefix tables' own, each a native runtime.
      if (sessionId.startsWith(prefix)) return runtime as NativeRuntime;
    }
  }
  return undefined;
}

/**
 * The native harness a conversation runs on, or none where its session has
 * ended for good: one on eve, or from before the runtime column, which eve
 * ran. This is the one place a conversation's runtime is told apart; every
 * caller reads none as an agent whose session ended, which nothing reaches
 * again and only a new agent goes on from.
 */
export function harnessOf(runtime: ConversationRuntime | undefined): NativeRuntime | undefined {
  return runtime === CONVERSATION_RUNTIME.CLAUDE_CODE || runtime === CONVERSATION_RUNTIME.CODEX
    ? runtime
    : undefined;
}
