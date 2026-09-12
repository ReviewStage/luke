import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import {
  forgetPosthogPersonEffect,
  POSTHOG_DEFAULTS,
  type PosthogForgetOptions,
} from "../server/hosted/posthog.js";

const PERSONAL_KEY = "phx_personal";
const PROJECT_ID = "12345";

interface Sent {
  url: string;
  init: RequestInit;
}

function upstream(status = 200) {
  const sent: Sent[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    sent.push({ url, init });
    return new Response("{}", { status });
  });
  return { layer, sent };
}

function onlySent(sent: readonly Sent[]): Sent {
  assert.equal(sent.length, 1);
  const request = sent[0];
  assert.ok(request);
  return request;
}

function options(overrides: Partial<PosthogForgetOptions> = {}): PosthogForgetOptions {
  return { personalApiKey: PERSONAL_KEY, projectId: PROJECT_ID, ...overrides };
}

it.effect("erasure asks the documented bulk delete for the one person and their events", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    yield* forgetPosthogPersonEffect("user-1", options()).pipe(Effect.provide(posthog.layer));

    const { url, init } = onlySent(posthog.sent);
    assert.equal(
      url,
      `${POSTHOG_DEFAULTS.API_HOST}/api/projects/${PROJECT_ID}/persons/bulk_delete/?delete_events=true`,
    );
    assert.equal(init.method, "POST");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${PERSONAL_KEY}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init.body)), { distinct_ids: ["user-1"] });
  }),
);

it.effect("a configured private API host is used as given, without its trailing slash", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    yield* forgetPosthogPersonEffect("user-1", options({ host: "https://eu.posthog.com/" })).pipe(
      Effect.provide(posthog.layer),
    );

    const { url } = onlySent(posthog.sent);
    assert.equal(
      url,
      `https://eu.posthog.com/api/projects/${PROJECT_ID}/persons/bulk_delete/?delete_events=true`,
    );
  }),
);

it.effect("a refusal fails with the status alone, never anything that could name the key", () =>
  Effect.gen(function* () {
    const posthog = upstream(401);
    const error = yield* forgetPosthogPersonEffect("user-1", options()).pipe(
      Effect.provide(posthog.layer),
      Effect.flip,
    );

    assert.match(error.message, /refused with status 401/);
  }),
);

it.effect("a network fault reaches the caller, which owns deciding the delete proceeds", () =>
  Effect.gen(function* () {
    const error = yield* forgetPosthogPersonEffect("user-1", options()).pipe(
      Effect.provide(
        fakeHttpClientLayer(async () => {
          throw new Error("processor unreachable");
        }),
      ),
      Effect.flip,
    );

    assert.match(error.message, /network fault/);
  }),
);
