import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { FEEDBACK_KIND } from "@sidecar/feedback";
import { test } from "vitest";
import {
  accountSignature,
  type FeedbackEntry,
  feedbackImageUrl,
  freshFeedbackEntry,
  isSendable,
  openedFeedbackEntry,
} from "./feedback-entry";

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return { ...freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK), ...overrides };
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

test("opening with nothing there starts a fresh note of the asked kind", () => {
  assert.deepEqual(
    openedFeedbackEntry(undefined, { kind: FEEDBACK_KIND.PROMPT }),
    freshFeedbackEntry(FEEDBACK_KIND.PROMPT),
  );
});

test("a half-written note is brought back as its author left it", () => {
  const current = entry({ message: "the plan lost a question", name: "Ada" });
  // The words, the signature, and even the kind stay.
  assert.deepEqual(openedFeedbackEntry(current, { kind: FEEDBACK_KIND.PROMPT }), current);
});

test("an empty note is relabelled to the asked kind", () => {
  const opened = openedFeedbackEntry(entry({ message: "  " }), { kind: FEEDBACK_KIND.PROMPT });
  assert.equal(opened?.kind, FEEDBACK_KIND.PROMPT);
});

test("a note mid-send is not touched by an open", () => {
  assert.equal(
    openedFeedbackEntry(entry({ message: "it broke", busy: true }), { kind: FEEDBACK_KIND.PROMPT }),
    undefined,
  );
});

test("a signed-in account signs a fresh note; signed out, it starts unsigned", () => {
  const signature = accountSignature({
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "ada@example.com",
    name: "Ada",
    provider: ACCOUNT_PROVIDER.GITHUB,
  });
  assert.deepEqual(signature, { name: "Ada", email: "ada@example.com" });
  assert.deepEqual(freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK, signature), {
    ...freshFeedbackEntry(FEEDBACK_KIND.FEEDBACK),
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
    signature: { name: "Ada", email: "ada@example.com" },
  });

  assert.equal(opened?.name, "Ada");
  assert.equal(opened?.email, "ada@example.com");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a note already there keeps its fields as its author left them, cleared ones included", () => {
  const cleared = entry({ message: "the plan lost a question", name: "", email: "" });
  const opened = openedFeedbackEntry(cleared, {
    kind: FEEDBACK_KIND.FEEDBACK,
    signature: { name: "Ada", email: "ada@example.com" },
  });

  assert.equal(opened?.name, "");
  assert.equal(opened?.email, "");
});

test("a chip draws the image it holds", () => {
  assert.equal(
    feedbackImageUrl({ name: "shot.png", mediaType: "image/png", base64: "aGVsbG8=" }),
    "data:image/png;base64,aGVsbG8=",
  );
});
