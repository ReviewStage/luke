import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, recordingHttpClient } from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HostedIssueClient } from "./issue-client.js";
import { ISSUE_CALL_FAILURE } from "./issue-view.js";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "./issue-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * The window's issue calls against a scripted service: each travels under
 * the account's bearer to its own path, the list names its workspace in the
 * query, a write the service would refuse by shape never travels, and a
 * refusal is named in the window's own words. Synthetic ids and words.
 */

const ISSUE_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

const ISSUE = {
  id: ISSUE_ID,
  workspaceId: WORKSPACE_ID,
  number: 1,
  title: "Flaky login",
  description: "",
  status: ISSUE_STATUS.BACKLOG,
  priority: ISSUE_PRIORITY.NONE,
  creator: { userId: "user-1", name: "Ada" },
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

function client(): HostedIssueClient {
  return new HostedIssueClient({
    serviceBaseUrl: "https://tryluke.dev",
    requestTimeoutMs: 10_000,
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
  });
}

it.effect(
  "each call goes to its own path under the account's bearer, and the list names its workspace",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/issues": { answer: () => ({ issues: [ISSUE] }) },
        "POST /api/issues": { answer: () => ({ issue: ISSUE }) },
        [`GET /api/issues/${ISSUE_ID}`]: { answer: () => ({ issue: ISSUE }) },
        [`PATCH /api/issues/${ISSUE_ID}`]: {
          answer: () => ({ issue: { ...ISSUE, status: ISSUE_STATUS.DONE } }),
        },
      });
      const ask = client();

      const listed = yield* Effect.provide(ask.list({ workspaceId: WORKSPACE_ID }), api.layer);
      const archived = yield* Effect.provide(
        ask.list({ workspaceId: WORKSPACE_ID, archived: true }),
        api.layer,
      );
      const made = yield* Effect.provide(
        ask.create({ workspaceId: WORKSPACE_ID, title: "  Flaky login " }),
        api.layer,
      );
      const read = yield* Effect.provide(ask.read({ issueId: ISSUE_ID }), api.layer);
      const changed = yield* Effect.provide(
        ask.change({ issueId: ISSUE_ID, change: { status: ISSUE_STATUS.DONE } }),
        api.layer,
      );

      assert.deepEqual(listed, { issues: [ISSUE] });
      assert.deepEqual(archived, { issues: [ISSUE] });
      assert.deepEqual(made, { issue: ISSUE });
      assert.deepEqual(read, { issue: ISSUE });
      assert.deepEqual(changed, { issue: { ...ISSUE, status: ISSUE_STATUS.DONE } });
      const requests = api.requests();
      assert.equal(requests[0]?.searchParams.get("workspaceId"), WORKSPACE_ID);
      assert.equal(requests[0]?.searchParams.get("archived"), null);
      assert.equal(requests[1]?.searchParams.get("archived"), "true");
      assert.deepEqual(JSON.parse(requests[2]?.body ?? "{}"), {
        workspaceId: WORKSPACE_ID,
        title: "Flaky login",
      });
      assert.deepEqual(JSON.parse(requests[4]?.body ?? "{}"), { status: ISSUE_STATUS.DONE });
      assert.deepEqual(api.credentials(), Array(5).fill("token-1"));
    }),
);

it.effect(
  "a refusal is named in the window's words, a write the service would refuse by shape never travels, and a failed call answers unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`GET /api/issues/${ISSUE_ID}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
        [`PATCH /api/issues/${ISSUE_ID}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.INVALID_REQUEST }),
          status: HTTP_STATUS.BAD_REQUEST,
        },
        "GET /api/issues": { answer: () => ({ issues: "not a list" }) },
      });
      const ask = client();

      const gone = yield* Effect.provide(ask.read({ issueId: ISSUE_ID }), api.layer);
      const refused = yield* Effect.provide(
        ask.change({ issueId: ISSUE_ID, change: { title: "Renamed" } }),
        api.layer,
      );
      const unread = yield* Effect.provide(ask.list({ workspaceId: WORKSPACE_ID }), api.layer);
      const untitled = yield* Effect.provide(
        ask.create({ workspaceId: WORKSPACE_ID, title: "   " }),
        api.layer,
      );
      const empty = yield* Effect.provide(ask.change({ issueId: ISSUE_ID, change: {} }), api.layer);

      assert.deepEqual(gone, { failure: ISSUE_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(refused, { failure: ISSUE_CALL_FAILURE.INVALID });
      assert.deepEqual(unread, { failure: ISSUE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(untitled, { failure: ISSUE_CALL_FAILURE.INVALID });
      assert.deepEqual(empty, { failure: ISSUE_CALL_FAILURE.INVALID });
      assert.equal(api.requests().length, 3, "no unsendable write traveled");
    }),
);

it.effect(
  "a body that stalls after its headers answers unanswered once the deadline passes, rather than never, and is let go",
  () =>
    Effect.gen(function* () {
      let cancelled = false;
      const stalled = recordingHttpClient(
        () =>
          new Response(
            new ReadableStream({
              start: (controller) => controller.enqueue(new TextEncoder().encode('{"issues":')),
              cancel: () => {
                cancelled = true;
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );

      const asked = yield* Effect.forkChild(
        Effect.provide(client().list({ workspaceId: WORKSPACE_ID }), stalled.layer),
      );
      yield* TestClock.adjust("10 seconds");
      const listed = yield* Fiber.join(asked);

      assert.deepEqual(listed, { failure: ISSUE_CALL_FAILURE.UNANSWERED });
      assert.ok(cancelled, "the stalled body is let go");
    }),
);
