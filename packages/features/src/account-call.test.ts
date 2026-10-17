import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_METHOD } from "@luke/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { Deferred, Effect } from "effect";
import {
  accountBearer,
  accountCall,
  CALL_FAULT,
  type CallCredential,
  callAnswered,
  DesktopRelease,
  desktopRelease,
  NO_CREDENTIAL,
} from "./account-call.js";
import { DESKTOP_VERSION_HEADER, HOSTED_API_ERROR } from "./service-wire.js";

const BASE_URL = "https://luke.test";
const PATH = "/api/account/preferences";

function refusal(): Response {
  return jsonResponse({ error: "invalid-token" }, HTTP_STATUS.UNAUTHORIZED);
}

/** An account whose token the test moves, and whose holder it can move too. */
function account(tokens: (string | undefined)[], holders?: (string | undefined)[]) {
  const renewals: string[] = [];
  let token = tokens.shift();
  let holder = holders?.shift();
  return {
    renewals,
    credential: accountBearer({
      readAccessToken: () => Effect.succeed(token),
      refreshAccount: () =>
        Effect.sync(() => {
          renewals.push("renewed");
          token = tokens.shift() ?? token;
          holder = holders === undefined ? holder : (holders.shift() ?? holder);
        }),
      ...(holders ? { readAccountKey: () => Effect.succeed(holder) } : undefined),
    }),
  };
}

/**
 * The call under a client that answers each request by hand, for a route whose
 * status moves between attempts — what a renewed credential is read by, and
 * what a route table's one status per route cannot say.
 */
function callOn(
  credential: CallCredential,
  respond: (request: RecordedRequest) => Response | Promise<Response>,
  requestTimeoutMs?: number,
) {
  const recording = recordingHttpClient(respond);
  return {
    requests: recording.requests,
    call: accountCall({
      baseUrl: `${BASE_URL}/`,
      credential,
      ...(requestTimeoutMs === undefined ? undefined : { requestTimeoutMs }),
    }),
    client: recording.layer,
  };
}

it.effect("a 401 renews the credential and retries once, on the credential that changed", () =>
  Effect.gen(function* () {
    const { credential, renewals } = account(["stale", "fresh"]);
    const { call, requests, client } = callOn(credential, (request) =>
      request.authorization === "Bearer fresh" ? jsonResponse({ ok: true }) : refusal(),
    );

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.GET, path: PATH }),
      client,
    );

    assert.ok(callAnswered(answer) && answer.response.ok);
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer stale", "Bearer fresh"],
    );
    assert.equal(renewals.length, 1);
  }),
);

it.effect(
  "an endpoint that takes no identity is asked without a header, and its own 401 is no fault of a credential",
  () =>
    Effect.gen(function* () {
      const { call, requests, client } = callOn(NO_CREDENTIAL, () => refusal());

      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.POST, path: PATH, body: "{}" }),
        client,
      );

      assert.ok(callAnswered(answer) && answer.response.status === HTTP_STATUS.UNAUTHORIZED);
      assert.equal(requests.length, 1);
      assert.equal(recordedRequest(requests).authorization, undefined);
    }),
);

it.effect("a call made with no desktop release named carries no version", () =>
  Effect.gen(function* () {
    const { call, requests, client } = callOn(NO_CREDENTIAL, () => jsonResponse({ ok: true }));

    yield* Effect.provide(call.send({ method: HTTP_METHOD.GET, path: PATH }), client);

    assert.equal(recordedRequest(requests).headers.get(DESKTOP_VERSION_HEADER), null);
  }),
);

it.effect(
  "a desktop names its build on every call, and once refused as too old sends nothing more",
  () =>
    Effect.gen(function* () {
      const release = yield* desktopRelease("0.16.0");
      const { call, requests, client } = callOn(NO_CREDENTIAL, () =>
        jsonResponse({ error: HOSTED_API_ERROR.UPDATE_REQUIRED }, HTTP_STATUS.UPGRADE_REQUIRED),
      );
      const asked = call
        .send({ method: HTTP_METHOD.GET, path: PATH })
        .pipe(Effect.provide(client), Effect.provideService(DesktopRelease, release));

      const refused = yield* asked;
      const after = yield* asked;

      assert.ok(callAnswered(refused) && refused.response.status === HTTP_STATUS.UPGRADE_REQUIRED);
      assert.deepEqual(after, { fault: CALL_FAULT.UPDATE_REQUIRED });
      assert.equal(requests.length, 1);
      assert.equal(recordedRequest(requests).headers.get(DESKTOP_VERSION_HEADER), "0.16.0");
      assert.equal(yield* Deferred.isDone(release.updateRequired), true);
    }),
);
