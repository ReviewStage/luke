import assert from "node:assert/strict";
import type { BrainStateRepository } from "@sidecar/brain";
import { CREDENTIAL_REFERENCE_KIND, memoryChildStore } from "@sidecar/runtime";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Runtime } from "effect";
import { test } from "vitest";
import { type BrainWiringDependencies, wireBrain } from "./wiring.js";

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
    conversationLines: () => [],
    childStore: () => childStore,
    createId: () => "id",
    report: () => undefined,
    broadcastRequests: () => undefined,
    onGenerationReplaced: () => undefined,
    actions: {
      sessionActions: {
        perform: async () => ({ status: "accepted" }),
        openSession: async () => ({ status: "accepted" }),
        openSessionApplication: async () => ({ status: "accepted" }),
        openSessionChange: async () => ({ status: "accepted" }),
      },
      sessions: () => [],
      refreshSessions: async () => undefined,
      workspaceProjects: () => [],
      workspaceDefaults: async () => ({}),
      appGuide: () => ({ facts: [], settings: [] }),
      rememberedFacts: () => [],
      notebook: { remember: async () => true, forget: async () => true },
      performAppAction: async () => ({ status: "accepted" }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    transcripts: {
      readTranscript: async () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "not in test",
      }),
      readTranscriptSince: async () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "not in test",
      }),
    },
    session: () => undefined,
    deliver: async () => undefined,
    model: () => undefined,
    credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT }),
    workspaceDirectory: () => "/tmp/luke-wiring-test-workspace",
    skillRoots: () => [],
    runnable: () => false,
    dropBriefings: () => undefined,
    execution: Runtime.defaultRuntime,
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
