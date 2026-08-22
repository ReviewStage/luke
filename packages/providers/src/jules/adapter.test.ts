import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import type { JsonObject } from "@sidecar/wire/testing";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import type { CloudFetch } from "../shared/cloud-session-adapter.js";
import { describeCloudAdapterContract } from "../testing/cloud-adapter-contract.js";
import { JULES_PROVIDER, JulesSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const TEST_BASE_URL = "https://jules.test";
const TEST_API_KEY = "jules-test-key";
const TEST_SOURCE = "sources/github/reviewstage/luke";
const SECRET_PROMPT_TEXT = "SECRET_PROMPT_TEXT";
const GOOGLE_API_KEY_HEADER = "x-goog-api-key";

/** The documented `State` enum, verified against a live account. */
const TEST_STATE = {
  STATE_UNSPECIFIED: "STATE_UNSPECIFIED",
  QUEUED: "QUEUED",
  PLANNING: "PLANNING",
  AWAITING_PLAN_APPROVAL: "AWAITING_PLAN_APPROVAL",
  AWAITING_USER_FEEDBACK: "AWAITING_USER_FEEDBACK",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
} as const;

interface TestSession {
  id: string;
  state?: string;
  source?: string;
  omitSourceContext?: boolean;
  startingBranch?: string;
  createTime: number;
  updateTime?: number;
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function lastActivityAt(session: TestSession): number {
  return session.updateTime ?? session.createTime;
}

type JulesSessionApiPayload = {
  name: string;
  id: string;
  prompt: string;
  title: string;
  sourceContext?: {
    source: string;
    environmentVariablesEnabled: boolean;
    githubRepoContext: {
      startingBranch: string;
    };
  };
  state: string;
  url: string;
  createTime: string;
  updateTime: string;
  nextPageToken?: string;
};

function sessionPayload(session: TestSession) {
  const payload: JulesSessionApiPayload = {
    name: `sessions/${session.id}`,
    id: session.id,
    // Jules returns the task the user typed and a title generated from it, so
    // both are transcript content that no observation may carry.
    prompt: `${SECRET_PROMPT_TEXT} please`,
    title: `${SECRET_PROMPT_TEXT} title`,
    state: session.state ?? TEST_STATE.IN_PROGRESS,
    url: `https://jules.google.com/task/${session.id}`,
    createTime: isoTimestamp(session.createTime),
    updateTime: isoTimestamp(lastActivityAt(session)),
  };
  if (!session.omitSourceContext) {
    payload.sourceContext = {
      source: session.source ?? TEST_SOURCE,
      environmentVariablesEnabled: false,
      githubRepoContext: {
        startingBranch: session.startingBranch ?? "main",
      },
    };
  }
  return payload;
}

/** Serves the subset of the alpha API the adapter is allowed to use. */
function fakeJulesApi(sessions: readonly TestSession[]) {
  return recordingFetch((request) => {
    const { pathname, searchParams, method } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    // The two documented writers are Google custom methods on one session:
    // `POST /v1alpha/sessions/{id}:sendMessage` and `…:approvePlan`.
    if (method === "POST" && segments[0] === "v1alpha" && segments.length === 3) {
      const [id, action] = (segments[2] ?? "").split(":");
      const known = sessions.some((session) => session.id === id);
      if (!known || (action !== "sendMessage" && action !== "approvePlan")) {
        return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      }
      return jsonResponse({});
    }
    if (segments.length !== 2 || segments[0] !== "v1alpha" || segments[1] !== "sessions") {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // Jules documents no ordering, so the fake deliberately answers in the
    // order it was given rather than newest-first.
    const pageSize = Number(searchParams.get("pageSize") ?? "30");
    const page = sessions.slice(0, pageSize);
    const response: JsonObject = {
      sessions: page.map(sessionPayload),
    };
    if (page.length < sessions.length) {
      response.nextPageToken = "next-page";
    }
    return jsonResponse(response);
  });
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
  } = {},
): JulesSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new JulesSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

function workingSession(id: string, updateTime: number): TestSession {
  return { id, state: TEST_STATE.IN_PROGRESS, createTime: updateTime, updateTime };
}

describeCloudAdapterContract("Jules", (options) => {
  const api = fakeJulesApi([workingSession("contract-session", TEST_TIME - 1_000)]);
  const fetch: CloudFetch = async (url, init) => {
    if (options.failRequests()) throw new Error("network unreachable");
    return api.fetch(url, init);
  };
  return {
    adapter: adapterFor(fetch, options),
    requestCount: () => api.requests.length,
    credentials: () =>
      api.requests
        .map((request) => request.headers.get(GOOGLE_API_KEY_HEADER) ?? undefined)
        .filter((credential): credential is string => credential !== undefined),
  };
});

test("declares every provider operation on one adapter interface", () => {
  const adapter = adapterFor(async () => new Response("{}", { status: 200 }));
  assert.ok(adapter.sendMessage instanceof Function);
  assert.ok(adapter.executeControl instanceof Function);
  assert.ok(adapter.createWorkspace instanceof Function);
  assert.ok(adapter.spawnWorkspaceAgent instanceof Function);
});

test("observes a session in progress without exposing prompt-derived text", async () => {
  const api = fakeJulesApi([
    {
      id: "session-in-progress",
      state: TEST_STATE.IN_PROGRESS,
      startingBranch: "main",
      createTime: TEST_TIME - 60_000,
      updateTime: TEST_TIME - 30_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(JULES_PROVIDER, { id: "jules", displayName: "Jules" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-in-progress");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  // The row is worded by the surface from these fields, never by the adapter.
  assert.equal(observations[0]?.recap, undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: "main",
    link: "https://jules.google.com/task/session-in-progress",
  });
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("reads the whole pass with one list call authenticated by Google's key header", async () => {
  const api = fakeJulesApi([
    workingSession("session-one", TEST_TIME - 1_000),
    workingSession("session-two", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1alpha/sessions"],
  );
  assert.equal(api.requests[0]?.search, "?pageSize=100");
  assert.equal(api.requests[0]?.method, "GET");
  // Jules rejects a bearer token, so the key must travel in its own header and
  // nowhere else.
  assert.equal(api.requests[0]?.headers.get(GOOGLE_API_KEY_HEADER), TEST_API_KEY);
  assert.equal(api.requests[0]?.authorization, undefined);
});

test("maps every state Jules reports onto a state Luke can show", async () => {
  const api = fakeJulesApi(
    (
      [
        [TEST_STATE.QUEUED, "queued"],
        [TEST_STATE.PLANNING, "planning"],
        [TEST_STATE.IN_PROGRESS, "in-progress"],
        [TEST_STATE.AWAITING_PLAN_APPROVAL, "awaiting-plan"],
        [TEST_STATE.AWAITING_USER_FEEDBACK, "awaiting-feedback"],
        [TEST_STATE.PAUSED, "paused"],
        [TEST_STATE.COMPLETED, "completed"],
        [TEST_STATE.FAILED, "failed"],
        [TEST_STATE.STATE_UNSPECIFIED, "unspecified"],
        ["SOME_LATER_STATE", "later-state"],
      ] as const
    ).map(([state, name], index) => ({
      id: `session-${name}`,
      state,
      createTime: TEST_TIME - (index + 1) * 1_000,
      updateTime: TEST_TIME - (index + 1) * 1_000,
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["session-queued", SESSION_STATUS.WORKING],
      ["session-planning", SESSION_STATUS.WORKING],
      ["session-in-progress", SESSION_STATUS.WORKING],
      ["session-awaiting-plan", SESSION_STATUS.WAITING],
      ["session-awaiting-feedback", SESSION_STATUS.WAITING],
      ["session-paused", SESSION_STATUS.WAITING],
      ["session-completed", SESSION_STATUS.COMPLETE],
      ["session-failed", SESSION_STATUS.ERROR],
      ["session-unspecified", SESSION_STATUS.UNKNOWN],
      ["session-later-state", SESSION_STATUS.UNKNOWN],
    ],
  );
  assert.deepEqual(
    observations
      .filter((observation) => observation.holdingForDeveloper === true)
      .map((observation) => observation.providerSessionId),
    ["session-awaiting-plan", "session-awaiting-feedback", "session-paused"],
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("keeps reporting a long turn as working", async () => {
  // `updateTime` marks when the session entered its state rather than a
  // heartbeat, so a turn that started an hour ago and is still going must not
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // read as stale.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeJulesApi([workingSession("session-long-turn", startedAt)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("a session awaiting feedback keeps asking however long it has stood", async () => {
  // Jules asserting the session awaits feedback is a live fact about this
  // moment, not a turn boundary to be guessed stale, so the ask never melts
  // into an idle row.
  const askedAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const api = fakeJulesApi([
    {
      id: "session-standing-ask",
      state: TEST_STATE.AWAITING_USER_FEEDBACK,
      createTime: askedAt,
      updateTime: askedAt,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
});

test("keeps a completed session complete however long ago it finished", async () => {
  const finishedAt = TEST_TIME - 8 * 60 * 60 * 1000;
  const api = fakeJulesApi([
    {
      id: "session-finished",
      state: TEST_STATE.COMPLETED,
      createTime: finishedAt,
      updateTime: finishedAt,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
});

test("keeps a session untouched since the day before yesterday", async () => {
  const api = fakeJulesApi([workingSession("session-last-week", TEST_TIME - 48 * 60 * 60 * 1000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-last-week"],
  );
});

test("orders the pass itself rather than trusting the order Jules answers in", async () => {
  // Jules documents no ordering for `sessions.list`, so the pass sorts the
  // page newest-first however it happens to arrive.
  const api = fakeJulesApi([
    workingSession("session-oldest", TEST_TIME - 3_000),
    workingSession("session-newest", TEST_TIME - 1_000),
    workingSession("session-middle", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-newest", "session-middle", "session-oldest"],
  );
});

test("labels a session by its repository, and by neither its title nor nothing", async () => {
  const api = fakeJulesApi([
    {
      id: "session-repository",
      source: "sources/github/reviewstage/sidecar",
      createTime: TEST_TIME - 1_000,
    },
    { id: "session-sourceless", omitSourceContext: true, createTime: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.title, "sidecar");
  assert.equal(observations[0]?.detail?.repository, "sidecar");
  assert.equal(observations[1]?.title, "workspace");
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("reports why a failed session stopped rather than leaving it idle", async () => {
  const api = fakeJulesApi([
    {
      id: "session-failed",
      state: TEST_STATE.FAILED,
      createTime: TEST_TIME - 1_000,
      updateTime: TEST_TIME - 1_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "The session failed");
});

test("drops a session it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async () =>
    jsonResponse({
      sessions: [
        { name: "sessions/anonymous", state: TEST_STATE.IN_PROGRESS },
        { id: "session-undated", state: TEST_STATE.IN_PROGRESS },
        sessionPayload({ id: "session-complete", createTime: TEST_TIME - 1_000 }),
      ],
    });

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-complete"],
  );
});

test("clears observations when Jules rejects the API key", async () => {
  const api = fakeJulesApi([workingSession("session-in-progress", TEST_TIME - 1_000)]);
  let rejectRequests = false;
  const gatedFetch: CloudFetch = async (url, init) =>
    rejectRequests ? jsonResponse({}, HTTP_STATUS.UNAUTHORIZED) : api.fetch(url, init);
  const adapter = adapterFor(gatedFetch);

  const authorized = await adapter.observe();
  rejectRequests = true;
  const rejected = await adapter.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("advertises a message only for the states Jules documents as active", async () => {
  const api = fakeJulesApi([
    { id: "session-planning", state: TEST_STATE.PLANNING, createTime: TEST_TIME - 1_000 },
    { id: "session-working", state: TEST_STATE.IN_PROGRESS, createTime: TEST_TIME - 2_000 },
    { id: "session-plan", state: TEST_STATE.AWAITING_PLAN_APPROVAL, createTime: TEST_TIME - 3_000 },
    { id: "session-ask", state: TEST_STATE.AWAITING_USER_FEEDBACK, createTime: TEST_TIME - 4_000 },
    { id: "session-queued", state: TEST_STATE.QUEUED, createTime: TEST_TIME - 5_000 },
    { id: "session-paused", state: TEST_STATE.PAUSED, createTime: TEST_TIME - 6_000 },
    { id: "session-done", state: TEST_STATE.COMPLETED, createTime: TEST_TIME - 7_000 },
    { id: "session-failed", state: TEST_STATE.FAILED, createTime: TEST_TIME - 8_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const messageable = new Map(
    observations.map((entry) => [entry.providerSessionId, entry.canReceiveMessage]),
  );

  assert.equal(messageable.get("session-planning"), true);
  assert.equal(messageable.get("session-working"), true);
  assert.equal(messageable.get("session-plan"), true);
  assert.equal(messageable.get("session-ask"), true);
  // Whether a queued, paused, or settled session takes a message is documented
  // nowhere, so none of them is promised one.
  assert.equal(messageable.get("session-queued"), false);
  assert.equal(messageable.get("session-paused"), false);
  assert.equal(messageable.get("session-done"), false);
  assert.equal(messageable.get("session-failed"), false);
});

test("hands a user message to Jules through its documented custom method", async () => {
  const api = fakeJulesApi([
    { id: "session-ask", state: TEST_STATE.AWAITING_USER_FEEDBACK, createTime: TEST_TIME - 1_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "session-ask",
    text: "Use the existing fixture instead",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  // The colon is part of the route: `%3AsendMessage` would name nothing.
  assert.equal(write?.pathname, "/v1alpha/sessions/session-ask:sendMessage");
  assert.equal(write?.headers.get(GOOGLE_API_KEY_HEADER), TEST_API_KEY);
  assert.deepEqual(JSON.parse(write?.body ?? ""), { prompt: "Use the existing fixture instead" });
});

test("offers approving the plan only while Jules is holding one, and sends no body", async () => {
  const api = fakeJulesApi([
    { id: "session-plan", state: TEST_STATE.AWAITING_PLAN_APPROVAL, createTime: TEST_TIME - 1_000 },
    { id: "session-working", state: TEST_STATE.IN_PROGRESS, createTime: TEST_TIME - 2_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  const observations = await adapter.observe();
  const approveControl = { id: "approve-plan", label: "Approve the plan" };

  const holding = observations.find((entry) => entry.providerSessionId === "session-plan");
  const working = observations.find((entry) => entry.providerSessionId === "session-working");
  assert.deepEqual(holding?.controls, [approveControl]);
  assert.equal(working?.controls, undefined);

  const approved = await adapter.executeControl({
    providerSessionId: "session-plan",
    control: approveControl,
  });
  const refused = await adapter.executeControl({
    providerSessionId: "session-working",
    control: approveControl,
  });

  assert.deepEqual(approved, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.pathname, "/v1alpha/sessions/session-plan:approvePlan");
  // Jules documents an empty request for an approval.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
  assert.deepEqual(refused, { status: "unsupported" });
});
