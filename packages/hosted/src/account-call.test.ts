import assert from "node:assert/strict";
import test from "node:test";
import { HTTP_METHOD, type UnparsedWireValue } from "@sidecar/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordedRequest,
  recordingFetch,
} from "@sidecar/wire/testing";
import {
  accountBearer,
  CALL_FAULT,
  type CallCredential,
  callAnswered,
  createAccountCall,
  fixedBearer,
  NO_CREDENTIAL,
} from "./account-call.js";

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
      readAccessToken: () => Promise.resolve(token),
      refreshAccount: () => {
        renewals.push("renewed");
        token = tokens.shift() ?? token;
        holder = holders === undefined ? holder : (holders.shift() ?? holder);
        return Promise.resolve();
      },
      ...(holders ? { readAccountKey: () => Promise.resolve(holder) } : undefined),
    }),
  };
}

function callOn(
  credential: CallCredential,
  respond: (request: RecordedRequest) => Response | Promise<Response>,
  requestTimeoutMs?: number,
) {
  const { fetch, requests } = recordingFetch(respond);
  return {
    requests,
    call: createAccountCall({ baseUrl: `${BASE_URL}/`, credential, fetch, requestTimeoutMs }),
  };
}

test("the base address is trimmed once and a body is what names a content type", async () => {
  const { call, requests } = callOn(fixedBearer("sk-test"), () => jsonResponse({}));

  await call.send({ method: HTTP_METHOD.PUT, path: PATH, body: '{"a":1}' });
  await call.send({ method: HTTP_METHOD.GET, path: PATH });

  assert.equal(recordedRequest(requests).url, `${BASE_URL}${PATH}`);
  assert.equal(recordedRequest(requests).method, HTTP_METHOD.PUT);
  assert.equal(recordedRequest(requests).authorization, "Bearer sk-test");
  assert.equal(recordedRequest(requests).contentType, "application/json");
  assert.equal(recordedRequest(requests).body, '{"a":1}');
  assert.equal(recordedRequest(requests, 1).contentType, undefined);
  assert.equal(recordedRequest(requests, 1).body, undefined);
  assert.equal(call.address(PATH), `${BASE_URL}${PATH}`);
});

test("a header the build fixes travels, and cannot displace the authorization", async () => {
  const { call, requests } = callOn(fixedBearer("sk-test"), () => jsonResponse({}));

  await call.send({
    method: HTTP_METHOD.POST,
    path: PATH,
    body: "{}",
    headers: { "x-luke-client": "desktop", authorization: "Bearer forged" },
  });

  assert.equal(recordedRequest(requests).headers.get("x-luke-client"), "desktop");
  assert.equal(recordedRequest(requests).authorization, "Bearer sk-test");
});

test("a 401 renews the credential and retries once, on the credential that changed", async () => {
  const { credential, renewals } = account(["stale", "fresh"]);
  const { call, requests } = callOn(credential, (request) =>
    request.authorization === "Bearer fresh" ? jsonResponse({ ok: true }) : refusal(),
  );

  const answer = await call.send({ method: HTTP_METHOD.GET, path: PATH });

  assert.ok(callAnswered(answer) && answer.response.ok);
  assert.deepEqual(
    requests.map((request) => request.authorization),
    ["Bearer stale", "Bearer fresh"],
  );
  assert.equal(renewals.length, 1);
});

test("a renewal that produced the same credential, or none at all, leaves the refusal standing", async () => {
  const unchanged = account(["only"]);
  const stuck = callOn(unchanged.credential, () => refusal());
  const standing = await stuck.call.send({ method: HTTP_METHOD.GET, path: PATH });
  assert.ok(callAnswered(standing) && standing.response.status === HTTP_STATUS.UNAUTHORIZED);
  assert.equal(stuck.requests.length, 1);
  assert.equal(unchanged.renewals.length, 1);

  const signedOut = account(["held", undefined]);
  const gone = callOn(signedOut.credential, () => refusal());
  const answer = await gone.call.send({ method: HTTP_METHOD.GET, path: PATH });
  assert.ok(callAnswered(answer) && answer.response.status === HTTP_STATUS.UNAUTHORIZED);
  assert.equal(gone.requests.length, 1);

  const failing = createAccountCall({
    baseUrl: BASE_URL,
    credential: {
      authorization: () => Promise.resolve("Bearer held"),
      renew: () => Promise.reject(new Error("the network is down")),
    },
    fetch: () => Promise.resolve(refusal()),
  });
  const refused = await failing.send({ method: HTTP_METHOD.GET, path: PATH });
  assert.ok(callAnswered(refused) && refused.response.status === HTTP_STATUS.UNAUTHORIZED);
});

test("a credential that reads nothing asks the service nothing at all", async () => {
  const { call, requests } = callOn(account([undefined]).credential, () => jsonResponse({}));

  const answer = await call.send({ method: HTTP_METHOD.GET, path: PATH });

  assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NO_CREDENTIAL);
  assert.deepEqual(requests, []);
});

test("an endpoint that takes no identity is asked without a header, and its own 401 is no fault of a credential", async () => {
  const { call, requests } = callOn(NO_CREDENTIAL, () => refusal());

  const answer = await call.send({ method: HTTP_METHOD.POST, path: PATH, body: "{}" });

  assert.ok(callAnswered(answer) && answer.response.status === HTTP_STATUS.UNAUTHORIZED);
  assert.equal(requests.length, 1);
  assert.equal(recordedRequest(requests).authorization, undefined);
});

test("a holder that changed between the attempt and its retry refuses the retry", async () => {
  const { credential, renewals } = account(
    ["stale", "fresh"],
    ["ada@luke.test", "grace@luke.test"],
  );
  const { call, requests } = callOn(credential, () => refusal());

  const answer = await call.send({ method: HTTP_METHOD.POST, path: PATH, body: "{}" });

  assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.HOLDER_CHANGED);
  assert.equal(renewals.length, 1);
  assert.deepEqual(
    requests.map((request) => request.authorization),
    ["Bearer stale"],
  );
});

test("a holder that stands is retried under the credential that changed", async () => {
  const { credential } = account(["stale", "fresh"], ["ada@luke.test"]);
  const { call, requests } = callOn(credential, (request) =>
    request.authorization === "Bearer fresh" ? jsonResponse({ ok: true }) : refusal(),
  );

  const answer = await call.send({ method: HTTP_METHOD.GET, path: PATH });

  assert.ok(callAnswered(answer) && answer.response.ok);
  assert.equal(requests.length, 2);
});

test("a fetch that throws is a network fault named by the error's kind alone, never its words", async () => {
  const { call } = callOn(fixedBearer("sk-secret-key"), () => {
    throw new TypeError("sk-secret-key was refused by dns");
  });

  const answer = await call.send({ method: HTTP_METHOD.GET, path: PATH });

  assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NETWORK);
  assert.equal(answer.errorName, "TypeError");
});

test("an ask reads a validated body, and a fault, a refusal, or a body that is not JSON is no answer", async () => {
  const read = (payload: UnparsedWireValue) => (payload === undefined ? undefined : { payload });

  const answered = callOn(fixedBearer("sk-test"), () => jsonResponse({ voice: "marin" }));
  assert.deepEqual(await answered.call.ask({ method: HTTP_METHOD.GET, path: PATH }, read), {
    payload: { voice: "marin" },
  });

  const refused = callOn(fixedBearer("sk-test"), () => refusal());
  assert.equal(await refused.call.ask({ method: HTTP_METHOD.GET, path: PATH }, read), undefined);

  const unreadable = callOn(fixedBearer("sk-test"), () => new Response("not json"));
  assert.equal(await unreadable.call.ask({ method: HTTP_METHOD.GET, path: PATH }, read), undefined);

  const offline = callOn(fixedBearer("sk-test"), () => {
    throw new Error("offline");
  });
  assert.equal(await offline.call.ask({ method: HTTP_METHOD.GET, path: PATH }, read), undefined);

  const refusedByReader = callOn(fixedBearer("sk-test"), () => jsonResponse({}));
  assert.equal(
    await refusedByReader.call.ask({ method: HTTP_METHOD.GET, path: PATH }, () => undefined),
    undefined,
  );
});

test("the deadline is the one the call was built with, and it ends a request that outlives it", async () => {
  const asked = callOn(fixedBearer("sk-test"), () => jsonResponse({}));
  assert.equal(asked.call.requestTimeoutMs, 10_000);
  assert.equal(
    callOn(fixedBearer("sk-test"), () => jsonResponse({}), 90_000).call.requestTimeoutMs,
    90_000,
  );

  const held = createAccountCall({
    baseUrl: BASE_URL,
    credential: fixedBearer("sk-test"),
    requestTimeoutMs: 1,
    fetch: (_url, init) =>
      new Promise((_settle, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  });
  const answer = await held.send({ method: HTTP_METHOD.GET, path: PATH });
  assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NETWORK);
  assert.equal(answer.errorName, "TimeoutError");
});

test("the caller's own cancellation is joined with the deadline, and neither alone ends the other", async () => {
  const cancellation = new AbortController();
  const { call, requests } = callOn(fixedBearer("sk-test"), () => jsonResponse({}));

  await call.send({ method: HTTP_METHOD.GET, path: PATH, signal: cancellation.signal });

  const signal = recordedRequest(requests).init.signal;
  assert.ok(signal && !signal.aborted);
  cancellation.abort();
  assert.equal(signal.aborted, true);
});
