import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type SessionActionKind,
  type ValidatedAction,
} from "@sidecar/actions";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  type ActionHandlers,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderPlugin,
  SessionRoster,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { admittedForTest } from "@sidecar/wire/testing";
import { HOST_NODE_OPEN_KIND, type HostNodeOpenKind } from "./node-capabilities.js";
import { createSessionActionPerformer } from "./session-action-performer.js";
import type { SettingsStore } from "./settings-store.js";

/*
 * The two actions that await something of their own between admission and the
 * provider effect — the stored agent defaults read before a create and before a
 * spawn — are the two places a turn can end mid-preparation. The tests below
 * hold that read open, revoke the turn, release it, and assert the provider was
 * never asked; the live counterparts assert the same paths still land.
 */

const FAKE_PROVIDER: SessionProvider = {
  id: PROVIDER_ID.CONDUCTOR,
  displayName: "Conductor",
};

interface FakePlugin extends SessionProviderPlugin {
  readonly creates: Parameters<ActionHandlers["createWorkspace"]>[0][];
  readonly spawns: Parameters<ActionHandlers["spawnAgent"]>[0][];
}

function fakePlugin(): FakePlugin {
  const creates: Parameters<ActionHandlers["createWorkspace"]>[0][] = [];
  const spawns: Parameters<ActionHandlers["spawnAgent"]>[0][] = [];
  return {
    provider: FAKE_PROVIDER,
    observe: async () => [WORKSPACE_OBSERVATION],
    latest: () => [WORKSPACE_OBSERVATION],
    projects: () => [
      {
        providerProjectId: "project-1",
        repository: "acme/app",
        taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      },
    ],
    creates,
    spawns,
    actions: {
      async createWorkspace(input) {
        creates.push(input);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      async spawnAgent(input) {
        spawns.push(input);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
    },
  };
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

function deeperPerformer(
  plugin: FakePlugin,
  settingsStore: Pick<SettingsStore, "get">,
  openExternal: (url: string, kind: HostNodeOpenKind) => Promise<void> = async () => {},
) {
  const registry = new SessionRoster();
  registry.replaceProvider(plugin.provider, [WORKSPACE_OBSERVATION]);
  const unreachable = async () => {
    throw new Error("the CLI is not reached in these tests");
  };
  return createSessionActionPerformer({
    sessionRegistry: registry,
    openExternal,
    pluginFor: (providerId) => (providerId === plugin.provider.id ? plugin : undefined),
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
const WORKSPACE_LINK = "https://conductor.invalid/workspaces/workspace-1";
const WORKSPACE_IDENTITY = {
  providerId: PROVIDER_ID.CONDUCTOR,
  providerSessionId: "workspace-1",
} as const;
const WORKSPACE_OBSERVATION: ProviderSessionObservation = {
  providerSessionId: "workspace-1",
  title: "Fix the flaky test",
  status: SESSION_STATUS.WAITING,
  lastActivityAt: NOW_DEEP,
  detail: { link: WORKSPACE_LINK },
  advertises: [{ kind: ACTION_KIND.ADD_AGENT, agents: ["claude"] }],
};
/** The open the brain carries at an ask of Luke, as admission would have minted it. */
const OPEN: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.OPEN,
  identity: WORKSPACE_IDENTITY,
  origin: RUN_ORIGIN.USER,
});

/** The node's open, written down with what the host said each address was. */
function recordingOpens() {
  const opens: { url: string; kind: HostNodeOpenKind }[] = [];
  return {
    opens,
    openExternal: async (url: string, kind: HostNodeOpenKind) => {
      opens.push({ url, kind });
    },
  };
}
/** What admission would have minted, since only an admitted act reaches a performer. */
const CREATE: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.CREATE_WORKSPACE,
  providerId: PROVIDER_ID.CONDUCTOR,
  providerProjectId: "project-1",
  task: "add tests",
  origin: RUN_ORIGIN.USER,
});
const SPAWN: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.ADD_AGENT,
  identity: { providerId: PROVIDER_ID.CONDUCTOR, providerSessionId: "workspace-1" },
  agent: "claude",
  origin: RUN_ORIGIN.USER,
});

test("a create whose turn ends while the stored defaults are read never reaches the provider", async () => {
  const plugin = fakePlugin();
  const settings = heldSettings();
  const performer = deeperPerformer(plugin, settings.store);
  let revoked = false;
  const pending = performer.perform(CREATE, { isRevoked: () => revoked });
  await drainMicrotasks(10);
  assert.equal(settings.reads(), 1);
  assert.deepEqual(plugin.creates, []);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(result.reason, ACTION_REFUSAL.TURN_OVER);
  assert.deepEqual(plugin.creates, []);
});

test("a spawn whose turn ends while the stored defaults are read never reaches the provider", async () => {
  const plugin = fakePlugin();
  const settings = heldSettings();
  const performer = deeperPerformer(plugin, settings.store);
  let revoked = false;
  const pending = performer.perform(SPAWN, { isRevoked: () => revoked });
  await drainMicrotasks(10);
  assert.equal(settings.reads(), 1);
  assert.deepEqual(plugin.spawns, []);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(result.reason, ACTION_REFUSAL.TURN_OVER);
  assert.deepEqual(plugin.spawns, []);
});

test("a create whose turn is cancelled while the stored defaults are read settles at once, and the late read lands nothing", async () => {
  const plugin = fakePlugin();
  const settings = heldSettings();
  const performer = deeperPerformer(plugin, settings.store);
  const controller = new AbortController();
  const pending = performer.perform(CREATE, {
    isRevoked: () => controller.signal.aborted,
    signal: controller.signal,
  });
  await drainMicrotasks(10);
  assert.equal(settings.reads(), 1);
  controller.abort();
  // Settles without the read being released.
  const result = await pending;
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  settings.release();
  await drainMicrotasks(10);
  assert.deepEqual(plugin.creates, []);
  // A row's own press carries no signal and waits the read out, as before.
  const direct = performer.perform(CREATE, { isRevoked: () => false });
  await drainMicrotasks(10);
  settings.release();
  assert.equal((await direct).status, ACTION_RESULT_STATUS.ACCEPTED);
});

test("a create and a spawn whose turn still stands after the read land on the provider", async () => {
  const plugin = fakePlugin();
  const settings = heldSettings();
  const performer = deeperPerformer(plugin, settings.store);
  const live = { isRevoked: () => false };

  const creating = performer.perform(CREATE, live);
  await drainMicrotasks(10);
  settings.release();
  assert.equal((await creating).status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(plugin.creates.length, 1);
  assert.equal(plugin.creates[0]?.task, "add tests");

  const spawning = performer.perform(SPAWN, live);
  await drainMicrotasks(10);
  settings.release();
  assert.equal((await spawning).status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(plugin.spawns.length, 1);
  assert.equal(plugin.spawns[0]?.request.agent, "claude");
});

test("a row-shaped call with no guard still lands, because a press is its own turn", async () => {
  const plugin = fakePlugin();
  const settings = heldSettings();
  const performer = deeperPerformer(plugin, settings.store);
  const creating = performer.perform(CREATE);
  await drainMicrotasks(10);
  settings.release();
  assert.equal((await creating).status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(plugin.creates.length, 1);
});

test("an open the brain carries tells the node it was asked of Luke, and a row press hands it an address", async () => {
  const node = recordingOpens();
  const performer = deeperPerformer(fakePlugin(), heldSettings().store, node.openExternal);
  assert.equal((await performer.perform(OPEN)).status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(
    (await performer.openSession(WORKSPACE_IDENTITY)).status,
    ACTION_RESULT_STATUS.ACCEPTED,
  );
  assert.deepEqual(
    node.opens.map((open) => open.kind),
    [HOST_NODE_OPEN_KIND.ASKED_SESSION, HOST_NODE_OPEN_KIND.ADDRESS],
  );
  assert.ok(node.opens.every((open) => open.url === WORKSPACE_LINK));
});

test("an open refused before the node, or lost at it, is answered without the node opening anything of its own", async () => {
  const node = recordingOpens();
  const performer = deeperPerformer(fakePlugin(), heldSettings().store, node.openExternal);
  const absent = admittedForTest({
    kind: ACTION_KIND.OPEN,
    identity: { providerId: PROVIDER_ID.CONDUCTOR, providerSessionId: "workspace-gone" },
    origin: RUN_ORIGIN.USER,
  });
  assert.equal((await performer.perform(absent)).status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(node.opens.length, 0);

  const failing = deeperPerformer(fakePlugin(), heldSettings().store, async () => {
    throw new Error("no application claims that address");
  });
  assert.equal((await failing.perform(OPEN)).status, ACTION_RESULT_STATUS.REJECTED);
});
