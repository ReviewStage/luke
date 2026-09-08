import assert from "node:assert/strict";
import test from "node:test";
import type { BrainStateRepository } from "@sidecar/brain";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime-contracts";
import { type BrainWiringDependencies, wireBrain } from "./wiring";

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
  const wiring: BrainWiringDependencies = {
    repositoryFor: (sessionKey) => repository(sessionKey),
    isTemporary: () => false,
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
      writeRememberedFacts: () => true,
      performAppAct: async () => ({ status: "accepted" }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    adapterFor: () => undefined,
    session: () => undefined,
    deliver: async () => undefined,
    model: () => undefined,
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loads, [MAIN_SESSION_KEY]);
  await brains.openConversation(threadSessionKey("t-1"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loads, [MAIN_SESSION_KEY, threadSessionKey("t-1")]);
  assert.equal(brains.current(threadSessionKey("t-1")), undefined);
  await brains.closeConversation(threadSessionKey("t-1"));
  brains.retire();
});
