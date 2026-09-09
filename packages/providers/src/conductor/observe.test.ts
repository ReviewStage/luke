import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  advertisedActionFor,
  advertisedControls,
  SESSION_STATUS,
} from "@sidecar/session";
import type { CloudFetch } from "@sidecar/wire";
import { HTTP_STATUS, jsonResponse } from "@sidecar/wire/testing";
import {
  ERRORED_SESSION_UUID,
  fakeConductorApi,
  IDLE_SESSION_UUID,
  isoTimestamp,
  LUKE_PROJECT,
  OTHER_USER_ID,
  ownedWorkspace,
  pluginFor,
  SECOND_IDLE_SESSION_UUID,
  TEST_API_KEY,
  TEST_CONDUCTOR_STATUS,
  TEST_ERROR_MESSAGE,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_TRANSCRIPT_WORDS,
  TEST_USER_ID,
  TEST_WORKSPACE_NAME,
  type TestSession,
  WORKING_SESSION_UUID,
} from "../testing/conductor-api.js";
import { CONDUCTOR_PROVIDER } from "./vocabulary.js";

test("names every action Conductor documents, and none it does not", () => {
  const plugin = pluginFor(async () => new Response("{}", { status: 200 }));

  assert.deepEqual(Object.keys(plugin.actions ?? {}).sort(), [
    "control",
    "createWorkspace",
    "message",
    "renameSession",
    "renameWorkspace",
    "spawnAgent",
  ]);
  // A cloud session's conversation lives with its provider: the developer's
  // own conversation read is the one read here, and no transcript read at all.
  assert.deepEqual(Object.keys(plugin.reads ?? {}), ["conversation"]);
});
test("observes cloud sessions the signed-in user created, under their own names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        resolvedModel: "claude-opus-5",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(CONDUCTOR_PROVIDER, { id: "conductor", displayName: "Conductor" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-working");
  // Titled by the chat's own name, grouped under the workspace's — the name
  // the user knows the work by — and neither is a branch, so no branch is
  // reported at all. Conductor manages the workspace, so the grouping carries
  // its mark the way a Superset workspace carries Superset's.
  assert.equal(observations[0]?.title, TEST_SESSION_NAME);
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-active",
    name: TEST_WORKSPACE_NAME,
    scopeId: "conductor",
    managerName: "Conductor",
  });
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.lastActivityAt, TEST_TIME - 5_000);
  // A working session can be stopped and can take a message, both documented.
  assert.deepEqual(advertisedControls(observations[0] ?? {}), [
    { kind: ACTION_KIND.CONTROL, id: "cancel-turn", label: "Stop this turn", controlKind: "stop" },
  ]);
  assert.notEqual(advertisedActionFor(observations[0] ?? {}, ACTION_KIND.MESSAGE), undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    model: "claude-opus-5",
    link: "conductor://workspace?session=session-working",
  });
  assert.equal(
    api.requests.every((request) => request.method === "GET"),
    true,
  );
  assert.equal(
    api.requests.every((request) => request.authorization === `Bearer ${TEST_API_KEY}`),
    true,
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports an idle session as waiting and an errored session with its reason", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-errored", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-errored",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[1]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[1]?.detail?.error, TEST_ERROR_MESSAGE);
});

test("words a workspace still being built onto its rows, ready and asleep say nothing", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-building", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
      },
      {
        ...ownedWorkspace("workspace-rebuilding", TEST_TIME - 10_000),
        lifecycleStatus: "updating",
      },
      { ...ownedWorkspace("workspace-ready", TEST_TIME - 20_000) },
      { ...ownedWorkspace("workspace-asleep", TEST_TIME - 30_000), lifecycleStatus: "sleeping" },
    ],
    sessions: [
      { id: "chat-building", workspaceId: "workspace-building", name: TEST_SESSION_NAME },
      { id: "chat-rebuilding", workspaceId: "workspace-rebuilding", name: TEST_SESSION_NAME },
      { id: "chat-ready", workspaceId: "workspace-ready", name: TEST_SESSION_NAME },
      { id: "chat-asleep", workspaceId: "workspace-asleep", name: TEST_SESSION_NAME },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // A workspace being stood up or rebuilt is why its chat sits quiet, so the
  // row says so; a ready workspace is the normal case and a sleeping one is
  // Conductor's own economy, so neither takes the activity slot.
  assert.equal(byId.get("chat-building")?.detail?.activity, "Workspace initializing");
  assert.equal(byId.get("chat-rebuilding")?.detail?.activity, "Workspace updating");
  assert.equal(byId.get("chat-ready")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-asleep")?.detail?.activity, undefined);
});

test("reports the failure that kept a workspace from coming up, behind the chat's own", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-failed", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
        lifecycleErrorMessage: "The setup script exited with status 1",
      },
      {
        ...ownedWorkspace("workspace-both-failed", TEST_TIME - 10_000),
        lifecycleStatus: "ready",
        lifecycleErrorMessage: "The snapshot could not be restored",
      },
    ],
    sessions: [
      {
        id: "chat-quietly-failed",
        workspaceId: "workspace-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A chat with a failure of its own is telling the user about the turn
      // they are watching, which outranks the machinery around it.
      {
        id: "chat-loudly-failed",
        workspaceId: "workspace-both-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(
    byId.get("chat-quietly-failed")?.detail?.error,
    "The setup script exited with status 1",
  );
  assert.equal(byId.get("chat-loudly-failed")?.detail?.error, TEST_ERROR_MESSAGE);
});

test("a failed lifecycle read costs the workspace's words, never the pass", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-unreadable", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
        lifecycleHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
    ],
    sessions: [
      {
        id: "chat-unreadable",
        workspaceId: "workspace-unreadable",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(observations.length, 1);
  assert.equal(byId.get("chat-unreadable")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-unreadable")?.status, SESSION_STATUS.WAITING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reads each chat's agent kind from the transcripts view, and nothing else", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-second-idle", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        resolvedModel: "gpt-5.5",
        agentType: "codex",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A settled chat with no model reported still names its agent kind.
      {
        id: SECOND_IDLE_SESSION_UUID,
        workspaceId: "workspace-second-idle",
        name: TEST_SESSION_NAME,
        agentType: "claude",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  const idle = observations.find((candidate) => candidate.providerSessionId === IDLE_SESSION_UUID);
  const secondIdle = observations.find(
    (candidate) => candidate.providerSessionId === SECOND_IDLE_SESSION_UUID,
  );
  // A mapped agent kind becomes the agent itself — the identity the row's
  // mark leads with — and the model rides plain beside it.
  assert.equal(idle?.detail?.model, "gpt-5.5");
  assert.deepEqual(idle?.agent, { id: "codex", displayName: "Codex" });
  assert.equal(secondIdle?.detail?.model, undefined);
  assert.deepEqual(secondIdle?.agent, { id: "claude-code", displayName: "Claude Code" });

  // One read document for the whole pass, fixed by the build: the SELECT this
  // build wrote, naming exactly the observed session ids and nothing else.
  const reads = api.requests.filter((request) => request.method === "POST");
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.pathname, "/v0/sql");
  assert.equal(reads[0]?.authorization, `Bearer ${TEST_API_KEY}`);
  // The view holds each chat's transcript too, and the document names no
  // column of it: an observation pass reads who runs the chat, never what
  // was said in it, so no observation carries a word of the conversation.
  const { query } = JSON.parse(reads[0]?.body ?? "");
  assert.equal(
    query,
    "SELECT session_id, agent_type FROM session_transcripts_view WHERE session_id IN " +
      `('${IDLE_SESSION_UUID}', '${SECOND_IDLE_SESSION_UUID}')`,
  );
  assert.doesNotMatch(query, /\btranscript\b/);
  assert.doesNotMatch(JSON.stringify(observations), new RegExp(TEST_TRANSCRIPT_WORDS));
});

test("reports the agent kind whatever state the chat is in", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-working", TEST_TIME - 30_000),
      ownedWorkspace("workspace-errored", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: WORKING_SESSION_UUID,
        workspaceId: "workspace-working",
        name: TEST_SESSION_NAME,
        agentType: "cursor",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: ERRORED_SESSION_UUID,
        workspaceId: "workspace-errored",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  // The agent kind is configuration, not conversation, so it rides regardless.
  const working = observations.find(
    (candidate) => candidate.providerSessionId === WORKING_SESSION_UUID,
  );
  assert.deepEqual(working?.agent, { id: "cursor", displayName: "Cursor" });
});

test("keeps a session id that is not a UUID out of the read document", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-odd", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // An id of a shape this build does not know may not enter the document.
      {
        id: "session'); DROP VIEW session_transcripts_view; --",
        workspaceId: "workspace-odd",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  await pluginFor(api.fetch).observe();

  const reads = api.requests.filter((request) => request.pathname === "/v0/sql");
  assert.equal(reads.length, 1);
  assert.ok(reads[0]?.body?.includes(IDLE_SESSION_UUID));
  assert.equal(reads[0]?.body?.includes("DROP"), false);

  // With no UUID ids at all there is nothing to ask, so nothing is asked.
  const uuidlessApi = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-odd", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-plain",
        workspaceId: "workspace-odd",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });
  await pluginFor(uuidlessApi.fetch).observe();
  assert.equal(
    uuidlessApi.requests.every((request) => request.method === "GET"),
    true,
  );
});

test("a refused transcripts read costs the agent kind, never the pass", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-idle", TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        resolvedModel: "gpt-5.5",
        agentType: "codex",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.SERVER_ERROR,
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.agent, undefined);
  assert.equal(observations[0]?.detail?.model, "gpt-5.5");

  // Even a credential refusal on this one endpoint costs only the agent kind: a
  // key an org scopes away from the query endpoint still reads the roster,
  // and only the roster reads may judge the credential.
  const scopedKeyApi = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-idle", TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.UNAUTHORIZED,
  });

  const scopedKeyObservations = await pluginFor(scopedKeyApi.fetch).observe();

  assert.equal(scopedKeyObservations.length, 1);
  assert.equal(scopedKeyObservations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(scopedKeyObservations[0]?.agent, undefined);
});

// Every chat of a workspace is its own row, so no chat has to speak for a
// sibling: a workspace holding a failure and work still running is two facts,
// and each row reports its own state, opens its own place, and carries the
// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
// workspace as the group a surface seats them together by.
test("reports every chat in a workspace, each grouped under it", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-shared", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-shared",
        name: "Revamp the notch panel",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-shared",
        name: "Chase the memory leak",
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(observations.length, 2);
  assert.equal(byId.get("session-working")?.title, "Revamp the notch panel");
  assert.equal(byId.get("session-working")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("session-errored")?.title, "Chase the memory leak");
  assert.equal(byId.get("session-errored")?.status, SESSION_STATUS.ERROR);
  // Each row opens its own chat, and both carry the same workspace group.
  assert.equal(
    byId.get("session-errored")?.detail?.link,
    "conductor://workspace?session=session-errored",
  );
  for (const observation of observations) {
    assert.deepEqual(observation.workspace, {
      providerWorkspaceId: "workspace-shared",
      name: TEST_WORKSPACE_NAME,
      scopeId: "conductor",
      managerName: "Conductor",
    });
    // The Conductor mark rides each chat as an app association carrying the
    // chat's own exact address, so the trailing mark opens the same place the
    // row does — and the address names the exact chat, so the association is
    // the session's own and its mark rides the row even inside the tray.
    assert.deepEqual(observation.applications, [
      {
        id: "conductor",
        displayName: "Conductor",
        scope: "session",
        link: observation.detail?.link,
      },
    ]);
  }
});

test("does not carry a past failure into a session that recovered", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-recovered",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
        lastError: "An earlier failure this session already got past",
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  // `lastError` is the last failure a session ever had, not its current state,
  // and the row puts an error ahead of everything else on it.
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.detail?.error, undefined);
});

test("keeps an errored session errored after it goes stale", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30 * 60 * 1000)],
    sessions: [
      {
        id: "session-errored",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 30 * 60 * 1000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  // A failure does not heal by going stale, unlike an idle chat.
  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
});

test("titles each chat by its own name and its group by the workspace's", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-one", TEST_TIME - 30_000), name: "lisbon-v2" },
      { ...ownedWorkspace("workspace-two", TEST_TIME - 40_000), name: "porto-v1" },
    ],
    sessions: [
      // The chat's name tells it from its siblings; the workspace's name — the
      // one the user chose or accepted — names the group around it.
      {
        id: "session-one",
        workspaceId: "workspace-one",
        name: "Revamp the notch panel",
        statusUpdatedAt: TEST_TIME - 5_000,
      },
      {
        id: "session-two",
        workspaceId: "workspace-two",
        name: "Observe Cursor cloud agents",
        statusUpdatedAt: TEST_TIME - 6_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["Revamp the notch panel", "Observe Cursor cloud agents"],
  );
  assert.deepEqual(
    observations.map((observation) => observation.workspace?.name),
    ["lisbon-v2", "porto-v1"],
  );
});

// Filing a chat away is how a user says that one conversation is done being
// watched, so it earns no row at all — however recently it was filed, and
// whatever it was doing when it was. Its open sibling keeps its own row, and
// the drop happens before the pass ever asks after the filed chat, so it
// costs no status request and never enters the transcripts read.
test("leaves a filed-away chat off the roster while its workspace stays", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-quieted", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-open",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 10_000,
      },
      {
        id: "session-archived",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 10_000),
        status: TEST_CONDUCTOR_STATUS.WORKING,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // The filed-away chat neither settles the workspace nor holds it open: the
  // open sibling's own settled turn is what offers the archive.
  assert.deepEqual(advertisedControls(observations[0] ?? {}), [
    {
      kind: ACTION_KIND.CONTROL,
      id: "archive-workspace",
      label: "Archive",
      controlKind: "archive",
      target: "workspace-quieted",
    },
  ]);
  // Dropped before it is ever asked for: the filed-away chat costs no status
  // request, not just no row.
  assert.equal(
    api.requests.some((request) => request.pathname.includes("session-archived")),
    false,
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("keeps reporting a long turn as working", async () => {
  // Only waiting decays with age, so a turn that started an hour ago and is
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // still running must not read as stale.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-long-turn", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-long-turn",
        workspaceId: "workspace-long-turn",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: startedAt,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.lastActivityAt, startedAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("does not treat a long-idle chat as waiting because its workspace is busy", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    // A workspace's activity timestamp moves whenever anything in it runs, so
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // it can read as fresh while the chat inside was walked away from hours
    // ago. Staleness has to be judged on the chat's own status timestamp.
    workspaces: [
      ownedWorkspace("workspace-busy", TEST_TIME - 1_000),
      ownedWorkspace("workspace-fresh", TEST_TIME - 2_000),
    ],
    sessions: [
      {
        id: "session-abandoned",
        workspaceId: "workspace-busy",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
      },
      {
        id: "session-just-finished",
        workspaceId: "workspace-fresh",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 20_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.equal(observations[0]?.providerSessionId, "session-abandoned");
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observations[1]?.providerSessionId, "session-just-finished");
  assert.equal(observations[1]?.status, SESSION_STATUS.WAITING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("adopts the provider's timestamp again the moment the chat's work moves", async () => {
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-resumed", walkedAwayAt);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-resumed",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const plugin = pluginFor(api.fetch, { now: () => now });
  await plugin.observe();

  // The user sends the woken chat a message: the status itself moves.
  now = TEST_TIME + 60_000;
  chat.status = TEST_CONDUCTOR_STATUS.WORKING;
  chat.statusUpdatedAt = now;
  workspace.lastActivityAt = now;
  const working = await plugin.observe();
  assert.equal(working[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(working[0]?.lastActivityAt, now);

  // The turn settles: freshly waiting, on the provider's own timestamp for
  // the settle.
  const settledAt = TEST_TIME + 120_000;
  now = settledAt + 5_000;
  chat.status = TEST_CONDUCTOR_STATUS.IDLE;
  chat.statusUpdatedAt = settledAt;
  const settled = await plugin.observe();
  assert.equal(settled[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(settled[0]?.lastActivityAt, settledAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a whole turn between passes reads as unmoved", async () => {
  // A short turn can start and settle inside one refresh interval, so both
  // passes read idle. Status and failure are the only facts compared, and
  // neither moved, so the wake-bumped timestamp is not adopted: the accepted
  // cost of reading no words of the conversation is that such a turn keeps
  // the moment already reported.
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-quick-turn", walkedAwayAt);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-quick-turn",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const plugin = pluginFor(api.fetch, { now: () => now });
  await plugin.observe();

  const settledAt = TEST_TIME + 60_000;
  now = settledAt + 5_000;
  chat.statusUpdatedAt = settledAt;
  workspace.lastActivityAt = settledAt;
  const settled = await plugin.observe();
  assert.equal(settled[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(settled[0]?.lastActivityAt, settledAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a chat with no readable status falls back to its workspace's moment", async () => {
  // The workspace's timestamp covers every sibling chat, so it stands only
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // while the chat's own status read says nothing, and yields to it after.
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-first-unreadable", TEST_TIME - 1_000);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-first-unreadable",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
    statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const plugin = pluginFor(api.fetch, { now: () => now });

  const unreadable = await plugin.observe();
  assert.equal(unreadable[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(unreadable[0]?.lastActivityAt, workspace.lastActivityAt);

  now = TEST_TIME + 60_000;
  delete chat.statusHttpStatus;
  const readable = await plugin.observe();
  assert.equal(readable[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(readable[0]?.lastActivityAt, walkedAwayAt);
});

test("ignores workspaces created by another user and workspaces without a creator", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        id: "workspace-teammate",
        projectId: LUKE_PROJECT.id,
        name: TEST_SESSION_NAME,
        creatorId: OTHER_USER_ID,
        lastActivityAt: TEST_TIME - 1_000,
      },
      {
        id: "workspace-unattributed",
        projectId: LUKE_PROJECT.id,
        name: TEST_SESSION_NAME,
        lastActivityAt: TEST_TIME - 1_000,
      },
    ],
    sessions: [
      { id: "session-teammate", workspaceId: "workspace-teammate", name: TEST_SESSION_NAME },
      {
        id: "session-unattributed",
        workspaceId: "workspace-unattributed",
        name: TEST_SESSION_NAME,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(observations, []);
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-teammate")),
    false,
  );
});

test("keeps a workspace untouched since the day before yesterday", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-yesterday", TEST_TIME - 48 * 60 * 60 * 1000)],
    sessions: [
      { id: "session-yesterday", workspaceId: "workspace-yesterday", name: TEST_SESSION_NAME },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-yesterday"],
  );
});

test("observes every workspace and chat the pages hold", async () => {
  const workspaces = Array.from({ length: 6 }, (_value, index) =>
    ownedWorkspace(`workspace-${index}`, TEST_TIME - index * 1_000),
  );
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: workspaces.map((workspace, index) => ({
      id: `session-${index}`,
      workspaceId: workspace.id,
      name: TEST_SESSION_NAME,
      status: TEST_CONDUCTOR_STATUS.WORKING,
      statusUpdatedAt: TEST_TIME - 1_000,
    })),
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-0", "session-1", "session-2", "session-3", "session-4", "session-5"],
  );
});

test("keeps an old open workspace that newer pages would have crowded out", async () => {
  // The listing pages newest-first, so an open workspace can be older than a
  // whole page of newer work. Following the listing while it says more
  // remain is what keeps that workspace's chat a row; stopping at the first
  // page silently retired a conversation to spare a request.
  const workspaces = [
    ...Array.from({ length: 100 }, (_value, index) =>
      ownedWorkspace(`workspace-new-${index}`, TEST_TIME - index * 1_000),
    ),
    ownedWorkspace("workspace-old", TEST_TIME - 500_000),
  ];
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: [
      {
        id: "session-old",
        workspaceId: "workspace-old",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-old"],
  );
  // The second page was asked for where the first said more remained, and
  // every page carried the documented filters: the user the same pass's
  // identity read reported, and no archived work.
  const listings = api.requests.filter(
    (request) => request.method === "GET" && request.pathname === "/v0/workspaces",
  );
  assert.equal(listings.length, 2);
  assert.equal(listings[0]?.searchParams.get("creator"), TEST_USER_ID);
  assert.equal(listings[0]?.searchParams.get("includeArchived"), "false");
  assert.equal(listings[1]?.searchParams.get("offset"), "100");
});

test("lets a crowded workspace keep every chat beside its quiet neighbour", async () => {
  const workspaces = [
    ownedWorkspace("workspace-crowded", TEST_TIME - 1_000),
    ownedWorkspace("workspace-quiet", TEST_TIME - 2_000),
  ];
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: [
      ...Array.from({ length: 8 }, (_value, index) => ({
        id: `crowded-${index}`,
        workspaceId: "workspace-crowded",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      })),
      {
        id: "quiet-session",
        workspaceId: "workspace-quiet",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const observedIds = observations.map((observation) => observation.providerSessionId);

  // A crowded workspace costs no one anything: all of its chats are rows, and
  // its quiet neighbour's chat is one too.
  assert.equal(observedIds.filter((id) => id.startsWith("crowded-")).length, 8);
  assert.equal(observedIds.includes("quiet-session"), true);
  assert.equal(observations.length, 9);
});

test("keeps only the open chats of a workspace that also holds filed-away ones", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-mixed", TEST_TIME - 1_000)],
    sessions: [
      ...Array.from({ length: 4 }, (_value, index) => ({
        id: `closed-${index}`,
        workspaceId: "workspace-mixed",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 10_000),
      })),
      {
        id: "open-session",
        workspaceId: "workspace-mixed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  // The filed-away chats earn no rows; the one still open is the workspace's
  // only voice, and it reports its own state.
  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["open-session"],
  );
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("clears observations when Conductor rejects the API key", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-active",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });
  let rejectRequests = false;
  const gatedFetch: CloudFetch = async (url, init) =>
    rejectRequests ? jsonResponse({}, HTTP_STATUS.UNAUTHORIZED) : api.fetch(url, init);
  const plugin = pluginFor(gatedFetch);

  const authorized = await plugin.observe();
  rejectRequests = true;
  const rejected = await plugin.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
});

test("keeps observing when one session's status cannot be read", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-unreadable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
      {
        id: "session-readable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // One chat's unreadable status costs nobody a row: the readable sibling
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // reports what it knows, and the unreadable one stands as unknown rather
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // than being dropped as though it were not there.
  assert.equal(observations.length, 2);
  assert.equal(byId.get("session-readable")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("session-unreadable")?.status, SESSION_STATUS.UNKNOWN);
});

test("advertises a message for any open chat, a stop mid-turn, and an archive once settled", async () => {
  // One workspace per chat, so each state under test reads on its own row
  // without any sibling beside it.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-working", TEST_TIME - 31_000),
      ownedWorkspace("workspace-failed", TEST_TIME - 32_000),
    ],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
      {
        id: "session-working",
        workspaceId: "workspace-working",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 6_000,
      },
      {
        id: "session-failed",
        workspaceId: "workspace-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 7_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  const takesMessage = (sessionId: string): boolean =>
    advertisedActionFor(byId.get(sessionId) ?? {}, ACTION_KIND.MESSAGE) !== undefined;
  assert.equal(takesMessage("session-idle"), true);
  assert.equal(takesMessage("session-working"), true);
  // A failed chat is documented for no writer.
  assert.equal(takesMessage("session-failed"), false);
  // A chat mid-turn offers its stop and nothing else; every chat of a settled,
  // still-open workspace — idle or failed — offers to file that workspace
  // away, each naming its own workspace as the target.
  assert.deepEqual(advertisedControls(byId.get("session-working") ?? {}), [
    { kind: ACTION_KIND.CONTROL, id: "cancel-turn", label: "Stop this turn", controlKind: "stop" },
  ]);
  for (const [sessionId, workspaceId] of [
    ["session-idle", "workspace-idle"],
    ["session-failed", "workspace-failed"],
  ] as const) {
    assert.deepEqual(advertisedControls(byId.get(sessionId) ?? {}), [
      {
        kind: ACTION_KIND.CONTROL,
        id: "archive-workspace",
        label: "Archive",
        controlKind: "archive",
        target: workspaceId,
      },
    ]);
  }
});

test("keeps the archive off every chat of a workspace while a sibling works", async () => {
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
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 6_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // The idle chat's own turn is settled, but the workspace an archive acts on
  // is not: filing it away would take the sibling's running turn with it, so
  // no row of this workspace offers the archive.
  assert.deepEqual(advertisedControls(byId.get("session-working") ?? {}), [
    { kind: ACTION_KIND.CONTROL, id: "cancel-turn", label: "Stop this turn", controlKind: "stop" },
  ]);
  assert.deepEqual(advertisedControls(byId.get("session-idle") ?? {}), []);
});

test("keeps the archive off a workspace whose chat's state could not be read", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-unreadable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  // An unread status is not a settled one: the chat stands as unknown rather
  // than being dropped, and a workspace not positively seen settled offers no
  // filing away — the turn Luke could not read may still be running.
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.deepEqual(advertisedControls(observations[0] ?? {}), []);
});

test("leaves a filed-away workspace and its chats off the roster entirely", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      // Filing a workspace away is how a user says its chats are done being
      // watched, so nothing of it survives to the roster — this is also what
      // makes a press of the archive control actually clear the rows it
      // acted on, come the next pass. The listing marks it, and a page can
      // hold hundreds of these, so it must cost nothing further: judged by a
      // per-workspace read instead, one failed read on one long-archived
      // workspace resurrected rows the user had already filed away.
      {
        ...ownedWorkspace("workspace-filed", TEST_TIME - 30_000),
        state: "archived",
        // Misbehave behind the mark: the pass must never ask.
        lifecycleHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
      {
        ...ownedWorkspace("workspace-erased", TEST_TIME - 40_000),
        state: "deleted",
      },
      ownedWorkspace("workspace-open", TEST_TIME - 5_000),
    ],
    sessions: [
      {
        id: "session-closed",
        workspaceId: "workspace-filed",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 20_000),
      },
      {
        id: "session-open",
        workspaceId: "workspace-open",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // Dropped before its lifecycle or sessions are ever asked for: the
  // filed-away workspaces cost no requests, not just no rows.
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-filed")),
    false,
  );
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-erased")),
    false,
  );
});

test("leaves a workspace whose lifecycle stands archived off the roster", async () => {
  // A filing-away the listing has not caught up with still shows at the
  // lifecycle endpoint, and a listing state this build does not know says
  // nothing either way — in both cases the lifecycle read decides, so
  // every chat of a workspace actually archived is dropped rather than
  // standing gray forever.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-archived", TEST_TIME - 30_000), lifecycleStatus: "archived" },
      {
        ...ownedWorkspace("workspace-deleted", TEST_TIME - 40_000),
        state: "some-future-state",
        lifecycleStatus: "deleted",
      },
      ownedWorkspace("workspace-open", TEST_TIME - 5_000),
    ],
    sessions: [
      { id: "session-filed", workspaceId: "workspace-archived", name: TEST_SESSION_NAME },
      { id: "session-gone", workspaceId: "workspace-deleted", name: TEST_SESSION_NAME },
      {
        id: "session-open",
        workspaceId: "workspace-open",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await pluginFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // Dropped before its chats are ever asked for: the retired workspaces cost
  // one lifecycle read each and nothing more.
  assert.equal(
    api.requests.some((request) => request.pathname.endsWith("workspace-archived/sessions")),
    false,
  );
  assert.equal(
    api.requests.some((request) => request.pathname.includes("session-filed")),
    false,
  );
});
