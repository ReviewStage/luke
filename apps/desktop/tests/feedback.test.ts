import assert from "node:assert/strict";
import test from "node:test";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIFECYCLE_EVENT,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  feedbackKindForLifecycleEvent,
  feedbackSubmission,
} from "../src/shared/feedback";

function image(overrides: Partial<FeedbackImage> = {}): FeedbackImage {
  return {
    name: "screenshot.png",
    mediaType: "image/png",
    // "hello" in standard base64, which is enough to be real bytes.
    base64: "aGVsbG8=",
    ...overrides,
  };
}

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: FEEDBACK_KIND.FEEDBACK,
    message: "The panel opened under my second display's dock.",
    images: [],
    ...overrides,
  };
}

test("a well-formed submission passes with its words trimmed", () => {
  const parsed = feedbackSubmission(
    submission({
      message: "  It works.  ",
      name: "  Dean  ",
      email: " dean@example.com ",
      images: [image()],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.message, "It works.");
  assert.equal(parsed.name, "Dean");
  assert.equal(parsed.email, "dean@example.com");
  assert.equal(parsed.images.length, 1);
});

test("credit left blank is absent rather than empty", () => {
  const parsed = feedbackSubmission(submission({ name: "   ", email: undefined }));

  assert.ok(parsed);
  assert.equal("name" in parsed, false);
  assert.equal("email" in parsed, false);
});

test("whitespace is not a message", () => {
  assert.equal(feedbackSubmission(submission({ message: "  \n\t " })), undefined);
});

test("a message longer than a document is refused", () => {
  const long = "a".repeat(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH + 1);
  assert.equal(feedbackSubmission(submission({ message: long })), undefined);
});

test("an unknown kind is a malformed request, not a default", () => {
  assert.equal(feedbackSubmission(submission({ kind: "praise" })), undefined);
  assert.equal(feedbackSubmission(submission({ kind: undefined })), undefined);
});

test("credit carrying a line break is refused, never stripped", () => {
  assert.equal(feedbackSubmission(submission({ name: "Dean\nBcc: else" })), undefined);
  assert.equal(feedbackSubmission(submission({ email: "a@b.c\r\nX: y" })), undefined);
});

test("more images than the cap is refused as a whole", () => {
  const images = Array.from({ length: FEEDBACK_LIMITS.MAX_IMAGES + 1 }, () => image());
  assert.equal(feedbackSubmission(submission({ images })), undefined);
});

test("an image outside the fixed formats is refused", () => {
  assert.equal(
    feedbackSubmission(submission({ images: [image({ mediaType: "image/svg+xml" })] })),
    undefined,
  );
});

test("an image whose bytes are not base64 is refused", () => {
  assert.equal(
    feedbackSubmission(submission({ images: [image({ base64: "not base64!!" })] })),
    undefined,
  );
});

test("an image past the byte cap is refused", () => {
  // Base64 grows bytes by a third, so this decodes to just over the cap.
  const oversized = "A".repeat(Math.ceil((FEEDBACK_LIMITS.IMAGE_MAX_BYTES + 3) / 3) * 4);
  assert.equal(
    feedbackSubmission(submission({ images: [image({ base64: oversized })] })),
    undefined,
  );
});

test("feedback lifecycle events name their kinds and nothing else answers", () => {
  assert.equal(
    feedbackKindForLifecycleEvent(FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.FEEDBACK]),
    FEEDBACK_KIND.FEEDBACK,
  );
  assert.equal(
    feedbackKindForLifecycleEvent(FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.PROMPT]),
    FEEDBACK_KIND.PROMPT,
  );
  assert.equal(feedbackKindForLifecycleEvent("tab:settings"), undefined);
});
