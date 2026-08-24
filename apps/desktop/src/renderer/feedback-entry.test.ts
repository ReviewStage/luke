import assert from "node:assert/strict";
import test from "node:test";
import { FEEDBACK_KIND, FEEDBACK_LIMITS } from "@sidecar/feedback";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "#shared/wire/account";
import {
  accountSignature,
  type FeedbackEntry,
  feedbackImageUrl,
  freshFeedbackEntry,
  isSendable,
  openedFeedbackEntry,
} from "./feedback-entry";
import { IMAGE_INTAKE, imageIntake, recodedImageName } from "./feedback-images";

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

test("opening with nothing there starts a fresh note, drafted with what was given", () => {
  const opened = openedFeedbackEntry(undefined, {
    kind: FEEDBACK_KIND.PROMPT,
    fromPanel: false,
    draft: "let Luke restart a stuck run",
  });

  assert.equal(opened.drafted, true);
  assert.deepEqual(opened.entry, {
    ...freshFeedbackEntry(FEEDBACK_KIND.PROMPT, false),
    message: "let Luke restart a stuck run",
  });

  const undrafted = openedFeedbackEntry(undefined, {
    kind: FEEDBACK_KIND.FEEDBACK,
    fromPanel: true,
  });
  assert.equal(undrafted.drafted, false);
  assert.deepEqual(undrafted.entry, freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK, true));
});

test("a half-written note is brought back, never overwritten by a draft", () => {
  const current = entry({ message: "the capsule count is wrong", name: "Ada" });
  const opened = openedFeedbackEntry(current, {
    kind: FEEDBACK_KIND.PROMPT,
    fromPanel: false,
    draft: "let Luke restart a stuck run",
  });

  assert.equal(opened.drafted, false);
  // The words, the signature, and even the kind stay: only where leaving
  // returns you follows the latest ask.
  assert.deepEqual(opened.entry, { ...current, fromPanel: false });
});

test("an empty note is relabelled to the asked kind and takes the draft", () => {
  const opened = openedFeedbackEntry(entry({ message: "  " }), {
    kind: FEEDBACK_KIND.PROMPT,
    fromPanel: false,
    draft: "let Luke restart a stuck run",
  });

  assert.equal(opened.drafted, true);
  assert.equal(opened.entry?.kind, FEEDBACK_KIND.PROMPT);
  assert.equal(opened.entry?.message, "let Luke restart a stuck run");
});

test("a note mid-send is not touched by an open", () => {
  const opened = openedFeedbackEntry(entry({ message: "it broke", busy: true }), {
    kind: FEEDBACK_KIND.PROMPT,
    fromPanel: false,
    draft: "something else",
  });

  assert.equal(opened.drafted, false);
  assert.equal(opened.entry, undefined);
});

test("a signed-in account signs a fresh note; signed out, it starts unsigned", () => {
  const signature = accountSignature({
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "ada@example.com",
    name: "Ada",
    provider: ACCOUNT_PROVIDER.GITHUB,
  });
  assert.deepEqual(signature, { name: "Ada", email: "ada@example.com" });
  assert.deepEqual(freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK, true, signature), {
    ...freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK, true),
    name: "Ada",
    email: "ada@example.com",
  });

  // An account without a name still signs with its address.
  assert.deepEqual(
    accountSignature({
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "ada@example.com",
      provider: ACCOUNT_PROVIDER.GOOGLE,
    }),
    { email: "ada@example.com" },
  );

  assert.equal(accountSignature(undefined), undefined);
  assert.equal(accountSignature({ status: ACCOUNT_STATUS.SIGNED_OUT }), undefined);
  assert.equal(accountSignature({ status: ACCOUNT_STATUS.SIGNING_IN }), undefined);
});

test("opening with nothing there starts the note signed with the account", () => {
  const opened = openedFeedbackEntry(undefined, {
    kind: FEEDBACK_KIND.FEEDBACK,
    fromPanel: true,
    signature: { name: "Ada", email: "ada@example.com" },
  });

  assert.equal(opened.entry?.name, "Ada");
  assert.equal(opened.entry?.email, "ada@example.com");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a note already there keeps its fields as its author left them, cleared ones included", () => {
  const cleared = entry({ message: "the capsule count is wrong", name: "", email: "" });
  const opened = openedFeedbackEntry(cleared, {
    kind: FEEDBACK_KIND.FEEDBACK,
    fromPanel: true,
    signature: { name: "Ada", email: "ada@example.com" },
  });

  assert.equal(opened.entry?.name, "");
  assert.equal(opened.entry?.email, "");
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
