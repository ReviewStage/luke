import assert from "node:assert/strict";
import { dispatchTranscriptChanges } from "@sidecar/session";
import { runTest } from "@sidecar/wire/testing";
import { test } from "vitest";
import {
  fakeConductorApi,
  IDLE_SESSION_UUID,
  LUKE_PROJECT,
  ownedWorkspace,
  pluginFor,
  SECOND_IDLE_SESSION_UUID,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
  type TestApi,
  type TestSession,
  WORKING_SESSION_UUID,
} from "../testing/conductor-api.js";

const WORKSPACE_ID = "workspace-changes";
const SQL_ROUTE = "/v0/sql";
const MARK = TEST_TIME - 60_000;

function chat(id: string, overrides: Partial<TestSession> = {}): TestSession {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: TEST_TIME - 5_000,
    ...overrides,
  };
}

/** Three chats: two changed since the mark, one before it. */
function changesApi(sessions: readonly TestSession[], api: Partial<TestApi> = {}) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace(WORKSPACE_ID, TEST_TIME - 30_000)],
    sessions,
    ...api,
  });
}

const THREE_CHATS = [
  chat(IDLE_SESSION_UUID, { transcriptUpdatedAt: MARK + 20_000 }),
  chat(SECOND_IDLE_SESSION_UUID, { transcriptUpdatedAt: MARK + 10_000 }),
  chat(WORKING_SESSION_UUID, { transcriptUpdatedAt: MARK - 10_000 }),
];
const THREE_IDS = THREE_CHATS.map((session) => session.id);

/** The document as sent, read back from the recorded request's body. */
function sentDocuments(api: ReturnType<typeof fakeConductorApi>, from: number): string[] {
  return api.requests
    .slice(from)
    .filter((request) => request.pathname === SQL_ROUTE)
    .map((request) => {
      // SAFETY: The fake's own SQL branch parsed this body the same way.
      const body = JSON.parse(request.body ?? "{}") as { query?: string };
      return body.query ?? "";
    });
}

test("the changes read sends one fixed document naming the roster's ids and the mark, and answers the chats past it oldest first", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());
  const before = api.requests.length;

  const read = await runTest(
    dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS, since: MARK }),
  );

  assert.deepEqual(sentDocuments(api, before), [
    `SELECT session_id, transcript_updated_at FROM session_transcripts_view WHERE session_id IN ('${IDLE_SESSION_UUID}', '${SECOND_IDLE_SESSION_UUID}', '${WORKING_SESSION_UUID}') AND transcript_updated_at > '${new Date(MARK).toISOString()}' ORDER BY transcript_updated_at ASC`,
  ]);
  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  assert.deepEqual(read.changes, [
    { providerSessionId: SECOND_IDLE_SESSION_UUID, updatedAt: MARK + 10_000 },
    { providerSessionId: IDLE_SESSION_UUID, updatedAt: MARK + 20_000 },
  ]);
});

test("a first look sends no instant predicate and answers every chat's newest instant", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());
  const before = api.requests.length;

  const read = await runTest(dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS }));

  assert.deepEqual(sentDocuments(api, before), [
    `SELECT session_id, transcript_updated_at FROM session_transcripts_view WHERE session_id IN ('${IDLE_SESSION_UUID}', '${SECOND_IDLE_SESSION_UUID}', '${WORKING_SESSION_UUID}') ORDER BY transcript_updated_at ASC`,
  ]);
  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  assert.deepEqual(
    read.changes.map((change) => change.providerSessionId),
    [WORKING_SESSION_UUID, SECOND_IDLE_SESSION_UUID, IDLE_SESSION_UUID],
  );
});

test("an id that is not a UUID or not one the roster reported never enters the document, and no ids means no request", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());
  const before = api.requests.length;

  const read = await runTest(
    dispatchTranscriptChanges(plugin, {
      providerSessionIds: [
        "'); DROP TABLE sessions; --",
        "99999999-9999-4999-8999-999999999999",
        IDLE_SESSION_UUID,
        IDLE_SESSION_UUID,
      ],
      since: MARK,
    }),
  );
  assert.deepEqual(sentDocuments(api, before), [
    `SELECT session_id, transcript_updated_at FROM session_transcripts_view WHERE session_id IN ('${IDLE_SESSION_UUID}') AND transcript_updated_at > '${new Date(MARK).toISOString()}' ORDER BY transcript_updated_at ASC`,
  ]);
  assert.equal(read.status, "accepted");

  const nothing = await runTest(
    dispatchTranscriptChanges(plugin, {
      providerSessionIds: ["99999999-9999-4999-8999-999999999999"],
      since: MARK,
    }),
  );
  assert.deepEqual(nothing, { status: "accepted", changes: [] });
  assert.equal(api.requests.length - before, 1);
});

test("a mark that is not an instant this build would write is refused before any request", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());
  const before = api.requests.length;

  for (const since of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 8.64e15 + 1]) {
    const read = await runTest(
      dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS, since }),
    );
    assert.equal(read.status, "rejected", String(since));
  }
  assert.equal(api.requests.length, before);
});

test("a row whose instant cannot be parsed is dropped, and the rest still answer", async () => {
  const api = changesApi([
    chat(IDLE_SESSION_UUID, {
      transcriptUpdatedAt: MARK + 20_000,
      transcriptUpdatedAtRaw: "yesterday",
    }),
    chat(SECOND_IDLE_SESSION_UUID, { transcriptUpdatedAt: MARK + 10_000 }),
  ]);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());

  const read = await runTest(
    dispatchTranscriptChanges(plugin, {
      providerSessionIds: [IDLE_SESSION_UUID, SECOND_IDLE_SESSION_UUID],
      since: MARK,
    }),
  );
  assert.deepEqual(read, {
    status: "accepted",
    changes: [{ providerSessionId: SECOND_IDLE_SESSION_UUID, updatedAt: MARK + 10_000 }],
  });
});

test("a refused view read is a rejection that names Conductor and echoes nothing", async () => {
  const api = changesApi(THREE_CHATS, { sqlHttpStatus: 401 });
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());

  const read = await runTest(
    dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS, since: MARK }),
  );
  assert.equal(read.status, "rejected");
  if (read.status !== "rejected") return;
  assert.equal(read.reason, "Conductor rejected the configured API key.");
});
