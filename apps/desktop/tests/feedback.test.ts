import assert from "node:assert/strict";
import test from "node:test";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIFECYCLE_EVENT,
  FEEDBACK_LIMITS,
  feedbackKindForLifecycleEvent,
  feedbackSubmission,
} from "../src/shared/feedback";

function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: FEEDBACK_KIND.FEEDBACK,
    message: "The panel opened under my second display's dock.",
    imageNames: [],
    ...overrides,
  };
}

test("a well-formed submission passes with its words trimmed", () => {
  const parsed = feedbackSubmission(
    submission({
      message: "  It works.  ",
      name: "  Dean  ",
      email: " dean@example.com ",
      imageNames: ["screenshot.png"],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.message, "It works.");
  assert.equal(parsed.name, "Dean");
  assert.equal(parsed.email, "dean@example.com");
  assert.deepEqual(parsed.imageNames, ["screenshot.png"]);
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

test("more image names than the cap is refused as a whole", () => {
  const imageNames = Array.from(
    { length: FEEDBACK_LIMITS.MAX_IMAGES + 1 },
    (_, index) => `shot-${String(index)}.png`,
  );
  assert.equal(feedbackSubmission(submission({ imageNames })), undefined);
});

test("an image name with a line break is refused, never stripped", () => {
  assert.equal(feedbackSubmission(submission({ imageNames: ["shot\n.png"] })), undefined);
});

test("a payload that still carries image bytes is malformed", () => {
  // The old network delivery took base64 screenshots. Mailto cannot attach
  // them, and a renderer that still posts bytes is a broken client, not a
  // submission — imageNames is required, and extra `images` are ignored.
  assert.equal(
    feedbackSubmission({
      kind: FEEDBACK_KIND.FEEDBACK,
      message: "It broke.",
      images: [{ name: "shot.png", mediaType: "image/png", base64: "aGVsbG8=" }],
    }),
    undefined,
  );
});

test("a URL handed over as the IPC payload is a malformed request, not a mailto to open", () => {
  assert.equal(
    feedbackSubmission("mailto:founders@stagereview.app?subject=Luke%20feedback&body=hi"),
    undefined,
  );
  assert.equal(feedbackSubmission("https://tryluke.dev/api/feedback"), undefined);
});

test("a URL in the payload is ignored; the mailbox is not taken from the renderer", () => {
  const parsed = feedbackSubmission(
    submission({ url: "https://example.test/steal", mailto: "mailto:else@example.test" }),
  );
  assert.ok(parsed);
  assert.equal("url" in parsed, false);
  assert.equal("mailto" in parsed, false);
});

test("the tray's lifecycle events name their kinds and nothing else answers", () => {
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
