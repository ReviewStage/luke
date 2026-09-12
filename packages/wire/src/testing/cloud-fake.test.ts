import assert from "node:assert/strict";
import * as HttpBody from "@effect/platform/HttpBody";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import type * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { type FakeCloudApi, fakeCloudApi, recordedRoutes } from "./cloud-fake.js";
import { HTTP_STATUS } from "./http-fake.js";

const API_KEY = "fake-api-key";

const CREATED = 201;

function send(
  api: FakeCloudApi,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, unknown> {
  return Effect.provide(
    Effect.flatMap(HttpClient.HttpClient, (client) => client.execute(request)),
    api.layer,
  );
}

function get(url: string, apiKey = API_KEY): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.get(url, { headers: { Authorization: `Bearer ${apiKey}` } });
}

it.effect("answers a routed read and records what was asked", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /v0/sessions": { answer: () => ({ data: [{ id: "session-1" }] }) },
    });

    const response = yield* send(api, get("https://api.test/v0/sessions?limit=20"));

    assert.equal(response.status, HTTP_STATUS.OK);
    assert.deepEqual(yield* response.json, { data: [{ id: "session-1" }] });
    assert.deepEqual(recordedRoutes(api.requests()), ["GET /v0/sessions?limit=20"]);
    assert.deepEqual(api.credentials(), [API_KEY]);
  }),
);

it.effect("fails for a request no route names, rather than answering nothing", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });

    const error = yield* Effect.flip(send(api, get("https://api.test/v0/undocumented")));

    assert.equal(error instanceof Error, true);
  }),
);

it.effect("keys a write apart from the read on the same path", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });

    const error = yield* Effect.flip(
      send(
        api,
        HttpClientRequest.post("https://api.test/v0/sessions", { body: HttpBody.raw("{}") }),
      ),
    );

    assert.equal(error instanceof Error, true);
    assert.deepEqual(recordedRoutes(api.requests()), ["POST /v0/sessions"]);
  }),
);

it.effect("hands a write route its own request, and reads the body back", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /v0/sessions/session-1/messages": {
        answer: (request) => JSON.parse(request.body ?? "{}"),
        status: CREATED,
      },
    });

    const response = yield* send(
      api,
      HttpClientRequest.post("https://api.test/v0/sessions/session-1/messages", {
        body: HttpBody.raw(JSON.stringify({ message: "ship it" })),
      }),
    );

    assert.equal(response.status, CREATED);
    assert.deepEqual(yield* response.json, { message: "ship it" });
  }),
);

it.effect("fails and heals every route at once", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });
    const request = get("https://api.test/v0/sessions");

    api.fail();
    const failed = yield* send(api, request);
    api.fail(HTTP_STATUS.UNAUTHORIZED);
    const refused = yield* send(api, request);
    api.heal();
    const healed = yield* send(api, request);

    assert.equal(failed.status, HTTP_STATUS.SERVER_ERROR);
    assert.equal(refused.status, HTTP_STATUS.UNAUTHORIZED);
    assert.equal(healed.status, HTTP_STATUS.OK);
  }),
);
