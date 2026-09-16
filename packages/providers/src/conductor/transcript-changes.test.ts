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
  type TestSession,
  WORKING_SESSION_UUID,
} from "../testing/conductor-api.js";

const WORKSPACE_ID = "workspace-changes";
const MARK = TEST_TIME - 60_000;

/** A chat whose status endpoint reports the given instant as its `updatedAt`. */
function chat(id: string, statusUpdatedAt: number): TestSession {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt,
  };
}

function changesApi(sessions: readonly TestSession[]) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace(WORKSPACE_ID, TEST_TIME - 30_000)],
    sessions,
  });
}

/** Three chats: two moved since the mark, one before it. */
const THREE_CHATS = [
  chat(IDLE_SESSION_UUID, MARK + 20_000),
  chat(SECOND_IDLE_SESSION_UUID, MARK + 10_000),
  chat(WORKING_SESSION_UUID, MARK - 10_000),
];
const THREE_IDS = THREE_CHATS.map((session) => session.id);

test("the changes read answers the chats whose status instant passed the mark, oldest first, and sends nothing", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());
  const before = api.requests.length;

  const read = await runTest(
    dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS, since: MARK }),
  );

  assert.equal(api.requests.length, before);
  assert.deepEqual(read, {
    status: "accepted",
    changes: [
      { providerSessionId: SECOND_IDLE_SESSION_UUID, updatedAt: MARK + 10_000 },
      { providerSessionId: IDLE_SESSION_UUID, updatedAt: MARK + 20_000 },
    ],
  });
});

test("a first look answers every chat's instant", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());

  const read = await runTest(dispatchTranscriptChanges(plugin, { providerSessionIds: THREE_IDS }));

  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  assert.deepEqual(
    read.changes.map((change) => change.providerSessionId),
    [WORKING_SESSION_UUID, SECOND_IDLE_SESSION_UUID, IDLE_SESSION_UUID],
  );
});

test("a chat whose instant equals the mark is not a change past it", async () => {
  const api = changesApi([chat(IDLE_SESSION_UUID, MARK), chat(SECOND_IDLE_SESSION_UUID, MARK + 1)]);
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
    changes: [{ providerSessionId: SECOND_IDLE_SESSION_UUID, updatedAt: MARK + 1 }],
  });
});

test("an id that is not a UUID or not one the roster reported is ignored, and no known ids means no changes", async () => {
  const api = changesApi(THREE_CHATS);
  const plugin = pluginFor(api.layer);
  await runTest(plugin.observe());

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
  assert.deepEqual(read, {
    status: "accepted",
    changes: [{ providerSessionId: IDLE_SESSION_UUID, updatedAt: MARK + 20_000 }],
  });

  const nothing = await runTest(
    dispatchTranscriptChanges(plugin, {
      providerSessionIds: ["99999999-9999-4999-8999-999999999999"],
      since: MARK,
    }),
  );
  assert.deepEqual(nothing, { status: "accepted", changes: [] });
});
