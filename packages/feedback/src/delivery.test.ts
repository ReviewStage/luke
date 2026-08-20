import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackDelivery } from "./delivery.js";
import { FEEDBACK_KIND, type FeedbackSubmission } from "./submission.js";

const SUBMISSION: FeedbackSubmission = {
  kind: FEEDBACK_KIND.FEEDBACK,
  message: "The capsule count lagged a session behind.",
  name: "Dean",
  images: [],
};

test("a landed send answers delivered, and the submission travels whole", async () => {
  const requests: { input: string; body: string }[] = [];
  const delivery = new FeedbackDelivery({
    url: "https://example.test/api/feedback",
    fetch: (input, init) => {
      requests.push({ input, body: String(init.body) });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  const result = await delivery.deliver(SUBMISSION);

  assert.deepEqual(result, { delivered: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "https://example.test/api/feedback");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), SUBMISSION);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a refusing endpoint comes back as a reason, not a throw", async () => {
  const delivery = new FeedbackDelivery({
    fetch: () => Promise.resolve(new Response("", { status: 503 })),
  });

  const result = await delivery.deliver(SUBMISSION);

  assert.equal(result.delivered, false);
  assert.ok(result.reason);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an unreachable endpoint comes back as a reason, not a throw", async () => {
  const delivery = new FeedbackDelivery({
    fetch: () => Promise.reject(new Error("connection refused")),
  });

  const result = await delivery.deliver(SUBMISSION);

  assert.equal(result.delivered, false);
  assert.ok(result.reason);
});
