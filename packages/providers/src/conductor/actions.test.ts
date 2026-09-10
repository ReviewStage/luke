import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  advertisedActionFor,
  dispatchAction,
  UNSUPPORTED_BY_OBSERVATION,
} from "@sidecar/session";
import { admittedForTest } from "@sidecar/wire/testing";
import { CLOUD_ADAPTER_DEFAULTS } from "../shared/cloud-wire.js";
import {
  fakeConductorApi,
  LUKE_PROJECT,
  ownedWorkspace,
  pluginFor,
  TEST_API_KEY,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
} from "../testing/conductor-api.js";
import { CONDUCTOR_WRITE_ROUTE } from "./actions.js";

test("hands a user prompt to Conductor's documented message endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "message",
    admittedForTest({
      providerSessionId: "session-idle",
      text: "Rebase onto main before continuing",
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-idle/messages");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    message: "Rebase onto main before continuing",
  });
});

test("stops a working turn through Conductor's cancel endpoint, sending no body", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-working",
      control: {
        kind: ACTION_KIND.CONTROL,
        id: "cancel-turn",
        label: "Stop this turn",
        controlKind: "stop",
      },
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-working/cancel");
  // Conductor documents no body for a cancel.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("archives the workspace the user saw through Conductor's archive endpoint, sending no body", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  // Deliberately without a target: the route must be built from the control
  // the adapter itself advertised, never from the caller's copy of it.
  const result = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-idle",
      control: { kind: ACTION_KIND.CONTROL, id: "archive-workspace", label: "Archive" },
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces/workspace-active/archive");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // Conductor documents no body for an archive.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("asks the slow deadline for an archive, whose answer waits on the workspace standing down", () => {
  // Archiving answers only once the workspace is filed away, measured near
  // eleven seconds against the live API and past the shared request bound. A
  // deadline shorter than the action gives up mid-write and reports an archive
  // that landed as one that may not have.
  assert.equal(
    CONDUCTOR_WRITE_ROUTE.archiveWorkspace("workspace-active").timeoutMs,
    CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  );
  // The turn's stop answers at once, so it rides the shared bound.
  assert.equal(CONDUCTOR_WRITE_ROUTE.cancelTurn("session-working").timeoutMs, undefined);
});

test("refuses to archive a workspace no row advertised, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  // A working workspace advertised only the turn's stop, so an archive ask
  // has nothing behind it and no request exists — whatever target the caller
  // writes into their copy of the control.
  const result = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-working",
      control: {
        kind: ACTION_KIND.CONTROL,
        id: "archive-workspace",
        label: "Archive",
        target: "workspace-active",
      },
    }),
  );

  assert.deepEqual(result, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("renames the workspace behind an observed row through Conductor's rename endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  const observations = await plugin.observe();

  // Every open workspace is renameable, so the target rides every chat's
  // advertisement the way the spawn target does.
  assert.equal(
    advertisedActionFor(observations[0] ?? {}, ACTION_KIND.RENAME_WORKSPACE)?.target,
    "workspace-active",
  );

  const result = await dispatchAction(
    plugin,
    "renameWorkspace",
    admittedForTest({
      providerSessionId: "session-idle",
      name: "Payments rollout",
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces/workspace-active/rename");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? "{}"), { name: "Payments rollout" });
});

test("renames an observed chat itself through Conductor's session rename endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  const observations = await plugin.observe();

  // Any open chat is renameable, whatever its turn is doing.
  assert.notEqual(
    advertisedActionFor(observations[0] ?? {}, ACTION_KIND.RENAME_SESSION),
    undefined,
  );

  const result = await dispatchAction(
    plugin,
    "renameSession",
    admittedForTest({
      providerSessionId: "session-idle",
      name: "Payments audit",
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-idle/rename");
  assert.deepEqual(JSON.parse(write?.body ?? "{}"), { name: "Payments audit" });
});

test("refuses a chat rename for a session no pass observed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const result = await dispatchAction(
    plugin,
    "renameSession",
    admittedForTest({
      providerSessionId: "session-unseen",
      name: "Payments audit",
    }),
  );

  assert.deepEqual(result, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("refuses a rename for a session no pass observed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const result = await dispatchAction(
    plugin,
    "renameWorkspace",
    admittedForTest({
      providerSessionId: "session-unseen",
      name: "Payments rollout",
    }),
  );

  assert.deepEqual(result, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(api.requests.length, requestsBefore);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("offers the projects the last pass listed as places a workspace can be created", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const plugin = pluginFor(api.fetch);

  // Nothing is offered before observation, or after the credential goes: the
  // offer is the last pass's own project list and nothing longer-lived.
  assert.deepEqual(plugin.projects?.() ?? [], []);
  await plugin.observe();
  assert.deepEqual(plugin.projects?.() ?? [], [
    // Conductor makes an idle workspace happily, so the task is optional.
    { providerProjectId: LUKE_PROJECT.id, repository: "luke", taskSupport: "optional" },
  ]);
});

test("creates a workspace through Conductor's documented creation endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const named = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: LUKE_PROJECT.id,
      name: "fix the notch panel",
    }),
  );

  // The acceptance names the session the response did, so the surface can
  // open the workspace once observation reports it — an id, never an address.
  assert.deepEqual(named, { status: "accepted", providerSessionId: "session-new" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    name: "fix the notch panel",
  });

  // Left unnamed, the ask carries no name at all: Conductor generates one, and
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // an empty field is not the same request as an absent one.
  const unnamed = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: LUKE_PROJECT.id }),
  );
  assert.deepEqual(unnamed, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), { projectId: LUKE_PROJECT.id });
});

test("an acceptance whose response names no session stays a plain acceptance", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
    createWithoutSessionId: true,
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: LUKE_PROJECT.id }),
  );

  // Nothing named means nothing to wait on: the workspace stands unopened
  // rather than correlated by a guess.
  assert.deepEqual(result, { status: "accepted" });
});

test("a chosen agent and model ride the creation, and an unlisted pairing does not", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A selection the build's table lists is sent exactly as documented, the
  // effort riding along when one was chosen.
  const chosen = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: LUKE_PROJECT.id,
      agentSelection: { agent: "claude", model: "sonnet", effort: "max" },
    }),
  );
  assert.deepEqual(chosen, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    agent: "claude",
    model: "sonnet",
    effort: "max",
  });

  // No effort chosen sends none, so Conductor's default effort stands.
  const effortless = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: LUKE_PROJECT.id,
      agentSelection: { agent: "claude", model: "sonnet" },
    }),
  );
  assert.deepEqual(effortless, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    agent: "claude",
    model: "sonnet",
  });

  // A selection outside the table — a foreign model, or an effort its agent
  // does not document — is dropped whole rather than sent: the adapter
  // answers for its own writes, and Conductor's defaults stand instead.
  for (const agentSelection of [
    { agent: "claude", model: "gpt-5.5" },
    { agent: "claude", model: "sonnet", effort: "ultra" },
  ]) {
    const unlisted = await dispatchAction(
      plugin,
      "createWorkspace",
      admittedForTest({
        providerProjectId: LUKE_PROJECT.id,
        agentSelection,
      }),
    );
    assert.deepEqual(unlisted, { status: "accepted", providerSessionId: "session-new" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      projectId: LUKE_PROJECT.id,
    });
  }

  // No choice at all sends no agent and no model, so Conductor's own
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // defaults decide — an absent field is not the same request as a guessed one.
  await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: LUKE_PROJECT.id }),
  );
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
  });
});

test("refuses a creation ask for a project the last pass did not list", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const unlisted = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({ providerProjectId: "project-unknown" }),
  );

  // No request exists for a project observation did not see.
  assert.deepEqual(unlisted, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("hands an opening task to the first session the creation response names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: LUKE_PROJECT.id,
      task: "Add a smoke test for the panel motion",
    }),
  );

  assert.deepEqual(result, { status: "accepted", providerSessionId: "session-new" });
  // Two documented writes, in order: the creation, then the message to
  // exactly the session Conductor said it made.
  const writes = api.requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    writes.map((request) => request.pathname),
    ["/v0/workspaces", "/v0/sessions/session-new/messages"],
  );
  assert.deepEqual(JSON.parse(writes[1]?.body ?? ""), {
    message: "Add a smoke test for the panel motion",
  });
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a workspace whose task could not be delivered as exactly that", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
    createWithoutSessionId: true,
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "createWorkspace",
    admittedForTest({
      providerProjectId: LUKE_PROJECT.id,
      task: "Add a smoke test",
    }),
  );

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The workspace stands, so claiming failure outright would be as wrong as
  // claiming success: the answer says which half landed.
  assert.equal(result.status, "rejected");
  // No message request was guessed at without a session to send it to.
  const writes = api.requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    writes.map((request) => request.pathname),
    ["/v0/workspaces"],
  );
});

test("starts another agent in the workspace behind an observed row", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  const observations = await plugin.observe();

  // The roster row says which agents its workspace can take, exactly as the
  // endpoint takes them.
  assert.deepEqual(advertisedActionFor(observations[0] ?? {}, ACTION_KIND.ADD_AGENT)?.agents, [
    "claude",
    "codex",
    "cursor",
  ]);

  const result = await dispatchAction(
    plugin,
    "spawnAgent",
    admittedForTest({
      providerSessionId: "session-idle",
      agent: "codex",
      name: "xyz feature",
      task: "Build the XYZ feature",
    }),
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // The workspace is read back from the pass, and the opening task rides the
  // creation itself — Conductor documents the first message inline.
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    workspaceId: "workspace-active",
    agent: "codex",
    name: "xyz feature",
    message: "Build the XYZ feature",
  });
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stored model rides a new agent only as the pairing the table lists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  // A model documented for the asked-for agent kind rides along, its effort
  // beside it when one was chosen.
  const listed = await dispatchAction(
    plugin,
    "spawnAgent",
    admittedForTest({
      providerSessionId: "session-idle",
      agent: "codex",
      model: "gpt-5.6-sol",
      effort: "ultra",
    }),
  );
  assert.deepEqual(listed, { status: "accepted" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    workspaceId: "workspace-active",
    agent: "codex",
    model: "gpt-5.6-sol",
    effort: "ultra",
  });

  // A selection outside the table — the model documented for a different
  // agent, or an effort this one does not take — is dropped whole rather than
  // sent, so the asked-for kind starts on Conductor's own defaults instead of
  // erroring.
  for (const stored of [
    { model: "sonnet" },
    { model: "gpt-5.6-sol", effort: "not-a-level" },
  ] as const) {
    const mismatched = await dispatchAction(
      plugin,
      "spawnAgent",
      admittedForTest({
        providerSessionId: "session-idle",
        agent: "codex",
        ...stored,
      }),
    );
    assert.deepEqual(mismatched, { status: "accepted" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      workspaceId: "workspace-active",
      agent: "codex",
    });
  }
});

test("refuses to start an agent the row never listed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  // An agent kind the observation did not list, and a session the pass did
  // not emit, are both nowhere to land.
  const unlisted = await dispatchAction(
    plugin,
    "spawnAgent",
    admittedForTest({
      providerSessionId: "session-idle",
      agent: "acp",
    }),
  );
  const unobserved = await dispatchAction(
    plugin,
    "spawnAgent",
    admittedForTest({
      providerSessionId: "session-unseen",
      agent: "claude",
    }),
  );

  assert.deepEqual(unlisted, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.deepEqual(unobserved, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(api.requests.length, requestsBefore);
});

// --- Conversation reading ---
