import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HostedIssueClient } from "@luke/features";
import { ISSUE_CALL_FAILURE } from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "@luke/features/issue-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { jsonResponse, noNetwork, recordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { Effect } from "effect";
import { composeIssues, type IssuesClient } from "./compose-issues.js";

/**
 * The issues concern: behind a closed gate nothing is asked of the service,
 * a call's params reach the service as the window named them, the window
 * hears the service's answer whole, params of the wrong shape are refused
 * before anything travels, and the service is asked over the HTTP client the
 * host was handed. Synthetic ids and words.
 */

const ISSUE_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const ISSUE = {
  id: ISSUE_ID,
  workspaceId: WORKSPACE_ID,
  number: 1,
  title: "Flaky login",
  description: "",
  status: ISSUE_STATUS.BACKLOG,
  priority: ISSUE_PRIORITY.NONE,
  creator: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
} as const;

/** The service as a script that writes down every ask it hears, as the ask runs. */
function fakeService() {
  const asked: unknown[] = [];
  const answer =
    <A>(name: string, value: A) =>
    (params: Parameters<IssuesClient[keyof IssuesClient]>[0]) =>
      Effect.sync(() => {
        asked.push([name, params]);
        return value;
      });
  const client: IssuesClient = {
    list: answer("list", { issues: [ISSUE] }),
    read: answer("read", { failure: ISSUE_CALL_FAILURE.NOT_FOUND }),
    create: answer("create", { issue: ISSUE }),
    change: answer("change", { issue: ISSUE }),
  };
  return { client, asked };
}

function subject(options: { signedIn?: boolean; sendsNetwork?: boolean } = {}) {
  return Effect.gen(function* () {
    const service = fakeService();
    const composer = yield* composeIssues({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked };
  });
}

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { call, asked } = yield* subject(options);
      assert.deepEqual(yield* call(GATEWAY_METHOD.ISSUES_LIST, { workspaceId: WORKSPACE_ID }), {
        failure: ISSUE_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.ISSUES_CREATE, { workspaceId: WORKSPACE_ID, title: "Bug" }),
        { failure: ISSUE_CALL_FAILURE.UNANSWERED },
      );
      assert.deepEqual(asked, []);
    }
  }),
);

it.effect(
  "a call's params reach the service as the window named them, and the window hears the answer whole",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const made = { workspaceId: WORKSPACE_ID, title: "Flaky login" };
      const change = { issueId: ISSUE_ID, change: { status: ISSUE_STATUS.DONE } };

      const listed = yield* call(GATEWAY_METHOD.ISSUES_LIST, { workspaceId: WORKSPACE_ID });
      const read = yield* call(GATEWAY_METHOD.ISSUES_READ, { issueId: ISSUE_ID });
      const created = yield* call(GATEWAY_METHOD.ISSUES_CREATE, made);
      const changed = yield* call(GATEWAY_METHOD.ISSUES_CHANGE, change);

      assert.deepEqual(listed, { issues: [ISSUE] });
      assert.deepEqual(read, { failure: ISSUE_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(created, { issue: ISSUE });
      assert.deepEqual(changed, { issue: ISSUE });
      assert.deepEqual(asked, [
        ["list", { workspaceId: WORKSPACE_ID }],
        ["read", { issueId: ISSUE_ID }],
        ["create", made],
        ["change", change],
      ]);
    }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    const unnamed = yield* Effect.flip(call(GATEWAY_METHOD.ISSUES_READ, { issueId: "not-an-id" }));
    const untitled = yield* Effect.flip(
      call(GATEWAY_METHOD.ISSUES_CREATE, { workspaceId: WORKSPACE_ID, title: " " }),
    );
    const empty = yield* Effect.flip(
      call(GATEWAY_METHOD.ISSUES_CHANGE, { issueId: ISSUE_ID, change: {} }),
    );

    assert.equal(unnamed._tag, "InvalidParamsRefusal");
    assert.equal(untitled._tag, "InvalidParamsRefusal");
    assert.equal(empty._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, []);
  }),
);

it.effect("the service is asked over the HTTP client the host was handed", () =>
  Effect.gen(function* () {
    const http = recordingHttpClient(() => jsonResponse({ issues: [ISSUE] }));
    const composer = yield* composeIssues({
      kernel: { runMode: { sendsNetwork: true } },
      account: { capabilitiesActive: () => true },
      client: new HostedIssueClient({
        serviceBaseUrl: "https://tryluke.test",
        readAccessToken: () => Effect.succeed("bearer-1"),
        refreshAccount: () => Effect.void,
      }),
    }).pipe(Effect.provide(http.layer));
    const list = composer.methods[GATEWAY_METHOD.ISSUES_LIST];
    assert.ok(list, "no handler for the issues list");

    const listed = yield* list({ workspaceId: WORKSPACE_ID }, context);

    assert.deepEqual(listed, { issues: [ISSUE] });
    const sent = recordedRequest(http.requests);
    assert.equal(sent.authorization, "Bearer bearer-1");
    assert.ok(sent.url.startsWith("https://tryluke.test/"));
  }),
);
