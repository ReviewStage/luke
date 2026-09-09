import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_WAKE_KIND, type BrainStateRepository } from "@sidecar/brain";
import { CREDENTIAL_REFERENCE_KIND, memoryChildStore } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime-contracts";
import { normalizeSession, SESSION_STATUS, type Session } from "@sidecar/session";
import { drainMicrotasks } from "#testing/drain";
import { type BrainWiringDependencies, wakeEventsFromHooks, wireBrain } from "./wiring";

/**
 * The brain wiring reaches a conversation's store only when a brain may
 * stand on it: a run with no model — a fixture, a launch before the database
 * is open, a signed-out account — asks the store for nothing.
 */

function dependencies(overrides: Partial<BrainWiringDependencies> = {}) {
  const loads: string[] = [];
  const repository = (sessionKey: string): BrainStateRepository => ({
    load: () => {
      loads.push(sessionKey);
      return {};
    },
    save: () => true,
  });
  const childStore = memoryChildStore();
  const wiring: BrainWiringDependencies = {
    repositoryFor: (sessionKey) => repository(sessionKey),
    ensureChildConversation: async () => undefined,
    archiveConversation: async () => true,
    conversationDirectory: () => [],
    historyLines: () => [],
    childStore: () => childStore,
    createId: () => "id",
    report: () => undefined,
    recordConversationEntry: () => true,
    broadcastRequests: () => undefined,
    onGenerationReplaced: () => undefined,
    acts: {
      sessionActs: {
        perform: async () => ({ status: "accepted" }),
        openSession: async () => ({ status: "accepted" }),
        openSessionApplication: async () => ({ status: "accepted" }),
        openSessionChange: async () => ({ status: "accepted" }),
      },
      sessions: () => [],
      refreshSessions: async () => undefined,
      workspaceProjects: () => [],
      workspaceDefaults: async () => ({}),
      trackedIssues: () => undefined,
      appGuide: () => ({ facts: [], settings: [] }),
      rememberedFacts: () => [],
      notebook: { remember: async () => true, forget: async () => true },
      performAppAct: async () => ({ status: "accepted" }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    adapterFor: () => undefined,
    session: () => undefined,
    deliver: async () => undefined,
    model: () => undefined,
    credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT }),
    workspaceDirectory: () => "/tmp/luke-wiring-test-workspace",
    skillRoots: () => [],
    runnable: () => false,
    dropBriefings: () => undefined,
    ...overrides,
  };
  return { wiring, loads };
}

test("with no model to run on, a rebuild opens no conversation and loads no store", async () => {
  const { wiring, loads } = dependencies();
  const brains = wireBrain(wiring);
  await brains.rebuild();
  assert.deepEqual(loads, []);
  assert.equal(brains.current(), undefined);
  assert.deepEqual(brains.allRequests(), []);
  assert.deepEqual(brains.busyConversations(), []);
  // Asking for a store is what opens one, and only the one asked for.
  brains.store();
  await drainMicrotasks(1);
  assert.deepEqual(loads, [MAIN_SESSION_KEY]);
  await brains.openConversation(threadSessionKey("t-1"));
  await drainMicrotasks(1);
  assert.deepEqual(loads, [MAIN_SESSION_KEY, threadSessionKey("t-1")]);
  assert.equal(brains.current(threadSessionKey("t-1")), undefined);
  await brains.closeConversation(threadSessionKey("t-1"));
  brains.retire();
});

const NOW = 1_800_000_000_000;

test("every hook event wakes the brain, carrying the session when the roster holds it", () => {
  const held = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "Fix the flaky test",
      status: SESSION_STATUS.COMPLETE,
      lastActivityAt: NOW - 1_000,
    },
  );
  const registry = {
    get: (identity: { providerSessionId: string }): Session | undefined =>
      identity.providerSessionId === "session-a" ? held : undefined,
  };

  const wakes = wakeEventsFromHooks(
    "claude-code",
    [
      { providerSessionId: "session-a", event: "stop", atMs: NOW - 500 },
      { providerSessionId: "session-b", event: "prompt", atMs: Number.NaN },
    ],
    registry,
    NOW,
  );

  assert.equal(wakes.length, 2);
  assert.deepEqual(wakes[0], {
    kind: BRAIN_WAKE_KIND.HOOK,
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    hookEvent: "stop",
    session: held,
    atMs: NOW - 500,
  });
  // A hook for a session the poll has not seen yet still wakes the brain,
  // dated now when the spool carried no usable time.
  assert.deepEqual(wakes[1], {
    kind: BRAIN_WAKE_KIND.HOOK,
    identity: { providerId: "claude-code", providerSessionId: "session-b" },
    hookEvent: "prompt",
    atMs: NOW,
  });
});
