/**
 * The fixed vocabulary every command-backed observation hook may write into
 * Luke's spool. Providers select the subset their documented hook surface can
 * actually emit; sharing the words does not add an event to any provider. It
 * lives in the session vocabulary because the brain's fallback digest reads a
 * stop state from the same tokens the providers' hooks write.
 */
export const HOOK_EVENT = {
  SESSION_START: "session-start",
  PROMPT: "prompt",
  STOP: "stop",
  STOP_FAILURE: "stop-failure",
  NOTIFICATION: "notification",
  SESSION_END: "session-end",
} as const;

export type HookEvent = (typeof HOOK_EVENT)[keyof typeof HOOK_EVENT];
