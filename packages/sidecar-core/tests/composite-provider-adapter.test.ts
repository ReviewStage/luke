import assert from "node:assert/strict";
import test from "node:test";
import {
  CompositeSessionProviderAdapter,
  InMemorySessionRegistry,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderAdapter,
  SessionProviderAdapterBase,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "../src";

const cursor: SessionProvider = { id: "cursor", displayName: "Cursor" };
const codex: SessionProvider = { id: "codex", displayName: "Codex" };

class TestProviderAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;
  readonly #observations: () => Promise<readonly ProviderSessionObservation[]>;

  constructor(
    provider: SessionProvider,
    observations: () => Promise<readonly ProviderSessionObservation[]>,
  ) {
    super();
    this.provider = provider;
    this.#observations = observations;
  }

  observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.#observations();
  }
}

function observation(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: "Cursor: luke",
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
    ...overrides,
  };
}

function observerOf(
  provider: SessionProvider,
  observations: readonly ProviderSessionObservation[],
): SessionProviderAdapter {
  return new TestProviderAdapter(provider, async () => observations);
}

function failingObserver(provider: SessionProvider): SessionProviderAdapter {
  return new TestProviderAdapter(provider, async () => {
    throw new Error("session state is unreadable");
  });
}

test("reports every observer's sessions as one provider snapshot", async () => {
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      observerOf(cursor, [observation("local-session")]),
      observerOf(cursor, [observation("cloud-agent", { status: SESSION_STATUS.WAITING })]),
    ],
  });

  const observations = await adapter.observe();

  assert.equal(adapter.provider, cursor);
  assert.deepEqual(
    observations.map((entry) => [entry.providerSessionId, entry.status]),
    [
      ["local-session", SESSION_STATUS.WORKING],
      ["cloud-agent", SESSION_STATUS.WAITING],
    ],
  );
});

test("leaves each half of a provider saying where its own sessions run", async () => {
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      observerOf(cursor, [observation("local-session")]),
      observerOf(cursor, [observation("cloud-agent", { location: SESSION_LOCATION.CLOUD })]),
    ],
  });

  // One provider mark, two places. Merging under one id must not make the
  // sessions on this machine read as though they ran in a datacentre.
  const registry = new InMemorySessionRegistry();
  await registry.refresh(adapter);
  const locations = new Map(
    registry.list().map((session) => [session.providerSessionId, session.location]),
  );
  assert.equal(locations.get("local-session"), SESSION_LOCATION.LOCAL);
  assert.equal(locations.get("cloud-agent"), SESSION_LOCATION.CLOUD);
});

test("keeps a session two observers both reached from being reported twice", async () => {
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      observerOf(cursor, [observation("shared", { title: "Cursor: luke" })]),
      observerOf(cursor, [observation("shared", { title: "Cursor: workspace" })]),
    ],
  });

  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "Cursor: luke");
  // The registry rejects a snapshot that names one session twice, so this is
  // what keeps a provider observed in two places from failing its own refresh.
  const registry = new InMemorySessionRegistry();
  assert.equal((await registry.refresh(adapter)).sessions.length, 1);
});

test("fails the pass when one observer fails, rather than retiring its sessions", async () => {
  const registry = new InMemorySessionRegistry();
  const healthy = observerOf(cursor, [observation("local-session")]);
  await registry.refresh(
    new CompositeSessionProviderAdapter({ provider: cursor, adapters: [healthy] }),
  );

  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [healthy, failingObserver(cursor)],
  });

  await assert.rejects(() => adapter.observe(), /unreadable/);
  await assert.rejects(() => registry.refresh(adapter), /unreadable/);
  assert.deepEqual(
    registry.list().map((session) => session.providerSessionId),
    ["local-session"],
  );
});

test("refuses to observe one provider's sessions under another's identity", () => {
  assert.throws(
    () =>
      new CompositeSessionProviderAdapter({
        provider: cursor,
        adapters: [observerOf(codex, [])],
      }),
    /cursor cannot observe codex/,
  );
});

function messenger(
  provider: SessionProvider,
  answer: (message: ProviderSessionMessage) => ProviderMessageResult,
): SessionProviderAdapter {
  return Object.assign(new TestProviderAdapter(provider, async () => []), {
    sendMessage: async (message: ProviderSessionMessage) => answer(message),
  });
}

test("carries a message past observers that have never seen the session", async () => {
  const sent: ProviderSessionMessage[] = [];
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      // The local observer can carry no message at all, and must not stop one.
      observerOf(cursor, [observation("local-session")]),
      messenger(cursor, () => ({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED })),
      messenger(cursor, (message) => {
        sent.push(message);
        return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      }),
    ],
  });

  const result = await adapter.sendMessage({ providerSessionId: "cloud-agent", text: "go on" });

  assert.deepEqual(result, { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(sent, [{ providerSessionId: "cloud-agent", text: "go on" }]);
});

test("lets the observer that holds the session refuse for itself", async () => {
  const unreachable: ProviderSessionMessage[] = [];
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      messenger(cursor, () => ({
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor is still busy with the current run",
      })),
      messenger(cursor, (message) => {
        unreachable.push(message);
        return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      }),
    ],
  });

  const result = await adapter.sendMessage({ providerSessionId: "cloud-agent", text: "go on" });

  // A rejection is the session's own answer, so it must not be shopped past
  // the observer that gave it to one that would say yes to a different session.
  assert.equal(result.status, PROVIDER_ACT_RESULT_STATUS.REJECTED);
  assert.deepEqual(unreachable, []);
});

test("answers unsupported when no observer can carry a message", async () => {
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [observerOf(cursor, [observation("local-session")])],
  });

  const result = await adapter.sendMessage({ providerSessionId: "local-session", text: "go on" });

  assert.deepEqual(result, { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
});

function workspaceCreator(
  provider: SessionProvider,
  projects: readonly WorkspaceProject[],
  answer: (request: ProviderWorkspaceRequest) => ProviderWorkspaceResult,
): SessionProviderAdapter {
  return Object.assign(new TestProviderAdapter(provider, async () => []), {
    workspaceProjects: () => projects,
    createWorkspace: async (request: ProviderWorkspaceRequest) => answer(request),
  });
}

test("offers every observer's projects and carries a creation ask to the one that offered it", async () => {
  const created: ProviderWorkspaceRequest[] = [];
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [
      // The local observer offers no projects at all, and must not stop an ask.
      observerOf(cursor, [observation("local-session")]),
      workspaceCreator(
        cursor,
        [
          {
            providerProjectId: "proj-1",
            repository: "luke",
            taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
          },
        ],
        () => ({
          status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
        }),
      ),
      workspaceCreator(
        cursor,
        [
          {
            providerProjectId: "proj-2",
            repository: "sidecar",
            taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
          },
        ],
        (request) => {
          created.push(request);
          return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
        },
      ),
    ],
  });

  assert.deepEqual(adapter.workspaceProjects(), [
    {
      providerProjectId: "proj-1",
      repository: "luke",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    },
    {
      providerProjectId: "proj-2",
      repository: "sidecar",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    },
  ]);

  const result = await adapter.createWorkspace({ providerProjectId: "proj-2" });

  assert.deepEqual(result, { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(created, [{ providerProjectId: "proj-2" }]);
});

test("answers unsupported when no observer offers workspace creation", async () => {
  const adapter = new CompositeSessionProviderAdapter({
    provider: cursor,
    adapters: [observerOf(cursor, [observation("local-session")])],
  });

  assert.deepEqual(adapter.workspaceProjects(), []);
  assert.deepEqual(await adapter.createWorkspace({ providerProjectId: "proj-1" }), {
    status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
  });
});
