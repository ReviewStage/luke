import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import type { CloudFetch } from "../src/cloud-session-adapter";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "../src/cursor-adapter";

const TEST_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const TEST_BASE_URL = "https://api.cursor.test";
const TEST_API_KEY = "cursor-test-key";
const TEST_REPOSITORY = "https://github.com/reviewstage/luke";
const TEST_AGENT_NAME = "Add README with setup instructions";
const TEST_RUN_BRANCH = "cursor/add-readme-a1b2";
const TEST_RUN_RESULT = "Added the README and opened a pull request.";
const TEST_PULL_REQUEST_URL = "https://github.com/reviewstage/luke/pull/31";

/** An agent reports only whether the user filed it away. */
const TEST_AGENT_STATUS = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;

/** Its latest run reports what it is actually doing. */
const TEST_RUN_STATUS = {
  CREATING: "CREATING",
  RUNNING: "RUNNING",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;

const HTTP_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  SERVER_ERROR: 500,
} as const;

interface TestRun {
  id: string;
  status?: string;
  updatedAt?: number;
  httpStatus?: number;
}

interface TestAgent {
  id: string;
  /** Written from the opening prompt, like `summary` and the run's branch. */
  name: string;
  archived?: boolean;
  repository?: string;
  startingRef?: string;
  omitRepos?: boolean;
  createdAt: number;
  updatedAt?: number;
  run?: TestRun;
}

interface RecordedRequest {
  method: string;
  pathname: string;
  search: string;
  authorization: string | undefined;
}

interface FakeCursorApi {
  fetch: CloudFetch;
  requests: RecordedRequest[];
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function jsonResponse(body: unknown, status = HTTP_STATUS.OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastActivityAt(agent: TestAgent): number {
  return agent.updatedAt ?? agent.createdAt;
}

/**
 * `GET /v1/agents` returns only the durable identity fields. A list item that
 * carried `repos` would hide the fact that an adapter reading it there finds
 * nothing, so this fixture withholds them exactly as the API does.
 */
function agentPayload(agent: TestAgent): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.archived ? TEST_AGENT_STATUS.ARCHIVED : TEST_AGENT_STATUS.ACTIVE,
    env: { type: "cloud" },
    url: `https://cursor.com/agents/${agent.id}`,
    createdAt: isoTimestamp(agent.createdAt),
    updatedAt: isoTimestamp(lastActivityAt(agent)),
    ...(agent.run ? { latestRunId: agent.run.id } : {}),
  };
}

function runPayload(agent: TestAgent, run: TestRun): Record<string, unknown> {
  return {
    id: run.id,
    agentId: agent.id,
    status: run.status ?? TEST_RUN_STATUS.FINISHED,
    createdAt: isoTimestamp(agent.createdAt),
    updatedAt: isoTimestamp(run.updatedAt ?? lastActivityAt(agent)),
    durationMs: 12_357,
    result: TEST_RUN_RESULT,
    ...(agent.omitRepos
      ? {}
      : {
          git: {
            branches: [
              {
                repoUrl: agent.repository ?? TEST_REPOSITORY,
                branch: TEST_RUN_BRANCH,
                prUrl: TEST_PULL_REQUEST_URL,
              },
            ],
          },
        }),
  };
}

/** Serves the read-only subset of the public API the adapter is allowed to use. */
function fakeCursorApi(agents: readonly TestAgent[]): FakeCursorApi {
  const requests: RecordedRequest[] = [];
  const fetch: CloudFetch = async (url, init) => {
    const { pathname, searchParams, search } = new URL(url);
    const headers = new Headers(init.headers);
    requests.push({
      method: init.method ?? "",
      pathname,
      search,
      authorization: headers.get("authorization") ?? undefined,
    });

    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (segments[0] !== "v1" || segments[1] !== "agents") {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    if (segments.length === 2) {
      const limit = Number(searchParams.get("limit") ?? "20");
      // Cursor answers newest-first and pages the rest behind `nextCursor`.
      const page = [...agents]
        .sort((first, second) => lastActivityAt(second) - lastActivityAt(first))
        .slice(0, limit);
      return jsonResponse({
        items: page.map(agentPayload),
        ...(page.length < agents.length ? { nextCursor: "next-page" } : {}),
      });
    }

    if (segments[3] === "runs" && segments.length === 5) {
      const agent = agents.find((candidate) => candidate.id === segments[2]);
      const run = agent?.run?.id === segments[4] ? agent.run : undefined;
      if (!agent || !run) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      if (run.httpStatus) return jsonResponse({}, run.httpStatus);
      return jsonResponse(runPayload(agent, run));
    }
    return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
  };
  return { fetch, requests };
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
    maximumObservedSessions?: number;
  } = {},
): CursorSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new CursorSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
    ...(overrides.maximumObservedSessions === undefined
      ? {}
      : { maximumObservedSessions: overrides.maximumObservedSessions }),
  });
}

function runningAgent(id: string, updatedAt: number): TestAgent {
  return {
    id,
    name: TEST_AGENT_NAME,
    createdAt: updatedAt,
    updatedAt,
    run: { id: `run-${id}`, status: TEST_RUN_STATUS.RUNNING, updatedAt },
  };
}

test("observes a running agent under the name Cursor gave it", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-running",
      name: TEST_AGENT_NAME,
      startingRef: "main",
      createdAt: TEST_TIME - 60_000,
      updatedAt: TEST_TIME - 30_000,
      run: { id: "run-running", status: TEST_RUN_STATUS.RUNNING, updatedAt: TEST_TIME - 30_000 },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(CURSOR_PROVIDER, { id: "cursor", displayName: "Cursor" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "agent-running");
  assert.equal(observations[0]?.title, TEST_AGENT_NAME);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  assert.equal(observations[0]?.summary, TEST_RUN_RESULT);
  // The repository the run names, which is the only place the API reports one
  // for an agent that came from a list page.
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: TEST_RUN_BRANCH,
    link: "https://cursor.com/agents/agent-running",
    change: TEST_PULL_REQUEST_URL,
  });
  // One list call, then one read of the run that list named. Nothing else.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/agents", "/v1/agents/agent-running/runs/run-running"],
  );
  assert.equal(api.requests[0]?.search, "?limit=100");
  assert.equal(
    api.requests.every(
      (request) => request.method === "GET" && request.authorization === `Bearer ${TEST_API_KEY}`,
    ),
    true,
  );
});

test("maps every run state Cursor reports onto a state Luke can show", async () => {
  const api = fakeCursorApi(
    (
      [
        [TEST_RUN_STATUS.RUNNING, "running"],
        [TEST_RUN_STATUS.FINISHED, "finished"],
        [TEST_RUN_STATUS.CANCELLED, "cancelled"],
        [TEST_RUN_STATUS.EXPIRED, "expired"],
        [TEST_RUN_STATUS.CREATING, "creating"],
        [TEST_RUN_STATUS.ERROR, "errored"],
      ] as const
    ).map(([status, name], index) => ({
      id: `agent-${name}`,
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - (index + 1) * 1_000,
      updatedAt: TEST_TIME - (index + 1) * 1_000,
      run: { id: `run-${name}`, status, updatedAt: TEST_TIME - (index + 1) * 1_000 },
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["agent-running", SESSION_STATUS.WORKING],
      ["agent-finished", SESSION_STATUS.WAITING],
      ["agent-cancelled", SESSION_STATUS.COMPLETE],
      ["agent-expired", SESSION_STATUS.COMPLETE],
      ["agent-creating", SESSION_STATUS.UNKNOWN],
      // A run Cursor failed stopped on something the developer has to deal
      // with, which is not the same as a state Luke could not read.
      ["agent-errored", SESSION_STATUS.ERROR],
    ],
  );
});

test("reports a turn that just ended as waiting however long the run took", async () => {
  // The agent was started hours ago and the run took most of that time. Dating
  // the turn from the agent instead of its run would call this stale and leave
  // Luke silent at the one moment the user is being waited on.
  const api = fakeCursorApi([
    {
      id: "agent-long-turn",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 4 * 60 * 60 * 1000,
      updatedAt: TEST_TIME - 3 * 60 * 60 * 1000,
      run: { id: "run-long-turn", status: TEST_RUN_STATUS.FINISHED, updatedAt: TEST_TIME - 60_000 },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 60_000);
});

test("stops calling a finished run waiting once it goes stale", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-abandoned",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 3 * 60 * 60 * 1000,
      updatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
      run: {
        id: "run-abandoned",
        status: TEST_RUN_STATUS.FINISHED,
        updatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
      },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps reporting a long run as working", async () => {
  // A run state is stamped with the moment it was entered rather than with a
  // heartbeat, so a turn that started an hour ago and is still going must not
  // read as stale.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeCursorApi([runningAgent("agent-long-run", startedAt)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("reports an archived agent as complete without reading its run", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-archived",
      name: TEST_AGENT_NAME,
      archived: true,
      createdAt: TEST_TIME - 30_000,
      updatedAt: TEST_TIME - 20_000,
      run: { id: "run-archived", status: TEST_RUN_STATUS.RUNNING },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 20_000);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/agents"],
  );
});

test("leaves an agent that has never run unknown without reading a run", async () => {
  const api = fakeCursorApi([
    { id: "agent-unrun", name: TEST_AGENT_NAME, createdAt: TEST_TIME - 5_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/agents"],
  );
});

test("leaves a run state this build does not know unknown", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-unrecognized",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 1_000,
      run: { id: "run-unrecognized", status: "SOME_LATER_STATE", updatedAt: TEST_TIME - 1_000 },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps observing when one agent's run cannot be read", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-unreadable",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 1_000,
      updatedAt: TEST_TIME - 1_000,
      run: { id: "run-unreadable", httpStatus: HTTP_STATUS.SERVER_ERROR },
    },
    runningAgent("agent-readable", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observations[1]?.status, SESSION_STATUS.WORKING);
});

test("ignores agents untouched for longer than the maximum session age", async () => {
  const api = fakeCursorApi([runningAgent("agent-last-week", TEST_TIME - 48 * 60 * 60 * 1000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/agents"],
  );
});

test("takes an agent's repository from the run, because a list page carries none", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-repository",
      name: TEST_AGENT_NAME,
      repository: "git@github.com:reviewstage/sidecar.git",
      createdAt: TEST_TIME - 1_000,
      run: { id: "run-repository", status: TEST_RUN_STATUS.RUNNING, updatedAt: TEST_TIME - 1_000 },
    },
    {
      id: "agent-repositoryless",
      name: TEST_AGENT_NAME,
      omitRepos: true,
      createdAt: TEST_TIME - 2_000,
      run: {
        id: "run-repositoryless",
        status: TEST_RUN_STATUS.RUNNING,
        updatedAt: TEST_TIME - 2_000,
      },
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.detail?.repository, "sidecar");
  // A run that has pushed nothing names no repository, and the agent is still
  // worth showing under the name Cursor gave it.
  assert.equal(observations[1]?.detail?.repository, undefined);
  assert.equal(observations[1]?.title, TEST_AGENT_NAME);
});

test("falls back to a neutral label for an agent with no name at all", async () => {
  const api = fakeCursorApi([
    { id: "agent-nameless", name: "", omitRepos: true, createdAt: TEST_TIME - 1_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.title, "Cloud agent");
});

test("bounds the agents a single pass observes, keeping the ones that can still change", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-archived-moments-ago",
      name: TEST_AGENT_NAME,
      archived: true,
      createdAt: TEST_TIME - 1_000,
      updatedAt: TEST_TIME - 1_000,
    },
    runningAgent("agent-running-newer", TEST_TIME - 2_000),
    runningAgent("agent-running-older", TEST_TIME - 3_000),
  ]);

  const observations = await adapterFor(api.fetch, { maximumObservedSessions: 2 }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["agent-running-newer", "agent-running-older"],
  );
});

test("drops an agent it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async () =>
    jsonResponse({
      items: [
        { name: TEST_AGENT_NAME, status: TEST_AGENT_STATUS.ACTIVE },
        { id: "agent-undated", name: TEST_AGENT_NAME, status: TEST_AGENT_STATUS.ACTIVE },
        {
          id: "agent-complete",
          name: TEST_AGENT_NAME,
          status: TEST_AGENT_STATUS.ACTIVE,
          repos: [{ url: TEST_REPOSITORY }],
          createdAt: isoTimestamp(TEST_TIME - 1_000),
          updatedAt: isoTimestamp(TEST_TIME - 1_000),
        },
      ],
    });

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["agent-complete"],
  );
});

test("reports nothing and issues no request without an API key", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);

  const observations = await adapterFor(api.fetch, { apiKey: undefined }).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(api.requests, []);
});

test("reports nothing when the credential cannot be read", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch, {
    readApiKey: async () => {
      throw new Error("settings are unreadable");
    },
  });

  assert.deepEqual(await adapter.observe(), []);
  assert.deepEqual(api.requests, []);
});

test("reuses the previous snapshot inside the minimum refresh interval", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, { now: () => now, minimumRefreshIntervalMs: 15_000 });

  const first = await adapter.observe();
  const requestsAfterFirstPass = api.requests.length;
  now = TEST_TIME + 5_000;
  const throttled = await adapter.observe();
  const requestsAfterThrottledPass = api.requests.length;
  now = TEST_TIME + 20_000;
  const refreshed = await adapter.observe();

  assert.equal(first.length, 1);
  assert.deepEqual(throttled, first);
  assert.equal(
    requestsAfterThrottledPass,
    requestsAfterFirstPass,
    "throttled pass issued requests",
  );
  assert.ok(api.requests.length > requestsAfterThrottledPass, "refreshed pass issued no request");
  assert.equal(refreshed.length, 1);
});

test("observes again immediately after the API key changes", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  let apiKey = TEST_API_KEY;
  const adapter = adapterFor(api.fetch, {
    readApiKey: async () => apiKey,
    minimumRefreshIntervalMs: 60_000,
  });

  await adapter.observe();
  const requestsAfterFirstPass = api.requests.length;
  apiKey = "cursor-replacement-key";
  const observations = await adapter.observe();

  assert.ok(api.requests.length > requestsAfterFirstPass);
  assert.equal(observations.length, 1);
  assert.equal(
    api.requests.at(-1)?.authorization,
    "Bearer cursor-replacement-key",
    "the replacement key was not used",
  );
});

test("clears observations when Cursor rejects the API key", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
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

test("keeps the previous snapshot when the list request fails transiently", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  let failRequests = false;
  const gatedFetch: CloudFetch = async (url, init) => {
    if (failRequests) throw new Error("network unreachable");
    return api.fetch(url, init);
  };
  const adapter = adapterFor(gatedFetch);

  const observed = await adapter.observe();
  failRequests = true;
  const duringOutage = await adapter.observe();

  assert.equal(observed.length, 1);
  assert.deepEqual(duringOutage, observed);
});
