import assert from "node:assert/strict";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { HTTP_METHOD } from "../json.js";
import { fakeCloudApi, recordedRoutes } from "./cloud-fake.js";
import { fakeHttpClient } from "./http-client-fake.js";
import { HTTP_STATUS, jsonResponse, recordedRequest, recordingHttpClient } from "./http-fake.js";

const ADDRESS = "https://api.example.test/v0/sessions";

it.effect("a fake client carries the request's method, headers, and body", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse({ ok: true }));

    yield* Effect.provide(
      Effect.flatMap(HttpClient.HttpClient, (client) =>
        client.execute(
          HttpClientRequest.post(ADDRESS, {
            headers: { authorization: "Bearer key-1" },
            body: HttpBody.raw(JSON.stringify({ name: "renamed" }), {
              contentType: "application/json",
            }),
          }),
        ),
      ),
      recording.layer,
    );

    const request = recordedRequest(recording.requests);
    assert.equal(request.method, HTTP_METHOD.POST);
    assert.equal(request.pathname, "/v0/sessions");
    assert.equal(request.authorization, "Bearer key-1");
    assert.equal(request.contentType, "application/json");
    assert.equal(request.body, JSON.stringify({ name: "renamed" }));
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a fake client answers the status and body the responder answered", () =>
  Effect.gen(function* () {
    const client = fakeHttpClient(() =>
      Promise.resolve(jsonResponse({ sessions: ["session-1"] }, HTTP_STATUS.OK)),
    );

    const response = yield* client.get(ADDRESS);
    const body = yield* response.json;

    assert.equal(response.status, HTTP_STATUS.OK);
    assert.deepEqual(body, { sessions: ["session-1"] });
    assert.equal(response.headers["content-type"], "application/json");
  }),
);

it.effect("a fake client hands a refused status back rather than failing", () =>
  Effect.gen(function* () {
    const client = fakeHttpClient(() =>
      Promise.resolve(jsonResponse({}, HTTP_STATUS.UNAUTHORIZED)),
    );

    const response = yield* client.get(ADDRESS);

    assert.equal(response.status, HTTP_STATUS.UNAUTHORIZED);
  }),
);

it.effect("a rejected responder reaches the caller as a transport request error", () =>
  Effect.gen(function* () {
    const failure = new Error("socket closed");
    const client = fakeHttpClient(() => Promise.reject(failure));

    const error = yield* Effect.flip(client.get(ADDRESS));

    assert.equal(error._tag, "RequestError");
    assert.equal(error.reason, "Transport");
    assert.equal(error.cause, failure);
  }),
);

it.effect("a fake client drops the content length the platform computes", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse({}));

    yield* Effect.provide(
      Effect.flatMap(HttpClient.HttpClient, (client) =>
        client.execute(
          HttpClientRequest.get(ADDRESS, {
            headers: { "content-length": "17", accept: "text/plain" },
          }),
        ),
      ),
      recording.layer,
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
