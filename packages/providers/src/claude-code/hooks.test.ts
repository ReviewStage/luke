import assert from "node:assert/strict";
import test from "node:test";
import { HOOK_EVENT } from "../shared/hook-merge.js";
import { CLAUDE_HOOK_EVENT, CLAUDE_HOOK_SCRIPT_NAME, CLAUDE_HOOK_SPEC } from "./hooks.js";

/**
 * What Claude Code calls things. The guarantees the registration holds to are
 * the shared module's, and `shared/hook-merge.test.ts` states them over every
 * registered spec; this file says only which lifecycle moments Luke joined and
 * under what names, because widening either is a product decision.
 */
test("registers Claude Code's turn boundaries and lifecycle edges, and nothing else", () => {
  assert.equal(CLAUDE_HOOK_SPEC.configurationFileName, "settings.json");
  assert.equal(CLAUDE_HOOK_SPEC.scriptName, CLAUDE_HOOK_SCRIPT_NAME);
  assert.deepEqual(CLAUDE_HOOK_SPEC.registration, {
    SessionStart: { event: HOOK_EVENT.SESSION_START },
    UserPromptSubmit: { event: HOOK_EVENT.PROMPT },
    Stop: { event: HOOK_EVENT.STOP },
    StopFailure: { event: HOOK_EVENT.STOP_FAILURE },
    // Matched down to the two kinds that mean the session is holding for the
    // user, which are exactly the moments the transcript shows nothing new.
    Notification: {
      event: HOOK_EVENT.NOTIFICATION,
      matcher: "permission_prompt|elicitation_dialog",
    },
    SessionEnd: { event: HOOK_EVENT.SESSION_END },
  });
  assert.deepEqual(Object.values(CLAUDE_HOOK_EVENT), [
    HOOK_EVENT.SESSION_START,
    HOOK_EVENT.PROMPT,
    HOOK_EVENT.STOP,
    HOOK_EVENT.STOP_FAILURE,
    HOOK_EVENT.NOTIFICATION,
    HOOK_EVENT.SESSION_END,
  ]);
});

test("reads only the envelope's session id, in the shape Claude Code mints", () => {
  assert.equal(CLAUDE_HOOK_SPEC.sessionIdField, "session_id");
  assert.equal(CLAUDE_HOOK_SPEC.sessionIdPattern, "[0-9a-fA-F-]{8,64}");
  assert.equal(CLAUDE_HOOK_SPEC.subagentField, "agent_id");
  assert.equal(CLAUDE_HOOK_SPEC.timeoutSeconds, 10);
});
