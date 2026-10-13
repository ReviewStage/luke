import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { forgetPosthogPersonEffect, type PosthogForgetOptions } from "../server/hosted/posthog.js";

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

function options(overrides: Partial<PosthogForgetOptions> = {}): PosthogForgetOptions {
  return { personalApiKey: PERSONAL_KEY, projectId: PROJECT_ID, ...overrides };
}

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
