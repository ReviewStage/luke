/**
 * The parallel run that lets `dispatchAct` replace the guards the adapter
 * base classes hold. Every act is asked twice — once through the surviving
 * base-class method, once through `dispatchAct` over the same adapter read as
 * a plugin — and the two answers, and the requests each issued, must be
 * identical, across every refusal the constraints in root `CLAUDE.md` name: a
 * session the pass did not report, an act the observation did not advertise,
 * a target the caller rewrote, and an ask outside its bound.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ACT_KIND,
  ACT_RESULT_STATUS,
  type AdvertisedControl,
  adapterAsPlugin,
  dispatchAct,
  dispatchConversation,
  dispatchRead,
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  type PluginActKind,
  type PluginActRequests,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionProviderAdapter,
  type SessionProviderPlugin,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/session";
import { jsonResponse, type RecordedRequest, recordingFetch } from "@sidecar/wire/testing";
import { type CloudAdapterOptions, CloudSessionAdapter } from "./cloud-session-adapter.js";
import type { CloudRequest } from "./cloud-wire.js";

const TEST_TIME = Date.parse("2026-09-01T12:00:00.000Z");
const TEST_BASE_URL = "https://api.stub.test";
const TEST_API_KEY = "stub-key";
const STUB_PROVIDER = { id: "stub", displayName: "Stub" };
const SESSION_ID = "session-1";
const BARE_SESSION_ID = "session-bare";
const ABSENT_SESSION_ID = "session-absent";
const SPAWN_TARGET = "workspace-1";
const RENAME_TARGET = "workspace-2";

const CANCEL_CONTROL: AdvertisedControl = {
  kind: ACT_KIND.CONTROL,
  id: "cancel-turn",
  label: "Stop this turn",
  controlKind: SESSION_CONTROL_KIND.STOP,
  target: "run-1",
};

const PROJECT: WorkspaceProject = {
  providerProjectId: "project-1",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

const REQUIRED_TASK_PROJECT: WorkspaceProject = {
  ...PROJECT,
  providerProjectId: "project-required",
  taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
};

const NO_TASK_PROJECT: WorkspaceProject = {
  ...PROJECT,
  providerProjectId: "project-none",
  taskSupport: WORKSPACE_TASK_SUPPORT.NONE,
};

const OBSERVATION: ProviderSessionObservation = {
  providerSessionId: SESSION_ID,
  title: "luke",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: TEST_TIME,
  advertises: [
    { kind: ACT_KIND.MESSAGE },
    CANCEL_CONTROL,
    { kind: ACT_KIND.ADD_AGENT, agents: ["claude"], target: SPAWN_TARGET },
    { kind: ACT_KIND.RENAME_WORKSPACE, target: RENAME_TARGET },
    { kind: ACT_KIND.RENAME_SESSION },
  ],
};

/** A session the pass reported that advertises nothing at all. */
const BARE_OBSERVATION: ProviderSessionObservation = {
  providerSessionId: BARE_SESSION_ID,
  title: "bare",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: TEST_TIME,
};

/** Routes every act, so a refusal can only ever have come from a guard. */
class StubAdapter extends CloudSessionAdapter {
  constructor(options: CloudAdapterOptions) {
    super({ provider: STUB_PROVIDER, defaultBaseUrl: TEST_BASE_URL }, options);
  }

  protected async collect(_request: CloudRequest): Promise<readonly ProviderSessionObservation[]> {
    return [OBSERVATION, BARE_OBSERVATION];
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return [PROJECT, REQUIRED_TASK_PROJECT, NO_TASK_PROJECT];
  }

  protected override messageRoute(providerSessionId: string, text: string) {
    return { segments: ["v0", "sessions", providerSessionId, "messages"], body: { text } };
  }

  protected override controlRoute(providerSessionId: string, control: AdvertisedControl) {
    return { segments: ["v0", "runs", control.target ?? providerSessionId, "cancel"] };
  }

  protected override workspaceCreationRoute(project: WorkspaceProject, name?: string) {
    return {
      segments: ["v0", "projects", project.providerProjectId, "workspaces"],
      body: { ...(name === undefined ? undefined : { name }) },
    };
  }

  protected override workspaceAgentRoute(spawnTarget: string) {
    return { segments: ["v0", "workspaces", spawnTarget, "agents"] };
  }

  protected override workspaceRenameRoute(renameTarget: string, name: string) {
    return { segments: ["v0", "workspaces", renameTarget], body: { name } };
  }

  protected override sessionRenameRoute(providerSessionId: string, name: string) {
    return { segments: ["v0", "sessions", providerSessionId], body: { name } };
  }
}

const BASE_METHOD_BY_ACT: {
  [Kind in PluginActKind]: (
    adapter: SessionProviderAdapter,
    request: PluginActRequests[Kind],
  ) => Promise<unknown>;
} = {
  message: (adapter, request) => adapter.sendMessage(request),
  control: (adapter, request) => adapter.executeControl(request),
  createWorkspace: (adapter, request) => adapter.createWorkspace(request),
  spawnAgent: (adapter, request) => adapter.spawnWorkspaceAgent(request),
  renameWorkspace: (adapter, request) => adapter.renameWorkspace(request),
  renameSession: (adapter, request) => adapter.renameSession(request),
};

interface Harness {
  adapter: StubAdapter;
  requests: readonly RecordedRequest[];
}

function harness(): Harness {
  const { fetch, requests } = recordingFetch(() => jsonResponse({}));
  const adapter = new StubAdapter({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    fetch,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
  });
  return { adapter, requests };
}

async function observedPlugin(): Promise<{
  plugin: SessionProviderPlugin;
  requests: readonly RecordedRequest[];
}> {
  const { adapter, requests } = harness();
  const plugin = adapterAsPlugin(adapter);
  await plugin.observe();
  return { plugin, requests };
}

/** What one write asked of the provider, as an answer can be compared by. */
function writes(requests: readonly RecordedRequest[], from: number) {
  return requests.slice(from).map((request) => ({
    method: request.method,
    url: request.url,
    body: request.body,
  }));
}

/**
 * Asks one act both ways over two adapters standing in the same state, and
 * asserts the answers and the requests each issued are identical.
 */
async function bothWays<Kind extends PluginActKind>(
  kind: Kind,
  request: PluginActRequests[Kind],
): Promise<void> {
  const base = harness();
  await base.adapter.observe();
  const baseWritesFrom = base.requests.length;
  const fromBase = await BASE_METHOD_BY_ACT[kind](base.adapter, request);

  const dispatched = await observedPlugin();
  const dispatchWritesFrom = dispatched.requests.length;
  const fromDispatch = await dispatchAct(dispatched.plugin, kind, request);

  const where = `${kind} ${JSON.stringify(request)}`;
  assert.deepEqual(fromDispatch, fromBase, `answered differently: ${where}`);
  assert.deepEqual(
    writes(dispatched.requests, dispatchWritesFrom),
    writes(base.requests, baseWritesFrom),
    `issued different requests: ${where}`,
  );
}

const OVER_LONG_MESSAGE = "m".repeat(maximumSessionMessageLength + 1);
const OVER_LONG_NAME = "n".repeat(maximumWorkspaceNameLength + 1);

test("a message answers identically through the base method and through dispatchAct", async () => {
  for (const request of [
    { providerSessionId: SESSION_ID, text: "ship it" },
    { providerSessionId: ABSENT_SESSION_ID, text: "ship it" },
    { providerSessionId: BARE_SESSION_ID, text: "ship it" },
    { providerSessionId: SESSION_ID, text: "   " },
    { providerSessionId: SESSION_ID, text: OVER_LONG_MESSAGE },
  ]) {
    await bothWays("message", request);
  }
});

test("a control answers identically, on the advertised target either way", async () => {
  for (const request of [
    { providerSessionId: SESSION_ID, control: CANCEL_CONTROL },
    { providerSessionId: ABSENT_SESSION_ID, control: CANCEL_CONTROL },
    { providerSessionId: BARE_SESSION_ID, control: CANCEL_CONTROL },
    { providerSessionId: SESSION_ID, control: { ...CANCEL_CONTROL, id: "invented" } },
    // A caller that rewrote the target must still act on the advertised one.
    { providerSessionId: SESSION_ID, control: { ...CANCEL_CONTROL, target: "somewhere-else" } },
  ]) {
    await bothWays("control", request);
  }
});

test("a creation answers identically, including every task-support refusal", async () => {
  for (const request of [
    { providerProjectId: PROJECT.providerProjectId },
    { providerProjectId: PROJECT.providerProjectId, name: "notch", task: "start here" },
    { providerProjectId: "project-unreported" },
    { providerProjectId: PROJECT.providerProjectId, name: OVER_LONG_NAME },
    { providerProjectId: PROJECT.providerProjectId, task: "  " },
    { providerProjectId: NO_TASK_PROJECT.providerProjectId, task: "start here" },
    { providerProjectId: REQUIRED_TASK_PROJECT.providerProjectId },
  ]) {
    await bothWays("createWorkspace", request);
  }
});

test("a spawn answers identically, on the advertised workspace either way", async () => {
  for (const request of [
    { providerSessionId: SESSION_ID, agent: "claude" },
    { providerSessionId: SESSION_ID, agent: "claude", name: "notch", task: "start here" },
    { providerSessionId: ABSENT_SESSION_ID, agent: "claude" },
    { providerSessionId: BARE_SESSION_ID, agent: "claude" },
    { providerSessionId: SESSION_ID, agent: "invented" },
    { providerSessionId: SESSION_ID, agent: "claude", name: OVER_LONG_NAME },
    { providerSessionId: SESSION_ID, agent: "claude", task: OVER_LONG_MESSAGE },
  ]) {
    await bothWays("spawnAgent", request);
  }
});

test("both renames answer identically, on the advertised target either way", async () => {
  for (const request of [
    { providerSessionId: SESSION_ID, name: "notch" },
    { providerSessionId: ABSENT_SESSION_ID, name: "notch" },
    { providerSessionId: BARE_SESSION_ID, name: "notch" },
    { providerSessionId: SESSION_ID, name: "  " },
    { providerSessionId: SESSION_ID, name: OVER_LONG_NAME },
  ]) {
    await bothWays("renameWorkspace", request);
    await bothWays("renameSession", request);
  }
});

test("a control acts on the target the observation advertised", async () => {
  const { plugin, requests } = await observedPlugin();
  const from = requests.length;

  const result = await dispatchAct(plugin, "control", {
    providerSessionId: SESSION_ID,
    control: { ...CANCEL_CONTROL, target: "somewhere-else" },
  });

  assert.equal(result.status, ACT_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(
    requests.slice(from).map((request) => request.url),
    [`${TEST_BASE_URL}/v0/runs/run-1/cancel`],
  );
});

test("a spawn acts on the advertised workspace, not the session it was asked with", async () => {
  const { plugin, requests } = await observedPlugin();
  const from = requests.length;

  await dispatchAct(plugin, "spawnAgent", { providerSessionId: SESSION_ID, agent: "claude" });

  assert.deepEqual(
    requests.slice(from).map((request) => request.url),
    [`${TEST_BASE_URL}/v0/workspaces/${SPAWN_TARGET}/agents`],
  );
});

test("a rename acts on the advertised workspace, not the session it was asked with", async () => {
  const { plugin, requests } = await observedPlugin();
  const from = requests.length;

  await dispatchAct(plugin, "renameWorkspace", { providerSessionId: SESSION_ID, name: "notch" });

  assert.deepEqual(
    requests.slice(from).map((request) => request.url),
    [`${TEST_BASE_URL}/v0/workspaces/${RENAME_TARGET}`],
  );
});

test("an act the plugin does not name answers unsupported and issues no request", async () => {
  const { plugin, requests } = await observedPlugin();
  const { acts: _acts, ...withoutActs } = plugin;
  const from = requests.length;

  const expected = {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That act is not supported by the latest observation.",
  };
  assert.deepEqual(
    await dispatchAct(withoutActs, "message", { providerSessionId: SESSION_ID, text: "ship it" }),
    expected,
  );
  assert.deepEqual(
    await dispatchAct(withoutActs, "control", {
      providerSessionId: SESSION_ID,
      control: CANCEL_CONTROL,
    }),
    expected,
  );
  assert.deepEqual(
    await dispatchAct(withoutActs, "spawnAgent", {
      providerSessionId: SESSION_ID,
      agent: "claude",
    }),
    expected,
  );
  assert.deepEqual(
    await dispatchAct(withoutActs, "renameWorkspace", {
      providerSessionId: SESSION_ID,
      name: "notch",
    }),
    expected,
  );
  assert.deepEqual(
    await dispatchAct(withoutActs, "renameSession", {
      providerSessionId: SESSION_ID,
      name: "notch",
    }),
    expected,
  );
  assert.deepEqual(
    await dispatchAct(withoutActs, "createWorkspace", {
      providerProjectId: PROJECT.providerProjectId,
    }),
    expected,
  );
  assert.equal(requests.length, from);
});

test("a plugin that reports no projects is offered nowhere to create", async () => {
  const { plugin } = await observedPlugin();
  const { projects: _projects, ...withoutProjects } = plugin;

  assert.deepEqual(
    await dispatchAct(withoutProjects, "createWorkspace", {
      providerProjectId: PROJECT.providerProjectId,
    }),
    {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "That act is not supported by the latest observation.",
    },
  );
});

test("both transcript reads answer identically through the base method and dispatchRead", async () => {
  const base = harness();
  await base.adapter.observe();
  const { plugin } = await observedPlugin();

  assert.deepEqual(
    await dispatchRead(plugin, "transcript", SESSION_ID),
    await base.adapter.readTranscript(SESSION_ID),
  );
  assert.deepEqual(
    await dispatchRead(plugin, "transcriptSince", SESSION_ID, "12"),
    await base.adapter.readTranscriptSince(SESSION_ID, "12"),
  );
});

test("a plugin naming no transcript read says so rather than guessing", async () => {
  const { plugin } = await observedPlugin();
  const { reads: _reads, ...withoutReads } = plugin;

  const expected = {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "This provider keeps no transcript this build can read.",
  };
  assert.deepEqual(await dispatchRead(withoutReads, "transcript", SESSION_ID), expected);
  assert.deepEqual(await dispatchRead(withoutReads, "transcriptSince", SESSION_ID), expected);
});

test("a conversation read is refused for a session the pass did not report", async () => {
  const { plugin, requests } = await observedPlugin();
  const from = requests.length;

  assert.deepEqual(await dispatchConversation(plugin, { providerSessionId: ABSENT_SESSION_ID }), {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(requests.length, from);
});

test("a plugin naming no conversation read answers identically to the base", async () => {
  const base = harness();
  await base.adapter.observe();
  const { plugin } = await observedPlugin();
  const { reads: _reads, ...withoutReads } = plugin;

  assert.deepEqual(
    await dispatchConversation(withoutReads, { providerSessionId: SESSION_ID }),
    await base.adapter.readConversation({ providerSessionId: SESSION_ID }),
  );
});
