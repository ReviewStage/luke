import assert from "node:assert/strict";
import test from "node:test";
import { type ActEnvelope, APP_TOOL_KIND, SESSION_TOOL_KIND } from "@sidecar/acts";
import { InMemorySessionRegistry, SESSION_STATUS } from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { authorizeActEnvelope, forgetRememberedFact, saveRememberedFact } from "./session-acts";

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
    rememberedFacts: () => [],
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

test("main authorization revalidates a remembered entry against the store it will write", () => {
  const held = [{ id: "fact-one", words: "stop telling me about CI" }];
  const facts = { ...authorization(), rememberedFacts: () => held };

  const forgetting = {
    id: "forget_fact",
    armed: true,
    act: { kind: APP_TOOL_KIND.FORGET, id: "fact-one" },
  } satisfies ActEnvelope;
  assert.deepEqual(authorizeActEnvelope(forgetting, facts), {
    status: ACT_RESULT_STATUS.ACCEPTED,
  });

  // The renderer validated against the list it was shown; a list that moved
  // between the showing and the act is what this second check is for.
  assert.equal(
    authorizeActEnvelope(forgetting, authorization()).status,
    ACT_RESULT_STATUS.REJECTED,
  );

  // A new fact names nothing, and needs no entry to exist.
  assert.deepEqual(
    authorizeActEnvelope(
      { id: "remember_fact", armed: true, act: { kind: APP_TOOL_KIND.REMEMBER, words: "new" } },
      authorization(),
    ),
    { status: ACT_RESULT_STATUS.ACCEPTED },
  );
});

test("memory writes deduplicate and leave state unchanged when persistence fails", () => {
  const held = [{ id: "fact-one", words: "prefers concise answers" }];
  let writes = 0;
  const write = () => {
    writes += 1;
    return false;
  };

  assert.equal(
    saveRememberedFact(held, "prefers concise answers", undefined, "duplicate", write),
    held,
  );
  assert.equal(writes, 0);
  assert.equal(saveRememberedFact(held, "works on macOS", undefined, "new", write), held);
  assert.equal(forgetRememberedFact(held, "fact-one", write), held);
  assert.equal(writes, 2);
});

test("replacing a fact with existing wording removes the contradicted entry", () => {
  const held = [
    { id: "fact-one", words: "prefers detailed answers" },
    { id: "fact-two", words: "prefers concise answers" },
  ];
  let written: readonly { id: string; words: string }[] | undefined;

  const next = saveRememberedFact(
    held,
    "prefers concise answers",
    "fact-one",
    "replacement",
    (facts) => {
      written = facts;
      return true;
    },
  );

  assert.deepEqual(next, [held[1]]);
  assert.deepEqual(written, next);
});
