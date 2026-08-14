import assert from "node:assert/strict";
import test from "node:test";
import {
  type FeedbackEntry,
  feedbackImageUrl,
  freshFeedbackEntry,
  isSendable,
} from "../src/renderer/feedback-entry";
import { IMAGE_INTAKE, imageIntake, recodedImageName } from "../src/renderer/feedback-images";
import { FEEDBACK_KIND, FEEDBACK_LIMITS } from "../src/shared/feedback";

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return { ...freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK, true), ...overrides };
}

test("whitespace is not a note", () => {
  assert.equal(isSendable(entry()), false);
  assert.equal(isSendable(entry({ message: "  \n " })), false);
  assert.equal(isSendable(entry({ message: " it broke " })), true);
});

test("a note already in flight is not sent a second time", () => {
  assert.equal(isSendable(entry({ message: "it broke", busy: true })), false);
});

test("nothing being written cannot be sent", () => {
  assert.equal(isSendable(undefined), false);
});

test("a small screenshot in a native format rides untouched", () => {
  assert.equal(imageIntake({ type: "image/png", size: 200_000 }), IMAGE_INTAKE.KEEP);
  assert.equal(imageIntake({ type: "image/webp", size: 1 }), IMAGE_INTAKE.KEEP);
});

test("a screenshot past the byte cap is re-encoded rather than refused", () => {
  assert.equal(
    imageIntake({ type: "image/png", size: FEEDBACK_LIMITS.IMAGE_MAX_BYTES + 1 }),
    IMAGE_INTAKE.RECODE,
  );
});

test("any other image the platform can decode is re-encoded", () => {
  assert.equal(imageIntake({ type: "image/heic", size: 10 }), IMAGE_INTAKE.RECODE);
  assert.equal(imageIntake({ type: "image/gif", size: 10 }), IMAGE_INTAKE.RECODE);
});

test("a file that is not an image cannot come", () => {
  assert.equal(imageIntake({ type: "application/pdf", size: 10 }), IMAGE_INTAKE.REFUSE);
  assert.equal(imageIntake({ type: "", size: 10 }), IMAGE_INTAKE.REFUSE);
});

test("a re-encoded file stops promising its old format", () => {
  assert.equal(recodedImageName("Screenshot 2026-08-14.png"), "Screenshot 2026-08-14.webp");
  assert.equal(recodedImageName("photo"), "photo.webp");
  assert.equal(recodedImageName(".png"), "screenshot.webp");
});

test("a chip draws the image it holds", () => {
  assert.equal(
    feedbackImageUrl({ name: "shot.png", mediaType: "image/png", base64: "aGVsbG8=" }),
    "data:image/png;base64,aGVsbG8=",
  );
});
