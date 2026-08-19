import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_ACT_RESULT_STATUS, SESSION_STATUS } from "@sidecar/core";
import type { CloudFetch } from "../src/cloud-session-adapter";
import { COPILOT_PROVIDER, CopilotSessionAdapter } from "../src/copilot-adapter";
import { describeCloudAdapterContract } from "./support/cloud-adapter-contract";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "./support/http-fake";

const TEST_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const TEST_BASE_URL = "https://github.test";
const TEST_API_KEY = "github_pat_test-token";
const TEST_OWNER = "reviewstage";
const TEST_REPOSITORY = "luke";
const SECRET_PROMPT_TEXT = "SECRET_PROMPT_TEXT";

/** The documented `state` enum for the public-preview agent-tasks API. */
const TEST_STATE = {
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  IDLE: "idle",
  WAITING_FOR_USER: "waiting_for_user",
  TIMED_OUT: "timed_out",
  CANCELLED: "cancelled",
} as const;

interface TestTask {
  id: string;
  state?: string;
  repository?: string;
  omitUrl?: boolean;
  omitArtifacts?: boolean;
  baseRef?: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt?: number;
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function lastActivityAt(task: TestTask): number {
  return task.updatedAt ?? task.createdAt;
}

function taskPayload(task: TestTask) {
  const repository = task.repository ?? TEST_REPOSITORY;
  const payload = {
    id: task.id,
    html_url: `https://github.com/${TEST_OWNER}/${repository}/copilot/tasks/${task.id}`,
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // GitHub documents `name` as derived from the task prompt, and the branch
    // Copilot opens is named from the same text, so neither may reach a row.
    name: `${SECRET_PROMPT_TEXT} title`,
    creator: { id: 1 },
    creator_type: "user",
    owner: { id: 1 },
    repository: { id: 1296269 },
    state: task.state ?? TEST_STATE.IN_PROGRESS,
    session_count: 1,
    artifacts: [],
    archived_at: task.archivedAt === undefined ? null : isoTimestamp(task.archivedAt),
    created_at: isoTimestamp(task.createdAt),
    updated_at: isoTimestamp(lastActivityAt(task)),
  };
  if (!task.omitUrl) {
    payload.url = `https://api.github.com/agents/repos/${TEST_OWNER}/${repository}/tasks/${task.id}`;
  }
  if (!task.omitArtifacts) {
    payload.artifacts = [
      { provider: "github", type: "pull", data: { id: 42, global_id: "PR_global" } },
      {
        provider: "github",
        type: "branch",
        data: {
          head_ref: `copilot/${SECRET_PROMPT_TEXT}`,
          base_ref: task.baseRef ?? "main",
        },
      },
    ];
  }
  return payload;
}

/** Serves the read-only subset of the agent-tasks API the adapter may use. */
function fakeAgentTasksApi(tasks: readonly TestTask[]) {
  return recordingFetch((request) => {
    const { pathname, searchParams } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 2 || segments[0] !== "agents" || segments[1] !== "tasks") {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // GitHub sorts by `updated_at` descending by default, but the fake answers
    // in the order it was given: the adapter must order the pass itself.
    const pageSize = Number(searchParams.get("per_page") ?? "30");
    const page = tasks.slice(0, pageSize);
    return jsonResponse({
      tasks: page.map(taskPayload),
      total_active_count: tasks.length,
      total_archived_count: 0,
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
): CopilotSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new CopilotSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

function workingTask(id: string, updatedAt: number): TestTask {
  return { id, state: TEST_STATE.IN_PROGRESS, createdAt: updatedAt, updatedAt };
}

describeCloudAdapterContract("Copilot", (options) => {
  const api = fakeAgentTasksApi([workingTask("contract-task", TEST_TIME - 1_000)]);
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

test("answers through the shared adapter interface while routing no writes", async () => {
  const adapter = adapterFor(fakeAgentTasksApi([]).fetch);
  assert.deepEqual(await adapter.sendMessage({ providerSessionId: "missing", text: "hello" }), {
    status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
  });
  assert.deepEqual(adapter.workspaceProjects(), []);
});

test("observes a task in progress without exposing prompt-derived text", async () => {
  const api = fakeAgentTasksApi([
    {
      id: "task-in-progress",
      state: TEST_STATE.IN_PROGRESS,
      createdAt: TEST_TIME - 60_000,
      updatedAt: TEST_TIME - 30_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(COPILOT_PROVIDER, { id: "copilot", displayName: "Copilot" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "task-in-progress");
  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  // The row is worded by the surface from these fields, never by the adapter.
  assert.equal(observations[0]?.recap, undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: "main",
    link: `https://github.com/${TEST_OWNER}/luke/copilot/tasks/task-in-progress`,
  });
  // Neither the task's name nor the branch Copilot named from the prompt.
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("reads the whole pass with one pinned, GitHub-typed list call", async () => {
  const api = fakeAgentTasksApi([
    workingTask("task-one", TEST_TIME - 1_000),
    workingTask("task-two", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/agents/tasks"],
  );
  assert.equal(api.requests[0]?.search, "?per_page=100");
  assert.equal(api.requests[0]?.method, "GET");
  assert.equal(api.requests[0]?.authorization, `Bearer ${TEST_API_KEY}`);
  // GitHub's own media type rather than plain JSON, and the endpoint is in
  // public preview, so the dated API version must ride every request.
  assert.equal(api.requests[0]?.accept, "application/vnd.github+json");
  assert.equal(api.requests[0]?.headers.get("x-github-api-version"), "2026-03-10");
});

test("maps every state GitHub reports onto a state Luke can show", async () => {
  const api = fakeAgentTasksApi(
    (
      [
        [TEST_STATE.QUEUED, "queued"],
        [TEST_STATE.IN_PROGRESS, "in-progress"],
        [TEST_STATE.WAITING_FOR_USER, "waiting"],
        [TEST_STATE.COMPLETED, "completed"],
        [TEST_STATE.CANCELLED, "cancelled"],
        [TEST_STATE.FAILED, "failed"],
        [TEST_STATE.TIMED_OUT, "timed-out"],
        [TEST_STATE.IDLE, "idle"],
        ["SOME_LATER_STATE", "later-state"],
      ] as const
    ).map(([state, name], index) => ({
      id: `task-${name}`,
      state,
      createdAt: TEST_TIME - (index + 1) * 1_000,
      updatedAt: TEST_TIME - (index + 1) * 1_000,
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["task-queued", SESSION_STATUS.WORKING],
      ["task-in-progress", SESSION_STATUS.WORKING],
      ["task-waiting", SESSION_STATUS.WAITING],
      ["task-completed", SESSION_STATUS.COMPLETE],
      ["task-cancelled", SESSION_STATUS.COMPLETE],
      // A failed or timed-out task can be sent back to work with a new
      // session, so neither is promoted to an error Luke cannot describe.
      ["task-failed", SESSION_STATUS.UNKNOWN],
      ["task-timed-out", SESSION_STATUS.UNKNOWN],
      ["task-idle", SESSION_STATUS.UNKNOWN],
      ["task-later-state", SESSION_STATUS.UNKNOWN],
    ],
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("keeps reporting a long turn as working", async () => {
  // `updated_at` marks when the task last changed rather than a heartbeat, so
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // a turn that started an hour ago and is still going must not read as stale.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeAgentTasksApi([workingTask("task-long-turn", startedAt)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("stops calling a task that asked for the user waiting once it goes stale", async () => {
  const askedAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const api = fakeAgentTasksApi([
    {
      id: "task-abandoned",
      state: TEST_STATE.WAITING_FOR_USER,
      createdAt: askedAt,
      updatedAt: askedAt,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("keeps a completed task complete however long ago it finished", async () => {
  const finishedAt = TEST_TIME - 8 * 60 * 60 * 1000;
  const api = fakeAgentTasksApi([
    {
      id: "task-finished",
      state: TEST_STATE.COMPLETED,
      createdAt: finishedAt,
      updatedAt: finishedAt,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a task the user filed away as settled whatever it was doing", async () => {
  const api = fakeAgentTasksApi([
    {
      id: "task-archived",
      state: TEST_STATE.WAITING_FOR_USER,
      archivedAt: TEST_TIME - 1_000,
      createdAt: TEST_TIME - 2_000,
      updatedAt: TEST_TIME - 1_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
});

test("keeps a task untouched since the day before yesterday", async () => {
  const api = fakeAgentTasksApi([workingTask("task-last-week", TEST_TIME - 48 * 60 * 60 * 1000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["task-last-week"],
  );
});

test("orders the pass itself rather than trusting the order GitHub answers in", async () => {
  const api = fakeAgentTasksApi([
    workingTask("task-oldest", TEST_TIME - 3_000),
    workingTask("task-newest", TEST_TIME - 1_000),
    workingTask("task-middle", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["task-newest", "task-middle", "task-oldest"],
  );
});

test("labels a task by its repository, and by neither its name nor nothing", async () => {
  const api = fakeAgentTasksApi([
    { id: "task-repository", repository: "sidecar", createdAt: TEST_TIME - 1_000 },
    { id: "task-addressless", omitUrl: true, omitArtifacts: true, createdAt: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  // The repository is read from the task's own API address — the list
  // projection names the repository only by a numeric id.
  assert.equal(observations[0]?.title, "sidecar");
  assert.equal(observations[0]?.detail?.repository, "sidecar");
  assert.equal(observations[1]?.title, "workspace");
  assert.equal(observations[1]?.detail?.branch, undefined);
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("drops a task it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async () =>
    jsonResponse({
      tasks: [
        { state: TEST_STATE.IN_PROGRESS },
        { id: "task-undated", state: TEST_STATE.IN_PROGRESS },
        taskPayload({ id: "task-complete", createdAt: TEST_TIME - 1_000 }),
      ],
    });

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["task-complete"],
  );
});

test("clears observations when GitHub rejects the token", async () => {
  const api = fakeAgentTasksApi([workingTask("task-in-progress", TEST_TIME - 1_000)]);
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
