import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackDelivery } from "../src/feedback-delivery";
import { FEEDBACK_KIND, type FeedbackSubmission } from "../src/shared/feedback";
import { runWithHttp } from "./support/effect-http";
import { recordingFetch } from "./support/http-fake";

const SUBMISSION: FeedbackSubmission = {
  kind: FEEDBACK_KIND.FEEDBACK,
  message: "The capsule count lagged a session behind.",
  name: "Dean",
  images: [],
};

test("a landed send answers delivered, and the submission travels whole", async () => {
  const { fetch, requests } = recordingFetch(() => new Response("{}", { status: 200 }));
  const delivery = new FeedbackDelivery({
    url: "https://example.test/api/feedback",
  });

  const result = await runWithHttp(delivery.deliver(SUBMISSION), fetch);

  assert.deepEqual(result, { delivered: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://example.test/api/feedback");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), SUBMISSION);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a refusing endpoint comes back as a reason, not a throw", async () => {
  const { fetch } = recordingFetch(() => new Response("", { status: 503 }));
  const delivery = new FeedbackDelivery();

  const result = await runWithHttp(delivery.deliver(SUBMISSION), fetch);

  assert.equal(result.delivered, false);
  assert.ok(result.reason);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an unreachable endpoint comes back as a reason, not a throw", async () => {
  const delivery = new FeedbackDelivery();
  const fetch = () => Promise.reject(new Error("connection refused"));

  const result = await runWithHttp(delivery.deliver(SUBMISSION), fetch as typeof globalThis.fetch);

  assert.equal(result.delivered, false);
  assert.ok(result.reason);
});
