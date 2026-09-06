import assert from "node:assert/strict";
import test from "node:test";
import { type CarriedSessionAction, SESSION_TOOL_KIND } from "@sidecar/acts";
import {
  PROVIDER_ID,
  type ProviderSessionObservation,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SESSION_STATUS,
  type SessionProvider,
  SessionProviderAdapterBase,
  SessionRoster,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { SettingsStore } from "../settings-store";
import {
  createSessionActPerformer,
  forgetRememberedFact,
  saveRememberedFact,
} from "./session-acts";

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

/*
 * The two acts that await something of their own between validation and the
 * provider effect — the stored agent defaults read before a create and before a
 * spawn — are the two places a turn can end mid-preparation. The tests below
 * hold that read open, revoke the turn, release it, and assert the provider was
 * never asked; the live counterparts assert the same paths still land.
 */

class FakeAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider = { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };
  readonly creates: ProviderWorkspaceRequest[] = [];
  readonly spawns: ProviderWorkspaceAgentRequest[] = [];

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return [WORKSPACE_OBSERVATION];
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return [
      {
        providerProjectId: "project-1",
        repository: "acme/app",
        taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      },
    ];
  }

  override async createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Promise<ProviderWorkspaceResult> {
    this.creates.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  }

  override async spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    this.spawns.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  }
}

/** A settings read that stays open until the test releases it. */
function heldSettings() {
  let release: (() => void) | undefined;
  let reads = 0;
  // SAFETY: the performer reads one field here, workspaceAgentDefaults, and
  // an undefined answer is a legal value of it; the generic signature is
  // satisfied for that one field.
  const store: Pick<SettingsStore, "get"> = {
    get: (async () => {
      reads += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return undefined;
    }) as SettingsStore["get"],
  };
  return { store, release: () => release?.(), reads: () => reads };
}

function deeperPerformer(adapter: FakeAdapter, settingsStore: Pick<SettingsStore, "get">) {
  const registry = new SessionRoster();
  registry.replaceProvider(adapter.provider, [WORKSPACE_OBSERVATION]);
  const unreachable = async () => {
    throw new Error("the CLI is not reached in these tests");
  };
  return createSessionActPerformer({
    sessionRegistry: registry,
    openExternal: async () => {},
    adapterFor: (providerId) => (providerId === adapter.provider.id ? adapter : undefined),
    sendsNetwork: true,
    settingsStore,
    rememberWorkspaceDefaults: async () => {},
    expectCreatedWorkspace: () => {},
    openCreatedWorkspaces: () => {},
    trackedIssues: () => undefined,
    issueTrackers: [],
    refreshIssues: () => {},
    supersetContext: () => undefined,
    supersetCli: {
      sendMessage: unreachable,
      executeControl: unreachable,
      createAgent: unreachable,
      renameWorkspace: unreachable,
    },
    recordProductEvent: () => {},
  });
}

const NOW_DEEP = 1_800_000_000_000;
const WORKSPACE_OBSERVATION: ProviderSessionObservation = {
  providerSessionId: "workspace-1",
  title: "Fix the flaky test",
  status: SESSION_STATUS.WAITING,
  lastActivityAt: NOW_DEEP,
  spawnableAgents: ["claude"],
};
const CREATE: CarriedSessionAction = {
  kind: SESSION_TOOL_KIND.CREATE_WORKSPACE,
  providerId: PROVIDER_ID.CONDUCTOR,
  providerProjectId: "project-1",
  task: "add tests",
};
const SPAWN: CarriedSessionAction = {
  kind: SESSION_TOOL_KIND.ADD_AGENT,
  identity: { providerId: PROVIDER_ID.CONDUCTOR, providerSessionId: "workspace-1" },
  agent: "claude",
};

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("a create whose turn ends while the stored defaults are read never reaches the provider", async () => {
  const adapter = new FakeAdapter();
  const settings = heldSettings();
  const performer = deeperPerformer(adapter, settings.store);
  let revoked = false;
  const pending = performer.perform(CREATE, { isRevoked: () => revoked });
  await settleMicrotasks();
  assert.equal(settings.reads(), 1);
  assert.deepEqual(adapter.creates, []);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.ok(String(result.reason).includes("ended"));
  assert.deepEqual(adapter.creates, []);
});

test("a spawn whose turn ends while the stored defaults are read never reaches the provider", async () => {
  const adapter = new FakeAdapter();
  const settings = heldSettings();
  const performer = deeperPerformer(adapter, settings.store);
  let revoked = false;
  const pending = performer.perform(SPAWN, { isRevoked: () => revoked });
  await settleMicrotasks();
  assert.equal(settings.reads(), 1);
  assert.deepEqual(adapter.spawns, []);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.ok(String(result.reason).includes("ended"));
  assert.deepEqual(adapter.spawns, []);
});

test("a create and a spawn whose turn still stands after the read land on the provider", async () => {
  const adapter = new FakeAdapter();
  const settings = heldSettings();
  const performer = deeperPerformer(adapter, settings.store);
  const live = { isRevoked: () => false };

  const creating = performer.perform(CREATE, live);
  await settleMicrotasks();
  settings.release();
  assert.equal((await creating).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(adapter.creates.length, 1);
  assert.equal(adapter.creates[0]?.task, "add tests");

  const spawning = performer.perform(SPAWN, live);
  await settleMicrotasks();
  settings.release();
  assert.equal((await spawning).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(adapter.spawns.length, 1);
  assert.equal(adapter.spawns[0]?.agent, "claude");
});

test("a row-shaped call with no guard still lands, because a press is its own turn", async () => {
  const adapter = new FakeAdapter();
  const settings = heldSettings();
  const performer = deeperPerformer(adapter, settings.store);
  const creating = performer.perform(CREATE);
  await settleMicrotasks();
  settings.release();
  assert.equal((await creating).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(adapter.creates.length, 1);
});
