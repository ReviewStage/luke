import assert from "node:assert/strict";
import test from "node:test";
import { HOOK_EVENT } from "../shared/hook-merge.js";
import { CODEX_HOOK_EVENT, CODEX_HOOK_SCRIPT_NAME, CODEX_HOOK_SPEC } from "./hooks.js";

/**
 * What Codex calls things. The guarantees the registration holds to are the
 * shared module's, and `shared/hook-merge.test.ts` states them over every
 * registered spec; this file says only which lifecycle moments Luke joined and
 * under what names, because widening either is a product decision.
 */
test("registers Codex's turn boundaries and lifecycle edges, and nothing else", () => {
  assert.equal(CODEX_HOOK_SPEC.configurationFileName, "hooks.json");
  assert.equal(CODEX_HOOK_SPEC.scriptName, CODEX_HOOK_SCRIPT_NAME);
  assert.deepEqual(CODEX_HOOK_SPEC.registration, {
    SessionStart: { event: HOOK_EVENT.SESSION_START },
    UserPromptSubmit: { event: HOOK_EVENT.PROMPT },
    Stop: { event: HOOK_EVENT.STOP },
    // Codex's own name for a tool call holding for approval — the one moment
    // the state database shows nothing new.
    PermissionRequest: { event: HOOK_EVENT.NOTIFICATION },
    SessionEnd: { event: HOOK_EVENT.SESSION_END },
  });
  // No failure token: Codex fires no hook for a turn that failed, so the
  // rollout keeps that verdict.
  assert.deepEqual(Object.values(CODEX_HOOK_EVENT), [
    HOOK_EVENT.SESSION_START,
    HOOK_EVENT.PROMPT,
    HOOK_EVENT.STOP,
    HOOK_EVENT.NOTIFICATION,
    HOOK_EVENT.SESSION_END,
  ]);
});

test("reads only the envelope's session id, in the shape Codex mints", () => {
  assert.equal(CODEX_HOOK_SPEC.sessionIdField, "session_id");
  assert.equal(CODEX_HOOK_SPEC.sessionIdPattern, "[0-9a-fA-F-]{8,64}");
  assert.equal(CODEX_HOOK_SPEC.subagentField, "agent_id");
  assert.equal(CODEX_HOOK_SPEC.timeoutSeconds, 10);
});
