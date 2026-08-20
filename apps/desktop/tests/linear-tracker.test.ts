import assert from "node:assert/strict";
import test from "node:test";
import { ISSUE_ACTION_KIND, TRACKER_ACTION_RESULT_STATUS } from "@sidecar/core";
import { Effect } from "effect";
import { LinearIssueTracker } from "../src/linear-tracker";
import { runWithHttp } from "./support/effect-http";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingFetch,
} from "./support/http-fake";
import type { ParsedJsonObject } from "./support/json";

const OBSERVED_AT = 1_800_000_000_000;

function graphqlDocument(request: RecordedRequest | undefined): {
  query: string;
  variables: ParsedJsonObject;
} {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  return JSON.parse(request?.body ?? "{}") as {
    query: string;
    variables: ParsedJsonObject;
  };
}

function trackerWith(
  payloads: readonly unknown[],
  options: { accessToken?: string; status?: number } = {},
) {
  let call = 0;
  const { fetch, requests } = recordingFetch(() => {
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return jsonResponse(payload, options.status ?? HTTP_STATUS.OK);
  });
  const tracker = new LinearIssueTracker({
    readAccessToken: () => Effect.succeed(options.accessToken),
    now: () => OBSERVED_AT,
  });
  const run = <A, E>(effect: Effect.Effect<A, E, import("../src/services/http").Http>) =>
    runWithHttp(effect, fetch as typeof fetch);
  return { tracker, requests, run };
}

function assignedIssuesPayload() {
  return {
    data: {
      viewer: {
        assignedIssues: {
          nodes: [
            {
              id: "issue-uuid-1",
              identifier: "LUKE-123",
              title: "Add Codex support",
              url: "https://linear.app/luke/issue/LUKE-123",
              state: { id: "state-progress", name: "In Progress" },
              team: {
                states: {
                  nodes: [
                    { id: "state-done", name: "Done", position: 4 },
                    { id: "state-progress", name: "In Progress", position: 2 },
                    { id: "state-todo", name: "Todo", position: 1 },
                  ],
                },
              },
            },
            // A broken node is Linear's problem, not the roster's: it is
            // skipped rather than failing the pass.
            { id: "issue-uuid-2", title: "No identifier" },
          ],
        },
      },
    },
  };
}

test("no token means no request and a tracker that is not connected", async () => {
  const { tracker, requests, run } = trackerWith([assignedIssuesPayload()]);

  assert.equal(await run(tracker.observe()), undefined);
  assert.equal(requests.length, 0);
  assert.deepEqual(
    await run(
      tracker.execute({
        kind: ISSUE_ACTION_KIND.SET_STATE,
        trackerIssueId: "issue-uuid-1",
        transition: { id: "state-done", name: "Done" },
      }),
    ),
    { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED },
  );
  assert.equal(requests.length, 0);
});

test("observing reads the assigned issues and advertises the rest of the workflow", async () => {
  const { tracker, requests, run } = trackerWith([assignedIssuesPayload()], {
    accessToken: "linear-access-token",
  });

  const observations = await run(tracker.observe());

  assert.ok(observations);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    trackerIssueId: "issue-uuid-1",
    identifier: "LUKE-123",
    title: "Add Codex support",
    stateName: "In Progress",
    observedAt: OBSERVED_AT,
    url: "https://linear.app/luke/issue/LUKE-123",
    // Board order, and never the state the issue is already in.
    transitions: [
      { id: "state-todo", name: "Todo" },
      { id: "state-done", name: "Done" },
    ],
    canComment: true,
  });

  // What the consent page granted is an OAuth access token, sent under the
  // scheme every OAuth token is sent with.
  assert.equal(requests[0]?.authorization, "Bearer linear-access-token");
  // An observation pass sends the one read document and nothing else.
  assert.equal(requests.length, 1);
  assert.match(graphqlDocument(requests[0]).query, /^query AssignedIssues/);
  assert.doesNotMatch(graphqlDocument(requests[0]).query, /mutation/);
});

test("a failed or malformed read is an error, never a quieter roster", async () => {
  const failed = trackerWith([{}], {
    accessToken: "linear-access-token",
    status: HTTP_STATUS.SERVER_ERROR,
  });
  await assert.rejects(() => failed.run(failed.tracker.observe()));

  const errored = trackerWith([{ errors: [{ message: "rate limited" }] }], {
    accessToken: "linear-access-token",
  });
  await assert.rejects(() => errored.run(errored.tracker.observe()));
});

test("moving an issue posts the one documented write and reads its answer", async () => {
  const { tracker, requests, run } = trackerWith([{ data: { issueUpdate: { success: true } } }], {
    accessToken: "linear-access-token",
  });

  const result = await run(
    tracker.execute({
      kind: ISSUE_ACTION_KIND.SET_STATE,
      trackerIssueId: "issue-uuid-1",
      transition: { id: "state-done", name: "Done" },
    }),
  );

  assert.deepEqual(result, { status: TRACKER_ACTION_RESULT_STATUS.ACCEPTED });
  assert.equal(requests.length, 1);
  assert.match(graphqlDocument(requests[0]).query, /^mutation SetIssueState/);
  assert.deepEqual(graphqlDocument(requests[0]).variables, {
    id: "issue-uuid-1",
    stateId: "state-done",
  });
});

test("a comment posts the other documented write", async () => {
  const { tracker, requests, run } = trackerWith([{ data: { commentCreate: { success: true } } }], {
    accessToken: "linear-access-token",
  });

  const result = await run(
    tracker.execute({
      kind: ISSUE_ACTION_KIND.COMMENT,
      trackerIssueId: "issue-uuid-1",
      body: "Deferred to next release.",
    }),
  );

  assert.deepEqual(result, { status: TRACKER_ACTION_RESULT_STATUS.ACCEPTED });
  assert.match(graphqlDocument(requests[0]).query, /^mutation CommentOnIssue/);
  assert.deepEqual(graphqlDocument(requests[0]).variables, {
    issueId: "issue-uuid-1",
    body: "Deferred to next release.",
  });
});

test("a write Linear turns down is a rejection with a reason, never a throw", async () => {
  const setState = {
    kind: ISSUE_ACTION_KIND.SET_STATE,
    trackerIssueId: "issue-uuid-1",
    transition: { id: "state-done", name: "Done" },
  } as const;

  for (const payload of [
    { errors: [{ message: "no such state" }] },
    { data: { issueUpdate: { success: false } } },
    { data: {} },
  ]) {
    const { tracker, run } = trackerWith([payload], { accessToken: "linear-access-token" });
    const result = await run(tracker.execute(setState));
    assert.equal(result.status, TRACKER_ACTION_RESULT_STATUS.REJECTED);
    assert.ok("reason" in result && result.reason.length > 0);
  }

  const failed = trackerWith([{}], { accessToken: "linear-access-token", status: 401 });
  const result = await failed.run(failed.tracker.execute(setState));
  assert.equal(result.status, TRACKER_ACTION_RESULT_STATUS.REJECTED);
});
