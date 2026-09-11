import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_METHOD } from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { fakeCloudApi, jsonResponse, recordedRequest, recordingFetch } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { test } from "vitest";
import { feedbackDelivery, feedbackDeliveryFromEnvironment } from "./delivery.js";
import { FEEDBACK_KIND, type FeedbackSubmission } from "./submission.js";

const URL = "https://example.test/api/feedback";
const PATH = "/api/feedback";

const SUBMISSION: FeedbackSubmission = {
  kind: FEEDBACK_KIND.FEEDBACK,
  message: "The capsule count lagged a session behind.",
  name: "Dean",
  images: [],
};

it.effect("a landed send answers delivered, and the submission travels whole", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`${HTTP_METHOD.POST} ${PATH}`]: { answer: () => ({}) } });
    const delivery = feedbackDelivery({ url: URL });

    const result = yield* Effect.provide(delivery.deliver(SUBMISSION), api.layer);

    assert.deepEqual(result, { delivered: true });
    const request = recordedRequest(api.requests());
    assert.equal(request.url, URL);
    assert.equal(request.method, HTTP_METHOD.POST);
    assert.equal(request.contentType, "application/json");
    assert.deepEqual(JSON.parse(request.body ?? ""), SUBMISSION);
  }),
);

it.effect("a refusing endpoint comes back as a reason, not a failure", () =>
  Effect.gen(function* () {
    const recording = recordingFetch(() => jsonResponse({}, 503));
    const delivery = feedbackDelivery({ url: URL });

    const result = yield* Effect.provide(
      delivery.deliver(SUBMISSION),
      layerFromCloudFetch(recording.fetch),
    );

    assert.equal(result.delivered, false);
    assert.ok(result.reason);
  }),
);

it.effect("an unreachable endpoint comes back as a reason, not a failure", () =>
  Effect.gen(function* () {
    const recording = recordingFetch(() => Promise.reject(new Error("connection refused")));
    const delivery = feedbackDelivery({ url: URL });

    const result = yield* Effect.provide(
      delivery.deliver(SUBMISSION),
      layerFromCloudFetch(recording.fetch),
    );

    assert.equal(result.delivered, false);
    assert.ok(result.reason);
  }),
);

test("the promise face carries a submission over the caller's own fetch", async () => {
  const requests: { input: string; body: string }[] = [];
  const courier = feedbackDeliveryFromEnvironment({
    url: URL,
    fetch: (input, init) => {
      requests.push({ input, body: String(init.body) });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  const result = await courier.deliver(SUBMISSION);

  assert.deepEqual(result, { delivered: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, URL);
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), SUBMISSION);
});
