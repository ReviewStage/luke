import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import type { CloudFetch } from "../shared/cloud-session-adapter.js";
import { describeCloudAdapterContract } from "../testing/cloud-adapter-contract.js";
import { REPLICAS_PROVIDER, ReplicasSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-21T02:45:00.000Z");
const TEST_BASE_URL = "https://replicas.test";
const TEST_API_KEY = "replicas-test-key";
const TEST_REPOSITORY_URL = "https://github.com/reviewstage/luke";
const SECRET_NAME_TEXT = "SECRET_NAME_TEXT";

/** The documented workspace lifecycle, verified against the published OpenAPI. */
const TEST_STATUS = {
  PREPARING: "preparing",
  ACTIVE: "active",
  SLEEPING: "sleeping",
  ARCHIVED: "archived",
  ERROR: "error",
} as const;

interface TestWorkspace {
  id: string;
  status?: string;
  repositoryUrl?: string;
  repositoryName?: string;
  omitRepositories?: boolean;
  pullRequestUrls?: readonly string[];
  createdAt: number;
  lastActivityAt?: number;
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function workspacePayload(workspace: TestWorkspace) {
  return {
    id: workspace.id,
    // Replicas derives a workspace's name from the opening task whenever the
    // user did not type one, so it is transcript content that no observation
    // may carry.
    name: `${SECRET_NAME_TEXT}-branch-name`,
    status: workspace.status ?? TEST_STATUS.ACTIVE,
    source: "dashboard",
    created_at: isoTimestamp(workspace.createdAt),
    last_activity_at:
      workspace.lastActivityAt === undefined ? null : isoTimestamp(workspace.lastActivityAt),
    repositories: workspace.omitRepositories
      ? []
      : [
          {
            id: "repository-id",
            name: workspace.repositoryName ?? "reviewstage/luke",
            url: workspace.repositoryUrl ?? TEST_REPOSITORY_URL,
          },
        ],
    pull_requests: (workspace.pullRequestUrls ?? []).map((url, index) => ({
      repository: workspace.repositoryName ?? "reviewstage/luke",
      number: index + 1,
      url,
    })),
  };
}

/**
 * Serves the subset of the Replica API the adapter is allowed to use: the
 * organization's replica list, and the documented message endpoint. The
 * per-workspace reads are deliberately not served — they wake a sleeping
 * workspace, so a request to one is a failure of the pass, not a route this
 * fake forgot — and neither is the dashboard's viewer-scoped workspace list.
 */
function fakeReplicasApi(workspaces: readonly TestWorkspace[]) {
  return recordingFetch((request) => {
    const { pathname, searchParams, method } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "v1" &&
      segments[1] === "replica" &&
      segments[3] === "messages"
    ) {
      const known = workspaces.some((workspace) => workspace.id === segments[2]);
      return known ? jsonResponse({ status: "sent" }) : jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }
    if (
      method !== "GET" ||
      segments.length !== 2 ||
      segments[0] !== "v1" ||
      segments[1] !== "replica"
    ) {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // The documented list answers newest `created_at` first; the fake answers
    // in the order it was given so the adapter's own sort is what is tested.
    const limit = Number(searchParams.get("limit") ?? "10");
    const page = workspaces.slice(0, limit);
    return jsonResponse({
      replicas: page.map(workspacePayload),
      total: workspaces.length,
      page: 1,
      limit,
      total_pages: 1,
    });
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
): ReplicasSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ReplicasSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

function activeWorkspace(id: string, lastActivityAt: number): TestWorkspace {
  return {
    id,
    status: TEST_STATUS.ACTIVE,
    createdAt: lastActivityAt - 60_000,
    lastActivityAt,
  };
}

describeCloudAdapterContract("Replicas", (options) => {
  const api = fakeReplicasApi([activeWorkspace("contract-workspace", TEST_TIME - 1_000)]);
  const fetch: CloudFetch = async (url, init) => {
    if (options.failRequests()) throw new Error("network unreachable");
    return api.fetch(url, init);
  };
  return {
    adapter: adapterFor(fetch, options),
    requestCount: () => api.requests.length,
    credentials: () =>
      api.requests
        .map((request) => request.authorization?.replace("Bearer ", ""))
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

test("observes an active workspace without exposing its task-derived name", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-active",
      status: TEST_STATUS.ACTIVE,
      createdAt: TEST_TIME - 60_000,
      lastActivityAt: TEST_TIME - 30_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(REPLICAS_PROVIDER, { id: "replicas", displayName: "Replicas" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "workspace-active");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  // The row is worded by the surface from these fields, never by the adapter.
  assert.equal(observations[0]?.recap, undefined);
  // The list projection reports no address of the workspace's own, so the row
  // honestly offers nowhere to open rather than a composed dashboard URL.
  assert.deepEqual(observations[0]?.detail, { repository: "luke" });
  assert.equal(JSON.stringify(observations).includes(SECRET_NAME_TEXT), false);
});

test("reads the whole pass with one list call and never a per-workspace read", async () => {
  // `GET /v1/replica/{id}` is documented to wake a sleeping workspace, so the
  // pass must be answerable from the list alone: one request, however many
  // workspaces it reports and whatever states they are in.
  const api = fakeReplicasApi([
    activeWorkspace("workspace-one", TEST_TIME - 1_000),
    { id: "workspace-two", status: TEST_STATUS.SLEEPING, createdAt: TEST_TIME - 2_000 },
    { id: "workspace-three", status: TEST_STATUS.ERROR, createdAt: TEST_TIME - 3_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 3);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/replica"],
  );
  assert.equal(api.requests[0]?.search, "?limit=100");
  assert.equal(api.requests[0]?.method, "GET");
  assert.equal(api.requests[0]?.authorization, `Bearer ${TEST_API_KEY}`);
});

test("maps every status Replicas reports onto a state Luke can show", async () => {
  const api = fakeReplicasApi(
    (
      [
        [TEST_STATUS.PREPARING, "preparing"],
        [TEST_STATUS.ACTIVE, "active"],
        [TEST_STATUS.SLEEPING, "sleeping"],
        [TEST_STATUS.ARCHIVED, "archived"],
        [TEST_STATUS.ERROR, "error"],
        ["some-later-status", "later-status"],
      ] as const
    ).map(([status, name], index) => ({
      id: `workspace-${name}`,
      status,
      createdAt: TEST_TIME - (index + 1) * 1_000,
      lastActivityAt: TEST_TIME - (index + 1) * 1_000,
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["workspace-preparing", SESSION_STATUS.WORKING],
      ["workspace-active", SESSION_STATUS.WORKING],
      ["workspace-sleeping", SESSION_STATUS.COMPLETE],
      ["workspace-archived", SESSION_STATUS.COMPLETE],
      ["workspace-error", SESSION_STATUS.ERROR],
      ["workspace-later-status", SESSION_STATUS.UNKNOWN],
    ],
  );
  // The list projection never says a chat is holding for the user, so no row
  // may claim to be.
  assert.equal(
    observations.some((observation) => observation.holdingForDeveloper === true),
    false,
  );
});

test("keeps reporting a workspace active since this morning as working", async () => {
  // `last_activity_at` marks activity rather than a heartbeat, and Replicas
  // itself retires a workspace that has gone quiet, so an active workspace is
  // working however long ago it was last touched.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeReplicasApi([activeWorkspace("workspace-long-turn", startedAt)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("keeps a sleeping workspace settled however long ago it went quiet", async () => {
  const sleptAt = TEST_TIME - 8 * 60 * 60 * 1000;
  const api = fakeReplicasApi([
    {
      id: "workspace-asleep",
      status: TEST_STATUS.SLEEPING,
      createdAt: sleptAt,
      lastActivityAt: sleptAt,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
});

test("orders the pass by latest activity rather than by creation", async () => {
  // The documented list answers newest `created_at` first, but a workspace
  // created yesterday can be the one active now, so the pass sorts by the
  // same activity timestamp the rows report.
  const api = fakeReplicasApi([
    { id: "workspace-created-late", createdAt: TEST_TIME - 1_000 },
    activeWorkspace("workspace-touched-now", TEST_TIME - 500),
    { id: "workspace-created-early", createdAt: TEST_TIME - 3_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["workspace-touched-now", "workspace-created-late", "workspace-created-early"],
  );
});

test("labels a workspace by its repository, and by neither its name nor nothing", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-repository",
      repositoryUrl: "https://github.com/reviewstage/sidecar.git",
      createdAt: TEST_TIME - 1_000,
    },
    {
      id: "workspace-name-only",
      repositoryUrl: "",
      repositoryName: "fallback-repository",
      createdAt: TEST_TIME - 2_000,
    },
    { id: "workspace-repositoryless", omitRepositories: true, createdAt: TEST_TIME - 3_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.title, "sidecar");
  assert.equal(observations[0]?.detail?.repository, "sidecar");
  assert.equal(observations[1]?.title, "fallback-repository");
  assert.equal(observations[2]?.title, "workspace");
  assert.equal(JSON.stringify(observations).includes(SECRET_NAME_TEXT), false);
});

test("reports the newest pull request as the workspace's published change", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-published",
      pullRequestUrls: [
        "https://github.com/reviewstage/luke/pull/402",
        "https://github.com/reviewstage/luke/pull/405",
      ],
      createdAt: TEST_TIME - 1_000,
    },
    { id: "workspace-unpublished", createdAt: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.detail?.change, "https://github.com/reviewstage/luke/pull/405");
  // The pull request is the row's published work, never its address: a press
  // on the row must land on the session itself or nowhere.
  assert.equal(observations[0]?.detail?.link, undefined);
  assert.equal(observations[1]?.detail?.change, undefined);
});

test("reports why an errored workspace stopped rather than leaving it idle", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-error",
      status: TEST_STATUS.ERROR,
      createdAt: TEST_TIME - 1_000,
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "The workspace failed to start or wake");
});

test("drops a workspace it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async () =>
    jsonResponse({
      replicas: [
        { status: TEST_STATUS.ACTIVE, created_at: isoTimestamp(TEST_TIME - 1_000) },
        { id: "workspace-undated", status: TEST_STATUS.ACTIVE },
        workspacePayload({ id: "workspace-dated", createdAt: TEST_TIME - 1_000 }),
      ],
    });

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["workspace-dated"],
  );
});

test("clears observations when Replicas rejects the API key", async () => {
  const api = fakeReplicasApi([activeWorkspace("workspace-active", TEST_TIME - 1_000)]);
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

test("advertises a message only for the statuses Replicas documents taking one", async () => {
  const api = fakeReplicasApi([
    { id: "workspace-active", status: TEST_STATUS.ACTIVE, createdAt: TEST_TIME - 1_000 },
    { id: "workspace-sleeping", status: TEST_STATUS.SLEEPING, createdAt: TEST_TIME - 2_000 },
    { id: "workspace-preparing", status: TEST_STATUS.PREPARING, createdAt: TEST_TIME - 3_000 },
    { id: "workspace-archived", status: TEST_STATUS.ARCHIVED, createdAt: TEST_TIME - 4_000 },
    { id: "workspace-error", status: TEST_STATUS.ERROR, createdAt: TEST_TIME - 5_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const messageable = new Map(
    observations.map((entry) => [entry.providerSessionId, entry.canReceiveMessage]),
  );

  assert.equal(messageable.get("workspace-active"), true);
  // A sleeping workspace is documented to wake when interacted with, an act
  // the user's own send performs knowingly.
  assert.equal(messageable.get("workspace-sleeping"), true);
  // An archived workspace would wake the same way, but archiving is the
  // user's own filing; how a preparing or errored workspace handles a message
  // is documented nowhere. None of them is promised one.
  assert.equal(messageable.get("workspace-preparing"), false);
  assert.equal(messageable.get("workspace-archived"), false);
  assert.equal(messageable.get("workspace-error"), false);
});

test("hands a user message to Replicas through its documented message endpoint", async () => {
  const api = fakeReplicasApi([
    { id: "workspace-active", status: TEST_STATUS.ACTIVE, createdAt: TEST_TIME - 1_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "workspace-active",
    text: "Use the existing fixture instead",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/replica/workspace-active/messages");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // The body carries the developer's words and nothing else: no agent choice,
  // no chat target, no mode flag — the workspace's own defaults stand.
  assert.deepEqual(JSON.parse(write?.body ?? ""), { message: "Use the existing fixture instead" });
});
