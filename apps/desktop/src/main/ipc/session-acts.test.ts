import assert from "node:assert/strict";
import test from "node:test";
import { type ActEnvelope, SESSION_TOOL_KIND } from "@sidecar/acts";
import { InMemorySessionRegistry, SESSION_STATUS } from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { authorizeActEnvelope } from "./session-acts";

const identity = { providerId: "claude-code", providerSessionId: "session-a" } as const;
const openSession = {
  id: "open_session",
  armed: true,
  act: { kind: SESSION_TOOL_KIND.OPEN, identity },
} satisfies ActEnvelope;

function authorization(registry = new InMemorySessionRegistry()) {
  return {
    sessionRegistry: registry,
    adapterFor: () => undefined,
    trackedIssues: () => undefined,
  };
}

test("main authorization requires the developer-opened turn flag", () => {
  const result = authorizeActEnvelope({ ...openSession, armed: false }, authorization());
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(
    result.status === ACT_RESULT_STATUS.REJECTED ? result.reason : "",
    /developer opened/,
  );
});

test("main authorization revalidates a session against its latest roster", () => {
  const registry = new InMemorySessionRegistry();
  const missing = authorizeActEnvelope(openSession, authorization(registry));
  assert.equal(missing.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(
    missing.status === ACT_RESULT_STATUS.REJECTED ? missing.reason : "",
    /observed session/,
  );

  registry.upsert(
    { id: identity.providerId, displayName: "Claude Code" },
    {
      providerSessionId: identity.providerSessionId,
      title: "Checkout service",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_800_000_000_000,
    },
  );
  assert.deepEqual(authorizeActEnvelope(openSession, authorization(registry)), {
    status: ACT_RESULT_STATUS.ACCEPTED,
  });
});

test("main authorization refuses an act id outside the registry", () => {
  // SAFETY: This deliberately bypasses the renderer-side wire guard to exercise
  // the main process's independent unknown-id refusal.
  const unknown = { ...openSession, id: "not_an_act" } as ActEnvelope;
  const result = authorizeActEnvelope(unknown, authorization());
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(result.status === ACT_RESULT_STATUS.REJECTED ? result.reason : "", /No such act/);
});
