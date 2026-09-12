import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { fakeHttpClient } from "../testing/http-client-fake.js";
import { HTTP_STATUS, jsonResponse } from "../testing/http-fake.js";
import { webResponseFromClientResponse } from "./http.js";

const ADDRESS = "https://api.example.test/v0/sessions";

const NO_CONTENT = 204;

function headerMap(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

it.effect("a web response carries the status, headers, and body the client answered", () =>
  Effect.gen(function* () {
    const client = fakeHttpClient(() =>
      Promise.resolve(jsonResponse({ sessions: [] }, HTTP_STATUS.TOO_MANY_REQUESTS)),
    );

    const response = yield* Effect.flatMap(client.get(ADDRESS), webResponseFromClientResponse);

    assert.equal(response.status, HTTP_STATUS.TOO_MANY_REQUESTS);
    assert.deepEqual(headerMap(response.headers), { "content-type": "application/json" });
    assert.deepEqual(yield* Effect.promise(() => response.json()), { sessions: [] });
  }),
);

it.effect("a web response of a bodiless status carries no body", () =>
  Effect.gen(function* () {
    const client = fakeHttpClient(() =>
      Promise.resolve(new Response(null, { status: NO_CONTENT })),
    );

    const response = yield* Effect.flatMap(client.get(ADDRESS), webResponseFromClientResponse);

    assert.equal(response.status, NO_CONTENT);
    assert.equal(response.body, null);
  }),
);
