import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect } from "effect";
import { forgetPosthogPersonEffect, type PosthogForgetOptions } from "./posthog.js";

const PERSONAL_KEY = "phx_personal";
const PROJECT_ID = "12345";

/** A queued erasure, as PostHog's bulk delete answers one it took. */
const QUEUED = {
  persons_found: 1,
  persons_deleted: 0,
  persons_queued_for_deletion: 1,
  events_queued_for_deletion: true,
  recordings_queued_for_deletion: true,
  deletion_errors: [],
};

interface Sent {
  url: string;
  init: RequestInit;
}

function upstream(status = 202, body: string = JSON.stringify(QUEUED)) {
  const sent: Sent[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    sent.push({ url, init });
    return new Response(body, { status });
  });
  return { layer, sent };
}

function options(overrides: Partial<PosthogForgetOptions> = {}): PosthogForgetOptions {
  return { personalApiKey: PERSONAL_KEY, projectId: PROJECT_ID, ...overrides };
}

it.effect("asks PostHog in the body to erase the person's events and recordings", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    yield* forgetPosthogPersonEffect("user-1", options()).pipe(Effect.provide(posthog.layer));

    assert.equal(posthog.sent.length, 1);
    const [request] = posthog.sent;
    assert.equal(
      request?.url,
      `https://us.posthog.com/api/projects/${PROJECT_ID}/persons/bulk_delete/`,
    );
    assert.equal(request?.init.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.init.body)), {
      distinct_ids: ["user-1"],
      delete_events: true,
      delete_recordings: true,
    });
  }),
);

it.effect("an answer that queued no person settles, since PostHog holds none to erase", () =>
  Effect.gen(function* () {
    const posthog = upstream(
      202,
      JSON.stringify({
        ...QUEUED,
        persons_found: 0,
        persons_queued_for_deletion: 0,
        events_queued_for_deletion: false,
        recordings_queued_for_deletion: false,
      }),
    );
    yield* forgetPosthogPersonEffect("user-1", options()).pipe(Effect.provide(posthog.layer));
  }),
);

it.effect("a 202 naming deletion errors fails without quoting the body", () =>
  Effect.gen(function* () {
    const posthog = upstream(
      202,
      JSON.stringify({
        ...QUEUED,
        persons_queued_for_deletion: 0,
        deletion_errors: [{ person_uuid: "person-uuid-1", step: "delete_person" }],
      }),
    );
    const error = yield* forgetPosthogPersonEffect("user-1", options()).pipe(
      Effect.provide(posthog.layer),
      Effect.flip,
    );

    assert.equal(error._tag, "PosthogForgetError");
    assert.match(error.message, /1 deletion error/);
    assert.doesNotMatch(error.message, /person-uuid-1|delete_person/);
  }),
);

it.effect("a success whose body cannot be read fails with the status alone", () =>
  Effect.gen(function* () {
    const posthog = upstream(202, `not json ${PERSONAL_KEY}`);
    const error = yield* forgetPosthogPersonEffect("user-1", options()).pipe(
      Effect.provide(posthog.layer),
      Effect.flip,
    );

    assert.match(error.message, /unreadable answer with status 202/);
    assert.doesNotMatch(error.message, new RegExp(PERSONAL_KEY));
  }),
);

it.effect("a refusal fails with the status alone, never anything that could name the key", () =>
  Effect.gen(function* () {
    const posthog = upstream(401, JSON.stringify({ detail: `bad key ${PERSONAL_KEY}` }));
    const error = yield* forgetPosthogPersonEffect("user-1", options()).pipe(
      Effect.provide(posthog.layer),
      Effect.flip,
    );

    assert.match(error.message, /refused with status 401/);
    assert.doesNotMatch(error.message, new RegExp(PERSONAL_KEY));
  }),
);
