import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import type { CloudFetch } from "../src/cloud-session-adapter";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "../src/cursor-adapter";
import { describeCloudAdapterContract } from "./support/cloud-adapter-contract";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "./support/http-fake";

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

interface TestRun {
  id: string;
  status?: string;
  updatedAt?: number;
  httpStatus?: number;
}

interface TestAgent {
  id: string;
  /** Written from the opening prompt, like the recap and the run's branch. */
  name: string;
  archived?: boolean;
  repository?: string;
  startingRef?: string;
  omitRepos?: boolean;
  createdAt: number;
  updatedAt?: number;
  run?: TestRun;
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
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
function fakeCursorApi(
  agents: readonly TestAgent[],
  options: {
    repositories?: readonly string[];
    /** Holds the first repositories answer until released, like a slow org. */
    gateFirstRepositoriesRead?: Promise<void>;
  } = {},
) {
  let repositoriesReads = 0;
  return recordingFetch(async (request) => {
    const { pathname, searchParams, method, body: rawBody } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (segments[0] === "v1" && segments[1] === "repositories" && segments.length === 2) {
      if (!options.repositories) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      repositoriesReads += 1;
      if (repositoriesReads === 1 && options.gateFirstRepositoriesRead) {
        await options.gateFirstRepositoriesRead;
      }
      return jsonResponse({
        items: options.repositories.map((repository) => ({ url: repository })),
      });
    }
    if (segments[0] !== "v1" || segments[1] !== "agents") {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // The four documented writers: a new agent, a follow-up run for an
    // existing one, a cancel for the run it is still working, and an archive
    // for the agent itself.
    if (method === "POST") {
      if (segments.length === 2) {
        const body = JSON.parse(rawBody ?? "{}") as {
          prompt?: { text?: string };
          repos?: { url?: string }[];
        };
        const repository = body.repos?.[0]?.url;
        if (!body.prompt?.text || !options.repositories?.includes(repository ?? "")) {
          return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        }
        return jsonResponse(
          { agent: { id: "bc-new-agent", status: "ACTIVE" }, run: { id: "run-first" } },
          201,
        );
      }
      const agent = agents.find((candidate) => candidate.id === segments[2]);
      if (agent && segments[3] === "runs" && segments.length === 4) {
        return jsonResponse({ run: { id: "run-followup", agentId: agent.id } }, 201);
      }
      if (agent && segments[3] === "archive" && segments.length === 4) {
        return jsonResponse({ id: agent.id, status: "ARCHIVED" });
      }
      if (
        agent &&
        segments[3] === "runs" &&
        agent.run?.id === segments[4] &&
        segments[5] === "cancel" &&
        segments.length === 6
      ) {
        return jsonResponse({});
      }
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
): CursorSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new CursorSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

test("declares every provider operation on one adapter interface", () => {
  const adapter = adapterFor(async () => new Response("{}", { status: 200 }));
  assert.equal(typeof adapter.sendMessage, "function");
  assert.equal(typeof adapter.executeControl, "function");
  assert.equal(typeof adapter.createWorkspace, "function");
  assert.equal(typeof adapter.spawnWorkspaceAgent, "function");
});

function runningAgent(id: string, updatedAt: number): TestAgent {
  return {
    id,
    name: TEST_AGENT_NAME,
    createdAt: updatedAt,
    updatedAt,
    run: { id: `run-${id}`, status: TEST_RUN_STATUS.RUNNING, updatedAt },
  };
}

describeCloudAdapterContract("Cursor", (options) => {
  const api = fakeCursorApi([runningAgent("contract-agent", TEST_TIME - 1_000)]);
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
  // A running agent can be stopped and nothing else; the follow-up belongs to
  // a finished run.
  assert.deepEqual(observations[0]?.controls, [
    { id: "cancel-run", label: "Stop this run", kind: "stop", target: "run-running" },
  ]);
  assert.equal(observations[0]?.canReceiveMessage, false);
  assert.equal(observations[0]?.recap, TEST_RUN_RESULT);
  // The repository the run names, which is the only place the API reports one
  // for an agent that came from a list page.
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: TEST_RUN_BRANCH,
    link: "https://cursor.com/agents/agent-running",
    change: TEST_PULL_REQUEST_URL,
  });
  // The repository offer, one list call, then one read of the run that list
  // named. Nothing else.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/repositories", "/v1/agents", "/v1/agents/agent-running/runs/run-running"],
  );
  assert.equal(api.requests[1]?.search, "?limit=100");
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
    ["/v1/repositories", "/v1/agents"],
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
    ["/v1/repositories", "/v1/agents"],
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

test("keeps an agent untouched since the day before yesterday", async () => {
  const api = fakeCursorApi([runningAgent("agent-last-week", TEST_TIME - 48 * 60 * 60 * 1000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["agent-last-week"],
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

test("reports every agent the page holds, the ones that can still change first", async () => {
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

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["agent-running-newer", "agent-running-older", "agent-archived-moments-ago"],
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

function finishedAgent(id: string, updatedAt: number): TestAgent {
  return {
    id,
    name: TEST_AGENT_NAME,
    createdAt: updatedAt,
    updatedAt,
    run: { id: `run-${id}`, status: TEST_RUN_STATUS.FINISHED, updatedAt },
  };
}

test("advertises a follow-up only for an agent whose run has finished", async () => {
  const api = fakeCursorApi([
    finishedAgent("agent-finished", TEST_TIME - 1_000),
    runningAgent("agent-running", TEST_TIME - 2_000),
    {
      id: "agent-errored",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 3_000,
      run: { id: "run-agent-errored", status: TEST_RUN_STATUS.ERROR },
    },
    {
      id: "agent-filed",
      name: TEST_AGENT_NAME,
      archived: true,
      createdAt: TEST_TIME - 4_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(byId.get("agent-finished")?.canReceiveMessage, true);
  // A running agent answers conflict until its run ends, and what a follow-up
  // does after a failure is documented nowhere; neither is promised one.
  assert.equal(byId.get("agent-running")?.canReceiveMessage, false);
  assert.equal(byId.get("agent-errored")?.canReceiveMessage, false);
  assert.equal(byId.get("agent-filed")?.canReceiveMessage, false);
  // The stoppable one is the one still running; every settled agent offers to
  // be filed away instead, and one already filed offers nothing.
  assert.deepEqual(byId.get("agent-running")?.controls, [
    { id: "cancel-run", label: "Stop this run", kind: "stop", target: "run-agent-running" },
  ]);
  assert.deepEqual(byId.get("agent-finished")?.controls, [
    { id: "archive-agent", label: "Archive" },
  ]);
  assert.deepEqual(byId.get("agent-errored")?.controls, [
    { id: "archive-agent", label: "Archive" },
  ]);
  assert.equal(byId.get("agent-filed")?.controls, undefined);
});

test("hands a follow-up to Cursor's documented run endpoint", async () => {
  const api = fakeCursorApi([finishedAgent("agent-finished", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "agent-finished",
    text: "Also add troubleshooting steps",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/agents/agent-finished/runs");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    prompt: { text: "Also add troubleshooting steps" },
  });
});

test("stops the run the user saw through Cursor's cancel endpoint, sending no body", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  // Deliberately without a target: the route must be built from the control
  // the adapter itself advertised, never from the caller's copy of it.
  const cancelControl = { id: "cancel-run", label: "Stop this run", kind: "stop" };

  const result = await adapter.executeControl({
    providerSessionId: "agent-running",
    control: cancelControl,
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/agents/agent-running/runs/run-agent-running/cancel");
  // Cursor documents no body for a cancel.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("keeps the archive off an agent whose run could not be read", async () => {
  const api = fakeCursorApi([
    {
      id: "agent-unreadable",
      name: TEST_AGENT_NAME,
      createdAt: TEST_TIME - 1_000,
      run: { id: "run-agent-unreadable", httpStatus: HTTP_STATUS.SERVER_ERROR },
    },
    { id: "agent-never-ran", name: TEST_AGENT_NAME, createdAt: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // A run that could not be read is not known to have stopped, so that agent
  // is offered nothing rather than a filing away that could land on a live
  // turn. An agent that never ran has no run to take: its own record is the
  // positive observation, so it still offers the archive.
  assert.equal(byId.get("agent-unreadable")?.controls, undefined);
  assert.deepEqual(byId.get("agent-never-ran")?.controls, [
    { id: "archive-agent", label: "Archive" },
  ]);
});

test("files a settled agent away through Cursor's archive endpoint, sending no body", async () => {
  const api = fakeCursorApi([finishedAgent("agent-finished", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.executeControl({
    providerSessionId: "agent-finished",
    control: { id: "archive-agent", label: "Archive" },
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/agents/agent-finished/archive");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // Cursor documents no body for an archive.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("refuses to archive an agent whose row never advertised it", async () => {
  const api = fakeCursorApi([runningAgent("agent-running", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  // A running agent advertised only its stop, so an archive ask has nothing
  // behind it and no request exists.
  const result = await adapter.executeControl({
    providerSessionId: "agent-running",
    control: { id: "archive-agent", label: "Archive" },
  });

  assert.deepEqual(result, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);
});

test("offers the repositories Cursor lists, on a cadence far below the observation pass", async () => {
  const api = fakeCursorApi([], { repositories: [TEST_REPOSITORY] });
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, { now: () => now });

  assert.deepEqual(adapter.workspaceProjects(), []);
  await adapter.observe();
  // The offer rides beside the pass, so let it land before asserting on it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(adapter.workspaceProjects(), [
    // Cursor's creation endpoint requires a prompt, so every repository needs
    // an opening task: there is no idle agent to make.
    { providerProjectId: TEST_REPOSITORY, repository: "luke", taskSupport: "required" },
  ]);

  // Cursor documents strict limits on the repository list, so the next pass
  // must not read it again: one repositories request, however many passes.
  const repositoryReads = () =>
    api.requests.filter((request) => request.pathname === "/v1/repositories").length;
  assert.equal(repositoryReads(), 1);
  now += 60_000;
  await adapter.observe();
  assert.equal(repositoryReads(), 1);
});

test("launches a new agent through Cursor's documented creation endpoint", async () => {
  const api = fakeCursorApi([], { repositories: [TEST_REPOSITORY] });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  // The offer rides beside the pass, so let it land before asserting on it.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const result = await adapter.createWorkspace({
    providerProjectId: TEST_REPOSITORY,
    name: "readme touch-up",
    task: "Add a README with setup instructions",
  });

  // The acceptance names the agent the launch response did, so the surface
  // can open it once observation reports it — an id, never an address.
  assert.deepEqual(result, { status: "accepted", providerSessionId: "bc-new-agent" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/agents");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    prompt: { text: "Add a README with setup instructions" },
    repos: [{ url: TEST_REPOSITORY }],
    name: "readme touch-up",
  });
});

test("refuses a creation ask Cursor cannot take before any request exists", async () => {
  const api = fakeCursorApi([], { repositories: [TEST_REPOSITORY] });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  // The offer rides beside the pass, so let it land before asserting on it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const requestsBefore = api.requests.length;

  // No task, no agent: Cursor documents no way to create one idle.
  const taskless = await adapter.createWorkspace({ providerProjectId: TEST_REPOSITORY });
  assert.equal(taskless.status, "rejected");

  // A repository Cursor did not list is nowhere to create, however real.
  const unlisted = await adapter.createWorkspace({
    providerProjectId: "https://github.com/reviewstage/unlisted",
    task: "Add a README",
  });
  assert.deepEqual(unlisted, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);
});

test("a repository answer that outlives its pass still lands", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = fakeCursorApi([], {
    repositories: [TEST_REPOSITORY],
    gateFirstRepositoriesRead: gate,
  });
  const adapter = adapterFor(api.fetch);

  // The slow read starts on the first pass and is still in flight while more
  // passes come and go — the very case the wide deadline exists for, so a
  // newer pass must not discard its answer.
  await adapter.observe();
  await adapter.observe();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    adapter.workspaceProjects().map((project) => project.providerProjectId),
    [TEST_REPOSITORY],
  );
});

test("a repository answer never lands across a credential change", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = fakeCursorApi([], {
    repositories: [TEST_REPOSITORY],
    gateFirstRepositoriesRead: gate,
  });
  let apiKey: string | undefined = TEST_API_KEY;
  const adapter = adapterFor(api.fetch, { readApiKey: async () => apiKey });

  await adapter.observe();
  // The key is removed while the slow read is in flight: whatever it answers
  // belongs to a credential that no longer stands, and must not be kept.
  apiKey = undefined;
  await adapter.observe();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(adapter.workspaceProjects(), []);
});
