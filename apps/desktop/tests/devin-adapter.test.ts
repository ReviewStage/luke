import assert from "node:assert/strict";
import test from "node:test";
import {
  isControllableAdapter,
  isMessageCapableAdapter,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  SESSION_STATUS,
} from "@sidecar/core";
import type { CloudFetch } from "../src/cloud-session-adapter";
import { DEVIN_PROVIDER, DevinSessionAdapter } from "../src/devin-adapter";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "./support/http-fake";

const TEST_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const TEST_BASE_URL = "https://api.devin.test";
const TEST_API_KEY = "cog_devin-test-token";
const TEST_ORG_ID = "org-reviewstage";
const TEST_USER_ID = "user-observer";
const TEST_TEAMMATE_ID = "user-someone-else";
const TEST_PULL_REQUEST = "https://github.com/reviewstage/luke/pull/42";
const TEST_SESSION_TITLE = "Wire the notch geometry adapter";

/** The principals Devin can report behind a `cog_` credential. */
const TEST_PRINCIPAL = {
  PAT_USER: "pat_user",
  SERVICE_USER: "service_user",
} as const;

/** The session lifecycle, verbatim from the documented v3 `status`. */
const TEST_STATUS = {
  NEW: "new",
  CLAIMED: "claimed",
  RUNNING: "running",
  EXIT: "exit",
  ERROR: "error",
  SUSPENDED: "suspended",
  RESUMING: "resuming",
} as const;

/** What a session is doing, verbatim from the documented `status_detail`. */
const TEST_DETAIL = {
  WORKING: "working",
  WAITING_FOR_USER: "waiting_for_user",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  FINISHED: "finished",
  INACTIVITY: "inactivity",
  OUT_OF_CREDITS: "out_of_credits",
} as const;

interface TestSession {
  id: string;
  status?: string;
  detail?: string;
  archived?: boolean;
  title?: string;
  omitTitle?: boolean;
  userId?: string;
  omitUser?: boolean;
  pullRequest?: string;
  omitPullRequest?: boolean;
  /** Devin reports seconds; the adapter must not read them as milliseconds. */
  updatedAt: number;
}

function seconds(timestampMs: number): number {
  return Math.floor(timestampMs / 1000);
}

function sessionPayload(session: TestSession): Record<string, unknown> {
  return {
    session_id: session.id,
    org_id: TEST_ORG_ID,
    ...(session.omitTitle ? {} : { title: session.title ?? TEST_SESSION_TITLE }),
    status: session.status ?? TEST_STATUS.RUNNING,
    ...(session.detail ? { status_detail: session.detail } : {}),
    created_at: seconds(session.updatedAt),
    updated_at: seconds(session.updatedAt),
    is_archived: session.archived === true,
    origin: "webapp",
    acus_consumed: 3.5,
    tags: [],
    url: `https://app.devin.ai/sessions/${session.id}`,
    // The session's own output, which is shaped by whoever prompted it: not a
    // recap a provider wrote, so no observation carries it.
    structured_output: { summary: "SECRET_STRUCTURED_OUTPUT" },
    ...(session.omitUser ? {} : { user_id: session.userId ?? TEST_USER_ID }),
    ...(session.omitPullRequest
      ? { pull_requests: [] }
      : {
          pull_requests: [{ pr_url: session.pullRequest ?? TEST_PULL_REQUEST, pr_state: "open" }],
        }),
  };
}

/** Serves the read-only subset of the public v3 API the adapter may use. */
function fakeDevinApi(
  sessions: readonly TestSession[],
  options: { principal?: string; orgId?: string | undefined; userId?: string } = {},
) {
  return recordingFetch((request) => {
    const { pathname, searchParams, method } = request;

    // The two documented writers: a message for one existing session, and an
    // archive that files one away.
    if (method === "POST") {
      const match = pathname.match(
        new RegExp(`^/v3/organizations/${TEST_ORG_ID}/sessions/([^/]+)/(messages|archive)$`),
      );
      const known = match && sessions.some((session) => session.id === match[1]);
      if (!known) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      return match[2] === "archive"
        ? jsonResponse({ session_id: match[1], is_archived: true })
        : jsonResponse({});
    }

    if (pathname === "/v3/self") {
      const principal = options.principal ?? TEST_PRINCIPAL.PAT_USER;
      const orgId = "orgId" in options ? options.orgId : TEST_ORG_ID;
      return jsonResponse({
        principal_type: principal,
        api_key_id: "key-1",
        api_key_name: "Luke",
        ...(principal === TEST_PRINCIPAL.SERVICE_USER
          ? { service_user_id: "service-1", service_user_name: "CI" }
          : { user_id: options.userId ?? TEST_USER_ID }),
        ...(orgId ? { org_id: orgId } : {}),
      });
    }

    if (pathname !== `/v3/organizations/${TEST_ORG_ID}/sessions`) {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // Devin lists the organization and narrows it only when asked.
    const requestedUser = searchParams.get("user_ids");
    const updatedAfter = Number(searchParams.get("updated_after") ?? "0");
    const first = Number(searchParams.get("first") ?? "100");
    const after = Number(searchParams.get("after") ?? "0");
    const visible = sessions
      .filter((session) => !requestedUser || (session.userId ?? TEST_USER_ID) === requestedUser)
      .filter((session) => seconds(session.updatedAt) >= updatedAfter);
    const page = visible.slice(after, after + first);
    return jsonResponse({
      items: page.map(sessionPayload),
      total: visible.length,
      has_next_page: after + first < visible.length,
      end_cursor: after + first < visible.length ? String(after + first) : null,
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
): DevinSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new DevinSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

function workingSession(id: string, updatedAt: number): TestSession {
  return { id, status: TEST_STATUS.RUNNING, detail: TEST_DETAIL.WORKING, updatedAt };
}

test("routes messages and the archive control, and no other write", () => {
  const adapter = adapterFor(async () => new Response("{}", { status: 200 }));
  assert.equal(isMessageCapableAdapter(adapter), true);
  assert.equal(isControllableAdapter(adapter), true);
  assert.equal(isWorkspaceCapableAdapter(adapter), false);
  assert.equal(isWorkspaceAgentCapableAdapter(adapter), false);
});

test("advertises the archive only for a session positively seen settled", async () => {
  const settled = TEST_TIME - 1_000;
  const api = fakeDevinApi([
    { id: "devin-exited", status: TEST_STATUS.EXIT, updatedAt: settled },
    { id: "devin-errored", status: TEST_STATUS.ERROR, updatedAt: settled },
    { id: "devin-suspended", status: TEST_STATUS.SUSPENDED, updatedAt: settled },
    {
      id: "devin-holding",
      status: TEST_STATUS.RUNNING,
      detail: TEST_DETAIL.WAITING_FOR_USER,
      updatedAt: settled,
    },
    workingSession("devin-working", settled),
    // A running session whose machine reports no detail may be mid-turn, and
    // a state this build does not know is not a settled one.
    { id: "devin-detailless", status: TEST_STATUS.RUNNING, updatedAt: settled },
    { id: "devin-new", status: TEST_STATUS.NEW, updatedAt: settled },
    { id: "devin-filed", status: TEST_STATUS.EXIT, archived: true, updatedAt: settled },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  for (const sessionId of ["devin-exited", "devin-errored", "devin-suspended", "devin-holding"]) {
    assert.deepEqual(byId.get(sessionId)?.controls, [
      { id: "archive-session", label: "Archive this session" },
    ]);
  }
  for (const sessionId of ["devin-working", "devin-detailless", "devin-new", "devin-filed"]) {
    assert.equal(byId.get(sessionId)?.controls, undefined);
  }
});

test("files a settled session away through Devin's archive endpoint, sending no body", async () => {
  const api = fakeDevinApi([
    { id: "devin-suspended", status: TEST_STATUS.SUSPENDED, updatedAt: TEST_TIME - 1_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.executeControl({
    providerSessionId: "devin-suspended",
    control: { id: "archive-session", label: "Archive this session" },
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(
    write?.pathname,
    `/v3/organizations/${TEST_ORG_ID}/sessions/devin-suspended/archive`,
  );
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // Devin documents no body for an archive.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("refuses to archive a session whose row never advertised it", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  // A working session advertised no archive, so the ask has nothing behind it
  // and no request exists.
  const result = await adapter.executeControl({
    providerSessionId: "devin-working",
    control: { id: "archive-session", label: "Archive this session" },
  });

  assert.deepEqual(result, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);
});

test("observes a working session and labels it the way Devin named it", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 30_000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(DEVIN_PROVIDER, { id: "devin", displayName: "Devin" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "devin-working");
  assert.equal(observations[0]?.title, TEST_SESSION_TITLE);
  assert.equal(observations[0]?.detail?.repository, "luke");
  assert.equal(observations[0]?.detail?.change, TEST_PULL_REQUEST);
  assert.equal(observations[0]?.detail?.link, "https://app.devin.ai/sessions/devin-working");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  // The session's structured output is shaped by its prompt, so it stays out.
  assert.equal(JSON.stringify(observations).includes("SECRET_STRUCTURED_OUTPUT"), false);
  // Devin is asked who the credential belongs to, then for that person's
  // sessions. Nothing else.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v3/self", `/v3/organizations/${TEST_ORG_ID}/sessions`],
  );
  assert.equal(api.requests[1]?.search, `?first=200&user_ids=${TEST_USER_ID}`);
  assert.equal(
    api.requests.every(
      (request) => request.method === "GET" && request.authorization === `Bearer ${TEST_API_KEY}`,
    ),
    true,
  );
});

test("asks Devin who the credential belongs to once and reuses the answer", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
  const adapter = adapterFor(api.fetch);

  await adapter.observe();
  await adapter.observe();

  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    [
      "/v3/self",
      `/v3/organizations/${TEST_ORG_ID}/sessions`,
      `/v3/organizations/${TEST_ORG_ID}/sessions`,
    ],
  );
});

test("reports nothing for a service-user credential, which names no person", async () => {
  // A service user is an organization's automation account. Every session it
  // can reach belongs to somebody else, so there is nothing here to report.
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)], {
    principal: TEST_PRINCIPAL.SERVICE_USER,
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v3/self"],
  );
});

test("reports nothing for a token Devin places in no organization", async () => {
  // Every v3 session list is org-scoped and the only route that could name an
  // organization for a token is enterprise-admin, so there is nothing to read.
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)], {
    orgId: undefined,
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v3/self"],
  );
});

test("asks once about a credential it cannot observe as, not once a refresh", async () => {
  // Asking again cannot change the answer while the credential stands, and a
  // stored token Luke has no use for must not poll Devin forever.
  for (const options of [{ principal: TEST_PRINCIPAL.SERVICE_USER }, { orgId: undefined }]) {
    const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)], options);
    const adapter = adapterFor(api.fetch);

    await adapter.observe();
    await adapter.observe();
    await adapter.observe();

    assert.deepEqual(
      api.requests.map((request) => request.pathname),
      ["/v3/self"],
      JSON.stringify(options),
    );
  }
});

test("maps the states Devin reports onto states Luke can show", async () => {
  const api = fakeDevinApi(
    (
      [
        ["devin-working", TEST_STATUS.RUNNING, TEST_DETAIL.WORKING],
        ["devin-waiting-user", TEST_STATUS.RUNNING, TEST_DETAIL.WAITING_FOR_USER],
        ["devin-waiting-approval", TEST_STATUS.RUNNING, TEST_DETAIL.WAITING_FOR_APPROVAL],
        ["devin-turn-over", TEST_STATUS.RUNNING, TEST_DETAIL.FINISHED],
        ["devin-running-undetailed", TEST_STATUS.RUNNING, undefined],
        ["devin-exited", TEST_STATUS.EXIT, TEST_DETAIL.FINISHED],
        ["devin-idle-out", TEST_STATUS.SUSPENDED, TEST_DETAIL.INACTIVITY],
        ["devin-out-of-credits", TEST_STATUS.SUSPENDED, TEST_DETAIL.OUT_OF_CREDITS],
        ["devin-new", TEST_STATUS.NEW, undefined],
        ["devin-claimed", TEST_STATUS.CLAIMED, undefined],
        ["devin-resuming", TEST_STATUS.RESUMING, undefined],
        ["devin-errored", TEST_STATUS.ERROR, undefined],
        ["devin-later-state", "some_later_state", undefined],
      ] as const
    ).map(([id, status, detail], index) => ({
      id,
      status,
      ...(detail ? { detail } : {}),
      updatedAt: TEST_TIME - (index + 1) * 1_000,
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["devin-working", SESSION_STATUS.WORKING],
      ["devin-waiting-user", SESSION_STATUS.WAITING],
      ["devin-waiting-approval", SESSION_STATUS.WAITING],
      // The turn ended but the machine is still up: the session is holding for
      // whoever started it, which v1 could not distinguish at all.
      ["devin-turn-over", SESSION_STATUS.WAITING],
      ["devin-running-undetailed", SESSION_STATUS.WORKING],
      ["devin-exited", SESSION_STATUS.COMPLETE],
      // A suspended session can be resumed, so it is neither settled nor
      // holding for anyone, whatever the reason it was suspended for.
      ["devin-idle-out", SESSION_STATUS.UNKNOWN],
      ["devin-out-of-credits", SESSION_STATUS.UNKNOWN],
      ["devin-new", SESSION_STATUS.UNKNOWN],
      ["devin-claimed", SESSION_STATUS.UNKNOWN],
      ["devin-resuming", SESSION_STATUS.UNKNOWN],
      ["devin-errored", SESSION_STATUS.ERROR],
      ["devin-later-state", SESSION_STATUS.UNKNOWN],
    ],
  );
});

test("reports an archived session as complete whatever it was doing", async () => {
  const api = fakeDevinApi([
    { ...workingSession("devin-archived", TEST_TIME - 1_000), archived: true },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
});

test("keeps reporting a long turn as working, and a session that ended as complete", async () => {
  // A state is stamped with the moment it was entered rather than with a
  // heartbeat, so neither a turn that started an hour ago nor a session that
  // ended an hour ago may be reported as anything else.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeDevinApi([
    workingSession("devin-long-turn", startedAt),
    { id: "devin-long-done", status: TEST_STATUS.EXIT, updatedAt: startedAt },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.status),
    [SESSION_STATUS.WORKING, SESSION_STATUS.COMPLETE],
  );
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("stops calling a session that is holding for the user waiting once it goes stale", async () => {
  const api = fakeDevinApi([
    {
      id: "devin-abandoned",
      status: TEST_STATUS.RUNNING,
      detail: TEST_DETAIL.WAITING_FOR_USER,
      updatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
});

test("reads a timestamp Devin reports in seconds as the moment it means", async () => {
  // Devin types its timestamps as bare integers without naming the unit, so a
  // session updated a minute ago must not read as one from 1970.
  const api = fakeDevinApi([workingSession("devin-recent", TEST_TIME - 60_000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.observedAt, TEST_TIME - 60_000);
});

test("keeps a session untouched since the day before yesterday", async () => {
  const api = fakeDevinApi([workingSession("devin-last-week", TEST_TIME - 48 * 60 * 60 * 1000)]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["devin-last-week"],
  );
});

test("falls back to the repository its pull request is in when Devin named nothing", async () => {
  const api = fakeDevinApi([
    {
      ...workingSession("devin-github", TEST_TIME - 1_000),
      pullRequest: "https://github.com/reviewstage/sidecar/pull/7",
    },
    {
      ...workingSession("devin-gitlab", TEST_TIME - 2_000),
      pullRequest: "https://gitlab.com/reviewstage/group/sidecar-web/-/merge_requests/3",
    },
    {
      ...workingSession("devin-bitbucket", TEST_TIME - 3_000),
      pullRequest: "https://bitbucket.org/reviewstage/sidecar-native/pull-requests/9",
      omitTitle: true,
    },
    {
      ...workingSession("devin-unopened", TEST_TIME - 4_000),
      omitPullRequest: true,
      omitTitle: true,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.detail?.repository),
    ["sidecar", "sidecar-web", "sidecar-native", undefined],
  );
  // What Devin named it, then where the work landed, then neither.
  assert.deepEqual(
    observations.map((observation) => observation.title),
    [TEST_SESSION_TITLE, TEST_SESSION_TITLE, "sidecar-native", "Cloud session"],
  );
});

test("surfaces only the credential owner's work, however Devin answers the filter", async () => {
  // The fake honours `user_ids`, so a teammate's session reaches the adapter
  // only when the server-side filter is disregarded. It must survive neither
  // route, and neither must a session attributed to nobody.
  const api = fakeDevinApi([
    workingSession("devin-mine", TEST_TIME - 1_000),
    { ...workingSession("devin-theirs", TEST_TIME - 2_000), userId: TEST_TEAMMATE_ID },
    { ...workingSession("devin-unattributed", TEST_TIME - 3_000), omitUser: true },
  ]);
  const unfiltered: CloudFetch = async (url, init) => {
    const address = new URL(url);
    address.searchParams.delete("user_ids");
    return api.fetch(address.href, init);
  };

  const filtered = await adapterFor(api.fetch).observe();
  const ignored = await adapterFor(unfiltered).observe();

  assert.deepEqual(
    filtered.map((observation) => observation.providerSessionId),
    ["devin-mine"],
  );
  assert.deepEqual(
    ignored.map((observation) => observation.providerSessionId),
    ["devin-mine"],
  );
});

test("reports every session the page holds, newest first", async () => {
  const api = fakeDevinApi([
    workingSession("devin-oldest", TEST_TIME - 3_000),
    workingSession("devin-newest", TEST_TIME - 1_000),
    workingSession("devin-middle", TEST_TIME - 2_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["devin-newest", "devin-middle", "devin-oldest"],
  );
});

test("drops a session it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async (url) =>
    new URL(url).pathname === "/v3/self"
      ? jsonResponse({ principal_type: "pat_user", user_id: TEST_USER_ID, org_id: TEST_ORG_ID })
      : jsonResponse({
          items: [
            { status: "running", user_id: TEST_USER_ID },
            { session_id: "devin-undated", status: "running", user_id: TEST_USER_ID },
            {
              session_id: "devin-not-a-number",
              status: "running",
              user_id: TEST_USER_ID,
              updated_at: "2026-08-13T02:44:00.000Z",
            },
            {
              session_id: "devin-complete",
              status: "running",
              user_id: TEST_USER_ID,
              updated_at: seconds(TEST_TIME - 1_000),
            },
          ],
        });

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["devin-complete"],
  );
});

test("reports nothing and issues no request without an API key", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);

  const observations = await adapterFor(api.fetch, { apiKey: undefined }).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(api.requests, []);
});

test("reuses the previous snapshot inside the minimum refresh interval", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
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

test("forgets who a replaced credential belonged to before reading as the new one", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
  let apiKey = TEST_API_KEY;
  const adapter = adapterFor(api.fetch, {
    readApiKey: async () => apiKey,
    minimumRefreshIntervalMs: 60_000,
  });

  await adapter.observe();
  apiKey = "cog_replacement-token";
  const observations = await adapter.observe();

  assert.equal(observations.length, 1);
  // The identity is read again rather than carried over from the key it was
  // read with, so no session can be reported as the wrong person's.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    [
      "/v3/self",
      `/v3/organizations/${TEST_ORG_ID}/sessions`,
      "/v3/self",
      `/v3/organizations/${TEST_ORG_ID}/sessions`,
    ],
  );
  assert.equal(api.requests.at(-1)?.authorization, "Bearer cog_replacement-token");
});

test("clears observations when Devin rejects the credential", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
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
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 1_000)]);
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

test("advertises a message only for sessions Devin will take one for", async () => {
  const api = fakeDevinApi([
    { id: "devin-working", status: TEST_STATUS.RUNNING, updatedAt: TEST_TIME - 1_000 },
    { id: "devin-suspended", status: TEST_STATUS.SUSPENDED, updatedAt: TEST_TIME - 2_000 },
    { id: "devin-exited", status: TEST_STATUS.EXIT, updatedAt: TEST_TIME - 3_000 },
    { id: "devin-failed", status: TEST_STATUS.ERROR, updatedAt: TEST_TIME - 4_000 },
    {
      id: "devin-filed",
      status: TEST_STATUS.RUNNING,
      archived: true,
      updatedAt: TEST_TIME - 5_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const messageable = new Map(
    observations.map((entry) => [entry.providerSessionId, entry.canReceiveMessage]),
  );

  // A running session takes a message, and a suspended one is resumed by it —
  // both documented. A session that exited or failed is promised nothing, and
  // an archived one the user has already filed away.
  assert.equal(messageable.get("devin-working"), true);
  assert.equal(messageable.get("devin-suspended"), true);
  assert.equal(messageable.get("devin-exited"), false);
  assert.equal(messageable.get("devin-failed"), false);
  assert.equal(messageable.get("devin-filed"), false);
});

test("hands a user message to Devin's documented message endpoint", async () => {
  const api = fakeDevinApi([workingSession("devin-working", TEST_TIME - 30_000)]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "devin-working",
    text: "Please also add unit tests",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, `/v3/organizations/${TEST_ORG_ID}/sessions/devin-working/messages`);
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), { message: "Please also add unit tests" });
});

test("refuses a message for a session Devin never promised to take one for", async () => {
  const api = fakeDevinApi([
    { id: "devin-exited", status: TEST_STATUS.EXIT, updatedAt: TEST_TIME - 1_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const observationRequests = api.requests.length;

  const settled = await adapter.sendMessage({ providerSessionId: "devin-exited", text: "go on" });
  const unknown = await adapter.sendMessage({ providerSessionId: "devin-unknown", text: "go on" });

  assert.deepEqual(settled, { status: "unsupported" });
  assert.deepEqual(unknown, { status: "unsupported" });
  assert.equal(api.requests.length, observationRequests);
});
