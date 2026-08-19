import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  type EffectSessionProviderAdapter,
  fromPromiseAdapter,
  toPromiseAdapter,
} from "../../src/effect/provider-adapter.js";
import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "../../src/providers.js";
import {
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
} from "../../src/session.js";

const stopControl: SessionControl = {
  id: "stop",
  label: "Stop",
  kind: SESSION_CONTROL_KIND.STOP,
};

const provider: SessionProvider = { id: "cursor", displayName: "Cursor" };

const observations: readonly ProviderSessionObservation[] = [
  {
    providerSessionId: "session-1",
    title: "Cursor: luke",
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
  },
];

const projects: readonly WorkspaceProject[] = [
  {
    providerProjectId: "proj-1",
    repository: "luke",
    taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
  },
];

class FakePromiseAdapter implements SessionProviderAdapter {
  readonly provider = provider;

  observe(): Promise<readonly ProviderSessionObservation[]> {
    return Promise.resolve(observations);
  }

  executeControl(_request: ProviderControlRequest): Promise<ProviderControlResult> {
    return Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED });
  }

  sendMessage(_message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    return Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.REJECTED, reason: "not allowed" });
  }

  workspaceProjects(): readonly WorkspaceProject[] {
    return projects;
  }

  createWorkspace(_request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    return Promise.resolve({
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
      providerSessionId: "new-session",
    });
  }

  spawnWorkspaceAgent(_request: ProviderWorkspaceAgentRequest): Promise<ProviderWorkspaceResult> {
    return Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  readTranscript(providerSessionId: string): Promise<string | undefined> {
    return Promise.resolve(providerSessionId === "session-1" ? "hello" : undefined);
  }
}

class FakeEffectAdapter implements EffectSessionProviderAdapter {
  readonly provider = provider;

  observe(): Effect.Effect<readonly ProviderSessionObservation[], never, never> {
    return Effect.succeed(observations);
  }

  executeControl(
    _request: ProviderControlRequest,
  ): Effect.Effect<ProviderControlResult, never, never> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED });
  }

  sendMessage(
    _message: ProviderSessionMessage,
  ): Effect.Effect<ProviderMessageResult, never, never> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.REJECTED, reason: "not allowed" });
  }

  workspaceProjects(): readonly WorkspaceProject[] {
    return projects;
  }

  createWorkspace(
    _request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never> {
    return Effect.succeed({
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
      providerSessionId: "new-session",
    });
  }

  spawnWorkspaceAgent(
    _request: ProviderWorkspaceAgentRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never> {
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  readTranscript(providerSessionId: string): Effect.Effect<string | undefined, never, never> {
    return Effect.succeed(providerSessionId === "session-1" ? "hello" : undefined);
  }
}

test("fromPromiseAdapter and toPromiseAdapter round-trip a promise adapter", async () => {
  const original = new FakePromiseAdapter();
  const effectAdapter = fromPromiseAdapter(original);
  const roundTripped = toPromiseAdapter(effectAdapter);

  assert.equal(roundTripped.provider, original.provider);
  assert.deepEqual(await roundTripped.observe(), observations);
  assert.deepEqual(
    await roundTripped.executeControl({
      providerSessionId: "session-1",
      control: stopControl,
    }),
    {
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
    },
  );
  assert.deepEqual(await roundTripped.sendMessage({ providerSessionId: "session-1", text: "hi" }), {
    status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
    reason: "not allowed",
  });
  assert.deepEqual(roundTripped.workspaceProjects(), projects);
  assert.deepEqual(await roundTripped.createWorkspace({ providerProjectId: "proj-1" }), {
    status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
    providerSessionId: "new-session",
  });
  assert.deepEqual(
    await roundTripped.spawnWorkspaceAgent({ providerSessionId: "session-1", agent: "cursor" }),
    {
      status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
    },
  );
  assert.equal(await roundTripped.readTranscript("session-1"), "hello");
  assert.equal(await roundTripped.readTranscript("missing"), undefined);
});

test("toPromiseAdapter preserves the original rejection through fromPromiseAdapter", async () => {
  const failure = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const adapter: SessionProviderAdapter = {
    provider,
    observe: () => Promise.reject(failure),
    executeControl: () => Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED }),
    sendMessage: () =>
      Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.REJECTED, reason: "no" }),
    workspaceProjects: () => projects,
    createWorkspace: () =>
      Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED, providerSessionId: "new" }),
    spawnWorkspaceAgent: () => Promise.resolve({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED }),
    readTranscript: () => Promise.resolve(undefined),
  };
  const roundTripped = toPromiseAdapter(fromPromiseAdapter(adapter));

  try {
    await roundTripped.observe();
    assert.fail("Expected observe to reject");
  } catch (error) {
    assert.equal(error, failure);
  }
});

test("toPromiseAdapter and fromPromiseAdapter round-trip an effect adapter", async () => {
  const original = new FakeEffectAdapter();
  const promiseAdapter = toPromiseAdapter(original);
  const roundTripped = fromPromiseAdapter(promiseAdapter);

  assert.equal(roundTripped.provider, original.provider);
  assert.deepEqual(await Effect.runPromise(roundTripped.observe()), observations);
  assert.deepEqual(
    await Effect.runPromise(
      roundTripped.executeControl({ providerSessionId: "session-1", control: stopControl }),
    ),
    { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED },
  );
  assert.deepEqual(roundTripped.workspaceProjects(), projects);
});
