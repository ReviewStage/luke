import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { BRAIN_TOOL, freshBrainState } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { CONVERSATION_ENTRY_KIND, SESSION_STATUS } from "@sidecar/session";
import { and, eq } from "drizzle-orm";
import {
  fakeConductorApi,
  IDLE_SESSION_UUID,
  isoTimestamp,
  LUKE_PROJECT,
  ownedWorkspace,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
} from "../../../packages/providers/src/testing/conductor-api";
import { CLOUD_AGENT_PROVIDER_ID, MAIN_SESSION_KEY } from "../server/core";
import { briefing, observationCursor, rosterDiff } from "../server/db/schema";
import { BRAIN_HOST } from "../server/hosted/brain-host/bounds";
import {
  type BrainWakeOptions,
  handleBrainWake,
  wakeCandidates,
} from "../server/hosted/brain-host/wake";
import { cloudSessionPluginFor } from "../server/hosted/cloud-adapters";
import { encryptProviderKey } from "../server/hosted/encryption";
import { encodeObservedRoster, type ObservedRoster } from "../server/hosted/observed-roster";
import { encodeRosterDiff, type RosterDiff } from "../server/hosted/roster-diff";
import { BRIEFING_STATE } from "../server/hosted/store";
import { answered, brainRouteHarness, functionCall, message } from "./support/brain-route";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";

/** Synthetic fixtures: no real title, branch, or transcript anywhere. */

const CRON_SECRET = "cron-secret-1";
const CONDUCTOR_KEY = "conductor-test-key";
const WORKSPACE_ID = "workspace-wake";
const MESSAGE_IDS = [
  "bbbbbbbb-0000-4000-8000-000000000001",
  "bbbbbbbb-0000-4000-8000-000000000002",
  "bbbbbbbb-0000-4000-8000-000000000003",
] as const;

const opening = openHostedStoreTestDatabase();
after(async () => {
  await (await opening).close();
});

function storedUserMessage(id: string, text: string, at: number) {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 1,
    type: "userMessage",
    content: { type: "userMessage", message: text },
    receivedAt: isoTimestamp(at),
  };
}

function storedAgentMessage(id: string, text: string, at: number) {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 2,
    type: "agent",
    content: {
      type: "agent",
      rawPayload: { type: "assistant", message: { content: [{ type: "text", text }] } },
    },
    receivedAt: isoTimestamp(at),
  };
}

/** The snapshot the tick left: one working chat, as the pass reports it. */
function snapshot(status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS]): ObservedRoster {
  return {
    version: 1,
    providers: [
      {
        providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
        observations: [
          {
            providerSessionId: IDLE_SESSION_UUID,
            title: TEST_SESSION_NAME,
            status,
            lastActivityAt: TEST_TIME,
            workspace: { providerWorkspaceId: WORKSPACE_ID, name: "wake-workspace" },
            advertises: [{ kind: "message" }],
          },
        ],
        projects: [],
      },
    ],
  };
}

function statusDiff(): RosterDiff {
  const session = {
    providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
    providerSessionId: IDLE_SESSION_UUID,
    title: TEST_SESSION_NAME,
    status: SESSION_STATUS.WORKING,
    workspaceId: WORKSPACE_ID,
    workspaceName: "wake-workspace",
  };
  return {
    appeared: [],
    vanished: [],
    statusChanged: [{ session, from: SESSION_STATUS.WAITING, to: SESSION_STATUS.WORKING }],
    errorChanged: [],
    activityChanged: [],
    workspacesAppeared: [],
    workspacesVanished: [],
  };
}

function wakeRequest(authorization: string | null = `Bearer ${CRON_SECRET}`): Request {
  return new Request(`https://luke.test${HOSTED_SERVICE_PATH.BRAIN_WAKE}`, {
    method: "GET",
    ...(authorization ? { headers: { authorization } } : undefined),
  });
}

test("a wake consumes the pending diff into one observation turn that reads the working chat's new words and announces", async () => {
  const database = await opening;
  const userId = await database.createUser();
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace(WORKSPACE_ID, TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: WORKSPACE_ID,
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
        storedMessages: [
          storedUserMessage(MESSAGE_IDS[0], "Fix the flaky roster test", TEST_TIME - 9_000),
          storedAgentMessage(MESSAGE_IDS[1], "Looking at the test now.", TEST_TIME - 7_000),
        ],
      },
    ],
  });
  const now = TEST_TIME + 60_000;
  await database.store.roster.advance(
    userId,
    { body: encodeObservedRoster(snapshot(SESSION_STATUS.WORKING)), observedAt: now },
    {
      id: "diff-1",
      observedAt: now,
      previousObservedAt: now - 60_000,
      payload: encodeRosterDiff(statusDiff()),
    },
    undefined,
  );
  const harness = brainRouteHarness(database, userId, {
    readVaultKeys: async () => [
      {
        providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
        ciphertext: encryptProviderKey(CONDUCTOR_KEY, TEST_PAYLOAD_SECRET),
      },
    ],
    cloudPlugin: (providerId, seams) =>
      cloudSessionPluginFor(providerId, { ...seams, fetch: api.fetch }),
  });
  harness.model.answers.push(
    answered([
      functionCall("announce-1", BRAIN_TOOL.ANNOUNCE, {
        briefing: "The roster test agent has started working.",
      }),
    ]),
    answered([message("")]),
  );
  const route = harness.route(wakeRequest());
  const options: BrainWakeOptions = {
    ...route,
    cronSecret: CRON_SECRET,
    store: () => database.store,
  };

  const response = await handleBrainWake(options);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    users: 1,
    woke: 1,
    resumed: 0,
    busy: 0,
    failed: 0,
    exhausted: false,
  });
  // The turn opened with the change and the chat's new words, read once through the documented endpoint.
  assert.equal(harness.model.inputs.length, 2);
  const opened = JSON.stringify(harness.model.inputs[0]);
  assert.ok(opened.includes("[observed events]"));
  assert.ok(opened.includes("status: waiting → working"));
  assert.ok(opened.includes("Developer: Fix the flaky roster test"));
  assert.ok(opened.includes("Conductor: Looking at the test now."));
  assert.ok(harness.model.toolsOffered[0]?.includes(BRAIN_TOOL.ANNOUNCE));
  const reads = api.requests.filter((request) => request.pathname.endsWith("/messages"));
  assert.ok(reads.length >= 1);
  assert.ok(reads.every((request) => request.method === "GET"));
  // The cursor the read reached stands in the store, so the next wake reads only what is newer.
  const cursors = await database.db
    .select()
    .from(observationCursor)
    .where(eq(observationCursor.userId, userId));
  assert.equal(cursors.length, 1);
  assert.equal(cursors[0]?.providerSessionId, IDLE_SESSION_UUID);
  assert.equal(cursors[0]?.cursor, MESSAGE_IDS[1]);
  // The briefing is offered and the announcement stands as a line; nothing delivers it yet.
  const briefings = await database.db.select().from(briefing).where(eq(briefing.userId, userId));
  assert.equal(briefings.length, 1);
  assert.equal(briefings[0]?.state, BRIEFING_STATE.OFFERED);
  assert.equal(briefings[0]?.expiresAt, briefings[0]!.decidedAt + 5 * 60_000);
  const lines = await database.store.lines.list(userId, MAIN_SESSION_KEY, Date.now());
  assert.deepEqual(
    lines.map((line) => [line.kind, line.words, line.eventId]),
    [
      [
        CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
        "The roster test agent has started working.",
        briefings[0]?.id,
      ],
    ],
  );
  // The diff is consumed, and a second wake finds nothing to open.
  const [consumed] = await database.db
    .select({ consumedAt: rosterDiff.consumedAt })
    .from(rosterDiff)
    .where(and(eq(rosterDiff.userId, userId), eq(rosterDiff.id, "diff-1")));
  assert.notEqual(consumed?.consumedAt, null);
  const quiet = await handleBrainWake({ ...options, request: wakeRequest() });
  assert.deepEqual(await quiet.json(), {
    users: 0,
    woke: 0,
    resumed: 0,
    busy: 0,
    failed: 0,
    exhausted: false,
  });
  assert.equal(harness.model.inputs.length, 2);

  // A later wake over a newer diff reads only past the cursor.
  api.requests.length = 0;
  await database.store.roster.advance(
    userId,
    { body: encodeObservedRoster(snapshot(SESSION_STATUS.WORKING)), observedAt: now + 60_000 },
    {
      id: "diff-2",
      observedAt: now + 60_000,
      previousObservedAt: now,
      payload: encodeRosterDiff(statusDiff()),
    },
    now,
  );
  harness.model.answers.push(answered([message("")]));
  const second = await handleBrainWake({ ...options, request: wakeRequest() });
  assert.equal((await second.json()).woke, 1);
  const poll = api.requests.find((request) => request.pathname.endsWith("/messages"));
  assert.equal(poll?.searchParams.get("after"), MESSAGE_IDS[1]);
});

test("the wake refuses without its secrets, refuses a wrong bearer, and leaves a conversation another holder runs", async () => {
  const database = await opening;
  const userId = await database.createUser();
  const now = TEST_TIME + 60_000;
  await database.store.roster.advance(
    userId,
    { body: encodeObservedRoster(snapshot(SESSION_STATUS.WORKING)), observedAt: now },
    {
      id: "diff-busy",
      observedAt: now,
      previousObservedAt: now - 60_000,
      payload: encodeRosterDiff(statusDiff()),
    },
    undefined,
  );
  const harness = brainRouteHarness(database, userId);
  const options: BrainWakeOptions = {
    ...harness.route(wakeRequest()),
    cronSecret: CRON_SECRET,
    store: () => database.store,
  };

  assert.equal((await handleBrainWake({ ...options, cronSecret: undefined })).status, 503);
  assert.equal((await handleBrainWake({ ...options, openAiKey: undefined })).status, 503);
  assert.equal(
    (await handleBrainWake({ ...options, request: wakeRequest("Bearer wrong") })).status,
    401,
  );
  assert.equal((await handleBrainWake({ ...options, request: wakeRequest(null) })).status, 401);
  assert.equal(
    (
      await handleBrainWake({
        ...options,
        request: new Request("https://luke.test/api/brain/wake", { method: "POST" }),
      })
    ).status,
    405,
  );

  assert.ok(
    await database.store.leases.acquire(
      userId,
      MAIN_SESSION_KEY,
      "live-function",
      Date.now(),
      30_000,
    ),
  );
  const busy = await handleBrainWake({ ...options, request: wakeRequest() });
  assert.deepEqual(await busy.json(), {
    users: 1,
    woke: 0,
    resumed: 0,
    busy: 1,
    failed: 0,
    exhausted: false,
  });
  assert.equal(harness.model.inputs.length, 0);
  assert.equal((await database.store.roster.pendingDiffs(userId)).length, 1);
});

test("the wake and the ask routes get the function duration the run deadline needs, and the cron names the wake", () => {
  // SAFETY: the file is this repository's own vercel.json; the fields read are the ones asserted.
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    functions: Record<string, { maxDuration: number }>;
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(
    vercel.crons.filter((cron) => cron.path === HOSTED_SERVICE_PATH.BRAIN_WAKE),
    [{ path: HOSTED_SERVICE_PATH.BRAIN_WAKE, schedule: "* * * * *" }],
  );
  for (const route of [
    "api/brain/ask.ts",
    "api/brain/ask/[runId].ts",
    "api/brain/ask/[runId]/cancel.ts",
    "api/brain/wake.ts",
  ]) {
    assert.equal(vercel.functions[route]?.maxDuration, BRAIN_HOST.MAX_DURATION_SECONDS);
  }
  assert.ok(
    BRAIN_HOST.RUN_DEADLINE_MS + BRAIN_HOST.WAKE_BUDGET_MS < BRAIN_HOST.MAX_DURATION_SECONDS * 1000,
  );
});

test("a wake lists the conversations with unfinished runs before the accounts with pending diffs", async () => {
  const database = await opening;
  const now = TEST_TIME + 60_000;
  const diffOnly = await database.createUser();
  const runOnly = await database.createUser();
  const both = await database.createUser();
  const pendingDiff = async (userId: string, at: number) => {
    await database.store.roster.advance(
      userId,
      { body: encodeObservedRoster(snapshot(SESSION_STATUS.WORKING)), observedAt: at },
      {
        id: `diff-${userId}`,
        observedAt: at,
        previousObservedAt: at - 60_000,
        payload: encodeRosterDiff(statusDiff()),
      },
      undefined,
    );
  };
  const unfinishedRun = async (userId: string, at: number) => {
    await database.store.conversations.create(userId, {
      sessionKey: MAIN_SESSION_KEY,
      name: "main",
      now: at,
    });
    await database.store.brainStateRepository(userId, MAIN_SESSION_KEY).save({
      ...freshBrainState(`gen-${userId}`, at),
      requests: [
        {
          runId: `run-${userId}`,
          submissionId: `submission-${userId}`,
          origin: BRAIN_REQUEST_ORIGIN.TYPED,
          question: "left running",
          status: BRAIN_REQUEST_STATUS.RUNNING,
          revision: 1,
          acceptedAt: at,
          startedAt: at,
          performedActions: 0,
          unknownActions: 0,
        },
      ],
    });
  };
  await pendingDiff(diffOnly, now - 5_000);
  await pendingDiff(both, now - 4_000);
  await unfinishedRun(both, now - 2_000);
  await unfinishedRun(runOnly, now - 1_000);

  const candidates = await wakeCandidates(database.store);

  const ours = candidates.filter((userId) => [diffOnly, runOnly, both].includes(userId));
  assert.deepEqual(ours, [both, runOnly, diffOnly]);
});
