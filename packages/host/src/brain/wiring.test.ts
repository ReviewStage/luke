import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { BrainStateRepository } from "@sidecar/brain";
import { CREDENTIAL_REFERENCE_KIND, memoryChildStore } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect, Runtime } from "effect";
import { type BrainWiringDependencies, wireBrain } from "./wiring.js";

/**
 * Polls a synchronous condition by yielding to Effect's own fiber scheduler,
 * which correctly interleaves with real pending Promises.
 */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

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
      carry: (effect) => Effect.runPromise(effect),
      sessionActions: {
        perform: () => Effect.succeed({ status: "accepted" }),
        openSession: () => Effect.succeed({ status: "accepted" }),
        openSessionApplication: () => Effect.succeed({ status: "accepted" }),
        openSessionChange: () => Effect.succeed({ status: "accepted" }),
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

it.effect("with no model to run on, a rebuild opens no conversation and loads no store", () =>
  Effect.gen(function* () {
    const { wiring, loads } = dependencies();
    const brains = wireBrain(wiring);
    yield* Effect.promise(() => brains.rebuild());
    assert.deepEqual(loads, []);
    assert.equal(brains.current(), undefined);
    assert.deepEqual(brains.allRequests(), []);
    assert.deepEqual(brains.busyConversations(), []);
    // Asking for a store is what opens one, and only the one asked for.
    brains.store();
    yield* waitFor(() => loads.length === 1);
    assert.deepEqual(loads, [MAIN_SESSION_KEY]);
    yield* Effect.promise(() => brains.openConversation(threadSessionKey("t-1")));
    yield* waitFor(() => loads.length === 2);
    assert.deepEqual(loads, [MAIN_SESSION_KEY, threadSessionKey("t-1")]);
    assert.equal(brains.current(threadSessionKey("t-1")), undefined);
    yield* Effect.promise(() => brains.closeConversation(threadSessionKey("t-1")));
    brains.retire();
  }),
);
