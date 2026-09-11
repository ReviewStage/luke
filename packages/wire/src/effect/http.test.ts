import assert from "node:assert/strict";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { test } from "vitest";
import { HTTP_METHOD } from "../json.js";
import { fakeCloudApi, recordedRoutes } from "../testing/cloud-fake.js";
import {
  HTTP_STATUS,
  jsonResponse,
  recordedRequest,
  recordingFetch,
} from "../testing/http-fake.js";
import { cloudFetchFromHttpClient, httpClientFromCloudFetch } from "./http.js";

const ADDRESS = "https://api.example.test/v0/sessions";

function headerMap(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

it.effect("a client over a fetch carries the request's method, headers, and body", () =>
  Effect.gen(function* () {
    const recording = recordingFetch(() => jsonResponse({ ok: true }));
    const client = httpClientFromCloudFetch(recording.fetch);

    yield* client.execute(
      HttpClientRequest.post(ADDRESS, {
        headers: { authorization: "Bearer key-1" },
        body: HttpBody.text(JSON.stringify({ name: "renamed" }), "application/json"),
      }),
    );

    const request = recordedRequest(recording.requests);
    assert.equal(request.method, HTTP_METHOD.POST);
    assert.equal(request.pathname, "/v0/sessions");
    assert.equal(request.authorization, "Bearer key-1");
    assert.equal(request.contentType, "application/json");
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a client over a fetch answers the status and body the fetch answered", () =>
  Effect.gen(function* () {
    const client = httpClientFromCloudFetch(() =>
      Promise.resolve(jsonResponse({ sessions: ["session-1"] }, HTTP_STATUS.OK)),
    );

    const response = yield* client.get(ADDRESS);
    const body = yield* response.json;

    assert.equal(response.status, HTTP_STATUS.OK);
    assert.deepEqual(body, { sessions: ["session-1"] });
    assert.equal(response.headers["content-type"], "application/json");
  }),
);

it.effect("a client over a fetch hands a refused status back rather than failing", () =>
  Effect.gen(function* () {
    const client = httpClientFromCloudFetch(() =>
      Promise.resolve(jsonResponse({}, HTTP_STATUS.UNAUTHORIZED)),
    );

    const response = yield* client.get(ADDRESS);

    assert.equal(response.status, HTTP_STATUS.UNAUTHORIZED);
  }),
);

it.effect("a rejected fetch reaches the caller as a transport request error", () =>
  Effect.gen(function* () {
    const failure = new Error("socket closed");
    const client = httpClientFromCloudFetch(() => Promise.reject(failure));

    const error = yield* Effect.flip(client.get(ADDRESS));

    assert.equal(error._tag, "RequestError");
    assert.equal(error.reason, "Transport");
    assert.equal(error.cause, failure);
  }),
);

it.effect("a client over a fetch drops the content length the platform computes", () =>
  Effect.gen(function* () {
    const recording = recordingFetch(() => jsonResponse({}));
    const client = httpClientFromCloudFetch(recording.fetch);

    yield* client.execute(
      HttpClientRequest.get(ADDRESS, { headers: { "content-length": "17", accept: "text/plain" } }),
    );

    const request = recordedRequest(recording.requests);
    assert.equal(request.headers.get("content-length"), null);
    assert.equal(request.accept, "text/plain");
  }),
);

it.effect("the fake cloud API answers through the layer it offers of the client tag", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /v0/sessions": { answer: () => ({ sessions: ["session-1"] }) },
    });

    const body = yield* Effect.provide(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return yield* (yield* client.get(ADDRESS)).json;
      }),
      api.layer,
    );

    assert.deepEqual(body, { sessions: ["session-1"] });
    assert.deepEqual(recordedRoutes(api.requests()), ["GET /v0/sessions"]);
  }),
);

test("a fetch over a client carries the method, headers, and body it was given", async () => {
  const recording = recordingFetch(() => jsonResponse({ ok: true }));
  const fetch = cloudFetchFromHttpClient(httpClientFromCloudFetch(recording.fetch));

  await fetch(ADDRESS, {
    method: HTTP_METHOD.PUT,
    headers: { authorization: "Bearer key-2", "content-type": "application/json" },
    body: JSON.stringify({ name: "renamed" }),
  });

  const request = recordedRequest(recording.requests);
  assert.equal(request.method, HTTP_METHOD.PUT);
  assert.equal(request.authorization, "Bearer key-2");
  assert.equal(request.contentType, "application/json");
  assert.equal(request.body, JSON.stringify({ name: "renamed" }));
});

test("a fetch over a client with no method stated sends the one fetch would", async () => {
  const recording = recordingFetch(() => jsonResponse({}));
  const fetch = cloudFetchFromHttpClient(httpClientFromCloudFetch(recording.fetch));

  await fetch(ADDRESS, {});

  assert.equal(recordedRequest(recording.requests).method, HTTP_METHOD.GET);
});

test("a fetch over a client answers the status, headers, and body the client answered", async () => {
  const fetch = cloudFetchFromHttpClient(
    httpClientFromCloudFetch(() =>
      Promise.resolve(jsonResponse({ sessions: [] }, HTTP_STATUS.TOO_MANY_REQUESTS)),
    ),
  );

  const response = await fetch(ADDRESS, { method: HTTP_METHOD.GET });

  assert.equal(response.status, HTTP_STATUS.TOO_MANY_REQUESTS);
  assert.deepEqual(headerMap(response.headers), { "content-type": "application/json" });
  assert.deepEqual(await response.json(), { sessions: [] });
});

const NO_CONTENT = 204;

test("a fetch over a client answers a bodiless status with no body", async () => {
  const fetch = cloudFetchFromHttpClient(
    httpClientFromCloudFetch(() => Promise.resolve(new Response(null, { status: NO_CONTENT }))),
  );

  const response = await fetch(ADDRESS, { method: HTTP_METHOD.DELETE });

  assert.equal(response.status, NO_CONTENT);
  assert.equal(response.body, null);
});

test("a fetch over a client rejects with the client's own failure", async () => {
  const failure = new Error("socket closed");
  const fetch = cloudFetchFromHttpClient(httpClientFromCloudFetch(() => Promise.reject(failure)));

  const rejected = await fetch(ADDRESS, { method: HTTP_METHOD.GET }).then(
    () => undefined,
    (error: unknown) => error,
  );

  assert.equal(rejected instanceof HttpClientError.RequestError, true);
});

test("a fetch over a client rejects with the reason an aborted signal carried", async () => {
  const controller = new AbortController();
  const abortReason = new Error("the caller's deadline passed");
  const fetch = cloudFetchFromHttpClient(
    httpClientFromCloudFetch(
      () =>
        new Promise<Response>(() => {
          controller.abort(abortReason);
        }),
    ),
  );

  const rejected = await fetch(ADDRESS, {
    method: HTTP_METHOD.GET,
    signal: controller.signal,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );

  assert.equal(rejected, abortReason);
});

test("a fetch over a client refuses a method the client cannot carry", async () => {
  const fetch = cloudFetchFromHttpClient(
    httpClientFromCloudFetch(() => Promise.resolve(jsonResponse({}))),
  );

  const rejected = await fetch(ADDRESS, { method: "TRACE" }).then(
    () => undefined,
    (error: unknown) => error,
  );

  assert.equal(rejected instanceof Error, true);
});
