import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fixedBearer, HostedIssueClient } from "@luke/features";
import type { IssuesLiveAnswer } from "@luke/features/issue-live";
import {
  ISSUE_CALL_FAILURE,
  type IssuesFollowed,
  issuesFollowedSchema,
} from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "@luke/features/issue-wire";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { jsonResponse, noNetwork, recordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { Duration, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { composeIssues, type IssuesClient, type IssuesDependencies } from "./compose-issues.js";
import type { LiveClient } from "./live-follow.js";

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
function fakeService(
  options: { listLive?: IssuesLiveAnswer; txid?: string; signedOutSeal?: boolean } = {},
) {
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
    change: answer(
      "change",
      options.txid === undefined ? { issue: ISSUE } : { issue: ISSUE, txid: options.txid },
    ),
    listLive: (workspaceId, userId) =>
      Effect.sync(() => {
        asked.push(["listLive", workspaceId, userId]);
        if (options.signedOutSeal === true) return LIVE_SIGNED_OUT;
        return options.listLive ?? { failure: ISSUE_CALL_FAILURE.UNANSWERED };
      }),
  };
  return { client, asked };
}

/** The host's clock, which renewals are timed by. */
const LIVE_NOW = 1_800_000_000_000;

/** A kernel whose events of the followed issues are written down. */
function kernelOf(sendsNetwork: boolean, followed: IssuesFollowed[]): IssuesDependencies["kernel"] {
  return {
    runMode: { sendsNetwork },
    now: () => LIVE_NOW,
    emit: (kind, payload) => {
      if (kind !== GATEWAY_EVENT.ISSUES_CHANGED) return;
      const read = readEither(issuesFollowedSchema)(payload);
      assert.ok(Result.isSuccess(read), "the event carries what was followed");
      followed.push(read.success);
    },
  };
}

function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    listLive?: IssuesLiveAnswer;
    txid?: string;
    signedOutSeal?: boolean;
    openLive?: (url: string) => LiveClient;
    /** The account signed in; Dana's where left out, and none for `null`. */
    accountId?: string | null;
  } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const followed: IssuesFollowed[] = [];
    const composer = yield* composeIssues({
      kernel: kernelOf(options.sendsNetwork ?? true, followed),
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      accountId: () =>
        options.accountId === undefined ? "user-dana" : (options.accountId ?? undefined),
      ...(options.openLive === undefined ? undefined : { openLive: options.openLive }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked, followed, reset: composer.reset };
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
      kernel: kernelOf(true, []),
      account: { capabilitiesActive: () => true },
      accountId: () => "user-dana",
      client: new HostedIssueClient({
        serviceBaseUrl: "https://tryluke.test",
        credential: fixedBearer("bearer-1"),
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

/** Lets what was delivered or read reach the events, through the fibers that carry it. */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** Realtime as a script: each subscription by its capability, and a way to deliver its rows. */
function fakeRealtime() {
  /** Every transaction a write's answer waited for, in order. */
  const awaited: string[] = [];
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const open = (): LiveClient => ({
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: () => Promise.resolve(),
      awaitTxId: (txid) => {
        awaited.push(txid);
        return Promise.resolve();
      },
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => undefined,
  });
  const deliver = (capability: string, data: readonly unknown[]) => {
    const listener = listeners.get(capability);
    assert.ok(listener, `no subscription to ${capability}`);
    listener({ status: "live", data });
  };
  return { open, deliver, awaited, subscribed: () => [...listeners.keys()] };
}

/** A standing issue as its live row delivers it. */
const rowOf = (number: number, updatedAt: number) => ({
  id: `3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f6${number}`,
  workspaceId: WORKSPACE_ID,
  number,
  title: `Issue ${number}`,
  description: "",
  status: ISSUE_STATUS.TODO,
  priority: ISSUE_PRIORITY.HIGH,
  creatorId: number === 1 ? "user-1" : null,
  creatorName: number === 1 ? "Dana" : null,
  createdAt: 1,
  updatedAt,
});

it.effect(
  "a followed workspace's issues are pushed from their live rows, the most recently changed first, with no read on a clock, and nothing once let go",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      const listLive: IssuesLiveAnswer = {
        url: "wss://realtime.example/v1",
        queries: {
          issues: {
            capability: "issues",
            queryFingerprint: "issues",
            expiresAt: LIVE_NOW + 60_000,
          },
        },
      };
      const { call, asked, followed } = yield* subject({ listLive, openLive: realtime.open });
      const scope = { workspaceId: WORKSPACE_ID };

      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, scope);
      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, scope);
      yield* settled;
      realtime.deliver("issues", [rowOf(1, 10), rowOf(2, 20)]);
      yield* settled;

      assert.deepEqual(
        followed.map(({ workspaceId, view }) => [
          workspaceId,
          "issues" in view ? view.issues.map((each) => [each.number, each.creator]) : view,
        ]),
        [
          [
            WORKSPACE_ID,
            [
              [2, null],
              [1, { userId: "user-1", name: "Dana" }],
            ],
          ],
        ],
      );
      assert.deepEqual(asked, [["listLive", WORKSPACE_ID, "user-dana"]]);

      yield* call(GATEWAY_METHOD.ISSUES_UNFOLLOW, scope);
      yield* settled;
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

it.effect(
  "a workspace the service seals nothing for is told its failure and asked for again after a pause, and nothing once let go",
  () =>
    Effect.gen(function* () {
      const { call, asked, followed } = yield* subject();
      const scope = { workspaceId: WORKSPACE_ID };
      const sealsAsked = () =>
        asked.filter((each) => Array.isArray(each) && each[0] === "listLive");

      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, scope);
      yield* settled;
      assert.deepEqual(followed, [
        { workspaceId: WORKSPACE_ID, view: { failure: ISSUE_CALL_FAILURE.UNANSWERED } },
      ]);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(sealsAsked().length, 2);

      yield* call(GATEWAY_METHOD.ISSUES_UNFOLLOW, scope);
      yield* TestClock.adjust(Duration.minutes(3));
      assert.equal(sealsAsked().length, 2);
    }),
);

it.effect("behind a closed account gate nothing is followed", () =>
  Effect.gen(function* () {
    const { call, asked, followed } = yield* subject({ signedIn: false });

    yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
    yield* settled;

    assert.deepEqual(asked, []);
    assert.deepEqual(followed, []);
  }),
);

it.effect(
  "a sign-out ends every follow, so the account that was signed in is pushed no more of its issues",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      const listLive: IssuesLiveAnswer = {
        url: "wss://realtime.example/v1",
        queries: {
          issues: {
            capability: "issues",
            queryFingerprint: "issues",
            expiresAt: LIVE_NOW + 60_000,
          },
        },
      };
      const { call, followed, reset } = yield* subject({ listLive, openLive: realtime.open });

      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      assert.deepEqual(realtime.subscribed(), ["issues"]);

      yield* reset;
      yield* settled;

      assert.deepEqual(realtime.subscribed(), []);
      assert.deepEqual(followed, []);
    }),
);

it.effect(
  "a write's answer waits for its transaction on the followed list, and one with no transaction, or of a workspace not followed, does not",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      const listLive: IssuesLiveAnswer = {
        url: "wss://realtime.example/v1",
        queries: {
          issues: {
            capability: "issues",
            queryFingerprint: "issues",
            expiresAt: LIVE_NOW + 60_000,
          },
        },
      };
      const change = { issueId: ISSUE_ID, change: { status: ISSUE_STATUS.DONE } };
      const written = yield* subject({ listLive, txid: "742", openLive: realtime.open });

      const unfollowed = yield* written.call(GATEWAY_METHOD.ISSUES_CHANGE, change);
      yield* written.call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      const followed = yield* written.call(GATEWAY_METHOD.ISSUES_CHANGE, change);

      assert.deepEqual(unfollowed, { issue: ISSUE, txid: "742" });
      assert.deepEqual(followed, { issue: ISSUE, txid: "742" });
      assert.deepEqual(realtime.awaited, ["742"]);

      const unchanged = fakeRealtime();
      const plain = yield* subject({ listLive, openLive: unchanged.open });
      yield* plain.call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* plain.call(GATEWAY_METHOD.ISSUES_CHANGE, change);
      assert.deepEqual(unchanged.awaited, []);
    }),
);

it.effect(
  "a follow with no account signed in seals nothing and publishes nothing, as signed out",
  () =>
    Effect.gen(function* () {
      const { call, asked, followed } = yield* subject({ accountId: null });

      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));

      assert.deepEqual(asked, []);
      assert.deepEqual(followed, []);
    }),
);

it.effect(
  "a seal refused as signed out ends the follow for good, publishing nothing and asking no more",
  () =>
    Effect.gen(function* () {
      const { call, asked, followed } = yield* subject({ signedOutSeal: true });

      yield* call(GATEWAY_METHOD.ISSUES_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));

      assert.deepEqual(asked, [["listLive", WORKSPACE_ID, "user-dana"]]);
      assert.deepEqual(followed, []);
    }),
);
