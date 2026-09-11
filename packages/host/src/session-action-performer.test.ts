import assert from "node:assert/strict";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type SessionActionKind,
  type ValidatedAction,
} from "@sidecar/actions";
import { PRODUCT_EVENT, type ProductEventName } from "@sidecar/analytics";
import {
  HOSTED_ACTION_FAILURE,
  type HostedActionOutcome,
  type HostedActionTarget,
  type HostedActionWorkspaceOutcome,
  type HostedAgentAddition,
  type HostedWorkspaceCreation,
} from "@sidecar/hosted";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  CLOUD_AGENT_PROVIDER_ID,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionIdentity,
  SessionRoster,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { admittedForTest } from "@sidecar/wire/testing";
import { test } from "vitest";
import { HOST_NODE_OPEN_KIND, type HostNodeOpenKind } from "./node-capabilities.js";
import { createSessionActionPerformer } from "./session-action-performer.js";
import type { SettingsStore } from "./settings-store.js";

/*
 * Every write the brain asks for is carried to the service, which admits it
 * once more against the stored snapshot and answers what the provider said.
 * What these tests hold the performer to is its own two ends: what reaches
 * the service — the target, the ask, and the stored pairing a create and a
 * spawn read under the turn's guard — and what the service's answer becomes
 * for the brain, with the redraw and the count a landed write earns. The two
 * reads before a write are the two places a turn can end mid-preparation,
 * so those tests hold the read open, revoke the turn, release it, and
 * assert the service was never asked.
 */

const NOW = 1_800_000_000_000;
const WORKSPACE_LINK = "https://conductor.invalid/workspaces/workspace-1";
const CONDUCTOR = { id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };
const WORKSPACE_IDENTITY: SessionIdentity = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "workspace-1",
};
const LOCAL_IDENTITY: SessionIdentity = {
  providerId: PROVIDER_ID.CODEX,
  providerSessionId: "local-1",
};
const WORKSPACE_OBSERVATION: ProviderSessionObservation = {
  providerSessionId: "workspace-1",
  title: "Fix the flaky test",
  status: SESSION_STATUS.WAITING,
  lastActivityAt: NOW,
  detail: { link: WORKSPACE_LINK },
  advertises: [{ kind: ACTION_KIND.ADD_AGENT, agents: ["claude"] }],
};
const ACCEPTED: HostedActionOutcome = { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } };

interface Carried {
  readonly route: string;
  readonly providerId: string;
  /** The session the act named; a creation names a project instead. */
  readonly providerSessionId: string | undefined;
  readonly ask: string | HostedWorkspaceCreation | HostedAgentAddition;
}

interface Recorded {
  readonly carried: Carried[];
  readonly events: ProductEventName[];
  readonly expected: SessionIdentity[];
  readonly remembered: unknown[][];
  refreshes: number;
  createdOpens: number;
}

/** A settings read that stays open until the test releases it, answering the pairing it was given. */
function heldSettings(stored?: Readonly<Record<string, WorkspaceAgentSelection>>) {
  let release: (() => void) | undefined;
  let reads = 0;
  // SAFETY: the performer reads one field here, workspaceAgentDefaults, and
  // the pairing table is a legal value of it; the generic signature is
  // satisfied for that one field.
  const store: Pick<SettingsStore, "get"> = {
    get: (async () => {
      reads += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return stored;
    }) as SettingsStore["get"],
  };
  return { store, release: () => release?.(), reads: () => reads };
}

interface FixtureOptions {
  outcome?: HostedActionOutcome;
  creation?: HostedActionWorkspaceOutcome;
  settingsStore?: Pick<SettingsStore, "get">;
  openExternal?: (url: string, kind: HostNodeOpenKind) => Promise<void>;
  sendsNetwork?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const outcome = options.outcome ?? ACCEPTED;
  const recorded: Recorded = {
    carried: [],
    events: [],
    expected: [],
    remembered: [],
    refreshes: 0,
    createdOpens: 0,
  };
  const registry = new SessionRoster();
  registry.replaceProvider(CONDUCTOR, [WORKSPACE_OBSERVATION]);
  const carry = (route: string, target: HostedActionTarget, ask: Carried["ask"]) => {
    recorded.carried.push({ route, ...target, ask });
    return outcome;
  };
  const performer = createSessionActionPerformer({
    sessionRegistry: registry,
    openExternal: options.openExternal ?? (async () => {}),
    actions: {
      sendMessage: async (target, text) => carry("message", target, text),
      executeControl: async (target, controlId) => carry("control", target, controlId),
      createWorkspace: async (providerId, creation) => {
        recorded.carried.push({
          route: "workspace",
          providerId,
          providerSessionId: undefined,
          ask: creation,
        });
        return options.creation ?? { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } };
      },
      addAgent: async (target, addition) => carry("agent", target, addition),
      renameSession: async (target, name) => carry("rename-session", target, name),
      renameWorkspace: async (target, name) => carry("rename-workspace", target, name),
    },
    refreshSessions: async () => {
      recorded.refreshes += 1;
    },
    sendsNetwork: options.sendsNetwork ?? true,
    // SAFETY: the performer reads one field here, workspaceAgentDefaults, and
    // an undefined answer is a legal value of it; the generic signature is
    // satisfied for that one field.
    settingsStore: options.settingsStore ?? {
      get: (async () => undefined) as SettingsStore["get"],
    },
    rememberWorkspaceDefaults: async (...remembered) => {
      recorded.remembered.push(remembered);
    },
    expectCreatedWorkspace: (identity) => {
      recorded.expected.push(identity);
    },
    openCreatedWorkspaces: () => {
      recorded.createdOpens += 1;
    },
    trackedIssues: () => undefined,
    issueTrackers: [],
    refreshIssues: () => {},
    recordProductEvent: (name) => {
      recorded.events.push(name);
    },
  });
  return { performer, recorded };
}

// What admission would have minted, since only an admitted act reaches a performer.
const OPEN: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.OPEN,
  identity: WORKSPACE_IDENTITY,
  origin: RUN_ORIGIN.USER,
});
const CREATE: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.CREATE_WORKSPACE,
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerProjectId: "project-1",
  task: "add tests",
  origin: RUN_ORIGIN.USER,
});
const SPAWN: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.ADD_AGENT,
  identity: WORKSPACE_IDENTITY,
  agent: "claude",
  origin: RUN_ORIGIN.USER,
});
const MESSAGE: ValidatedAction<SessionActionKind> = admittedForTest({
  kind: ACTION_KIND.MESSAGE,
  identity: WORKSPACE_IDENTITY,
  text: "ship it",
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

test("a create whose turn ends while the stored defaults are read never reaches the service", async () => {
  const settings = heldSettings();
  const { performer, recorded } = fixture({ settingsStore: settings.store });
  let revoked = false;
  const pending = performer.perform(CREATE, { isRevoked: () => revoked });
  await drainMicrotasks(10);
  assert.equal(settings.reads(), 1);
  assert.deepEqual(recorded.carried, []);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(result.reason, ACTION_REFUSAL.TURN_OVER);
  assert.deepEqual(recorded.carried, []);
});

test("a spawn whose turn ends while the stored defaults are read never reaches the service", async () => {
  const settings = heldSettings();
  const { performer, recorded } = fixture({ settingsStore: settings.store });
  let revoked = false;
  const pending = performer.perform(SPAWN, { isRevoked: () => revoked });
  await drainMicrotasks(10);
  assert.equal(settings.reads(), 1);
  revoked = true;
  settings.release();
  const result = await pending;
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(result.reason, ACTION_REFUSAL.TURN_OVER);
  assert.deepEqual(recorded.carried, []);
});

test("a create whose turn is cancelled while the stored defaults are read settles at once, and the late read lands nothing", async () => {
  const settings = heldSettings();
  const { performer, recorded } = fixture({ settingsStore: settings.store });
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
  assert.deepEqual(recorded.carried, []);
  // A call with no signal waits the read out, as before.
  const direct = performer.perform(CREATE, { isRevoked: () => false });
  await drainMicrotasks(10);
  settings.release();
  assert.equal((await direct).status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(recorded.carried.length, 1);
});

test("a create carries the project, the task, and the stored pairing, and the session the provider made rides back as the created session", async () => {
  const settings = heldSettings({
    [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: { agent: "claude", model: "fable-5", effort: "high" },
  });
  const { performer, recorded } = fixture({
    settingsStore: settings.store,
    creation: {
      answer: { result: ACTION_RESULT_STATUS.ACCEPTED, providerSessionId: "session-new" },
    },
  });

  const creating = performer.perform(CREATE, { isRevoked: () => false });
  await drainMicrotasks(10);
  settings.release();
  const result = await creating;

  assert.deepEqual(result, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    createdSession: {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      providerSessionId: "session-new",
    },
  });
  assert.deepEqual(recorded.carried, [
    {
      route: "workspace",
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      providerSessionId: undefined,
      ask: {
        providerProjectId: "project-1",
        agent: "claude",
        model: "fable-5",
        effort: "high",
        name: undefined,
        task: "add tests",
      },
    },
  ]);
  // The created session waits to be opened by the pass that first reports
  // it, the default is remembered, the roster is drawn again, and the
  // creation is counted once.
  assert.deepEqual(recorded.expected, [
    { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, providerSessionId: "session-new" },
  ]);
  assert.equal(recorded.createdOpens, 1);
  assert.deepEqual(recorded.remembered, [
    [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "project-1", undefined],
  ]);
  assert.equal(recorded.refreshes, 1);
  assert.deepEqual(recorded.events, [PRODUCT_EVENT.SESSION_ACTION_SEND]);
});

test("a spawn carries the stored model only for the very agent it pairs with", async () => {
  const paired = heldSettings({
    [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: { agent: "claude", model: "fable-5" },
  });
  const other = heldSettings({
    [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: { agent: "codex", model: "gpt-5", effort: "high" },
  });
  const withPair = fixture({ settingsStore: paired.store });
  const withOther = fixture({ settingsStore: other.store });

  const spawning = withPair.performer.perform(SPAWN, { isRevoked: () => false });
  await drainMicrotasks(10);
  paired.release();
  assert.equal((await spawning).status, ACTION_RESULT_STATUS.ACCEPTED);
  const unpaired = withOther.performer.perform(SPAWN, { isRevoked: () => false });
  await drainMicrotasks(10);
  other.release();
  assert.equal((await unpaired).status, ACTION_RESULT_STATUS.ACCEPTED);

  assert.deepEqual(withPair.recorded.carried, [
    {
      route: "agent",
      ...WORKSPACE_IDENTITY,
      ask: {
        agent: "claude",
        model: "fable-5",
        effort: undefined,
        name: undefined,
        task: undefined,
      },
    },
  ]);
  assert.deepEqual(withOther.recorded.carried[0]?.ask, {
    agent: "claude",
    model: undefined,
    effort: undefined,
    name: undefined,
    task: undefined,
  });
});

test("a message, a control, and the two renames each name the session and carry the ask to the service", async () => {
  const { performer, recorded } = fixture();

  await performer.perform(MESSAGE);
  await performer.perform(
    admittedForTest({
      kind: ACTION_KIND.CONTROL,
      identity: WORKSPACE_IDENTITY,
      control: { kind: ACTION_KIND.CONTROL, id: "cancel-run", label: "Stop" },
      origin: RUN_ORIGIN.USER,
    }),
  );
  await performer.perform(
    admittedForTest({
      kind: ACTION_KIND.RENAME_SESSION,
      identity: WORKSPACE_IDENTITY,
      name: "Flaky test",
      origin: RUN_ORIGIN.USER,
    }),
  );
  await performer.perform(
    admittedForTest({
      kind: ACTION_KIND.RENAME_WORKSPACE,
      identity: WORKSPACE_IDENTITY,
      name: "flaky-test",
      origin: RUN_ORIGIN.USER,
    }),
  );

  assert.deepEqual(recorded.carried, [
    { route: "message", ...WORKSPACE_IDENTITY, ask: "ship it" },
    { route: "control", ...WORKSPACE_IDENTITY, ask: "cancel-run" },
    { route: "rename-session", ...WORKSPACE_IDENTITY, ask: "Flaky test" },
    { route: "rename-workspace", ...WORKSPACE_IDENTITY, ask: "flaky-test" },
  ]);
  assert.equal(recorded.refreshes, 4);
  assert.equal(recorded.events.length, 4);
});

test("a session behind no cloud provider is refused before any call, and a fixture run creates nothing", async () => {
  const { performer, recorded } = fixture({ sendsNetwork: false });

  const local = await performer.perform(
    admittedForTest({
      kind: ACTION_KIND.MESSAGE,
      identity: LOCAL_IDENTITY,
      text: "hello",
      origin: RUN_ORIGIN.USER,
    }),
  );
  const offline = await performer.perform(CREATE);

  assert.equal(local.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(offline.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.deepEqual(recorded.carried, []);
  assert.equal(recorded.refreshes, 0);
  assert.deepEqual(recorded.events, []);
});

test("what the service answers reaches the brain as the result it means, and only a landed write is counted", async () => {
  const lost = fixture({ outcome: { failure: HOSTED_ACTION_FAILURE.LOST } });
  const refused = fixture({
    outcome: { answer: { result: ACTION_RESULT_STATUS.REJECTED, reason: "That run has ended." } },
  });
  const unsupported = fixture({
    outcome: { answer: { result: ACTION_RESULT_STATUS.UNSUPPORTED, reason: "No way in." } },
  });

  const uncertain = await lost.performer.perform(MESSAGE);
  const rejected = await refused.performer.perform(MESSAGE);
  const untaken = await unsupported.performer.perform(MESSAGE);

  // An answer lost may have landed: the roster is drawn again, and nothing is counted.
  assert.equal(uncertain.status, UNKNOWN_ACTION_STATUS);
  assert.equal(lost.recorded.refreshes, 1);
  assert.deepEqual(lost.recorded.events, []);
  assert.deepEqual(rejected, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: "That run has ended.",
  });
  assert.equal(refused.recorded.refreshes, 1);
  // A write the provider cannot take at all moved nothing, so nothing is redrawn.
  assert.equal(untaken.status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(unsupported.recorded.refreshes, 0);
});

test("an open the brain carries tells the node it was asked of Luke, and a row press hands it an address", async () => {
  const node = recordingOpens();
  const { performer } = fixture({ openExternal: node.openExternal });
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
  const { performer } = fixture({ openExternal: node.openExternal });
  const absent = admittedForTest({
    kind: ACTION_KIND.OPEN,
    identity: {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      providerSessionId: "workspace-gone",
    },
    origin: RUN_ORIGIN.USER,
  });
  assert.equal((await performer.perform(absent)).status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(node.opens.length, 0);

  const failing = fixture({
    openExternal: async () => {
      throw new Error("no application claims that address");
    },
  });
  assert.equal((await failing.performer.perform(OPEN)).status, ACTION_RESULT_STATUS.REJECTED);
});
