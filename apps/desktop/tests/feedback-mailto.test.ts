import assert from "node:assert/strict";
import test from "node:test";
import {
  FEEDBACK_MAIL,
  FEEDBACK_MAIL_REFUSAL,
  feedbackMailBody,
  feedbackMailtoUrl,
  isFeedbackMailtoUrl,
  openFeedbackMail,
} from "../src/feedback-mailto";
import { FEEDBACK_KIND, type FeedbackSubmission, feedbackSubmission } from "../src/shared/feedback";

const SUBMISSION: FeedbackSubmission = {
  kind: FEEDBACK_KIND.FEEDBACK,
  message: "The capsule count lagged a session behind.",
  name: "Dean",
  imageNames: [],
};

test("the draft is addressed to the founders with the exact feedback subject", () => {
  const url = feedbackMailtoUrl(SUBMISSION);
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "mailto:");
  assert.equal(parsed.pathname, "founders@stagereview.app");
  assert.equal(parsed.pathname, FEEDBACK_MAIL.RECIPIENT);
  assert.equal(parsed.searchParams.get("subject"), "Luke feedback");
  assert.equal(parsed.searchParams.get("subject"), FEEDBACK_MAIL.SUBJECT[FEEDBACK_KIND.FEEDBACK]);
  assert.equal(isFeedbackMailtoUrl(url), true);
});

test("a prompt draft keeps the prompt subject", () => {
  const url = feedbackMailtoUrl({
    ...SUBMISSION,
    kind: FEEDBACK_KIND.PROMPT,
    message: "let Luke restart a stuck run",
  });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, FEEDBACK_MAIL.RECIPIENT);
  assert.equal(parsed.searchParams.get("subject"), "Luke prompt");
  assert.equal(isFeedbackMailtoUrl(url), true);
});

test("subject and body are percent-encoded, including reserved characters", () => {
  const url = feedbackMailtoUrl({
    kind: FEEDBACK_KIND.FEEDBACK,
    message: "Line 1\nwhat about ?&=#",
    imageNames: [],
  });
  const parsed = new URL(url);

  assert.match(url, /subject=Luke%20feedback/);
  assert.match(url, /body=Line%201%0Awhat%20about%20%3F%26%3D%23$/);
  assert.equal(parsed.searchParams.get("body"), "Line 1\nwhat about ?&=#");
});

test("picked screenshots are named in the body, never attached as bytes", () => {
  const submission: FeedbackSubmission = {
    ...SUBMISSION,
    imageNames: ["Screenshot 2026-08-14.png", "panel.webp"],
  };
  const body = feedbackMailBody(submission);
  const url = feedbackMailtoUrl(submission);

  assert.match(body, /Please attach these screenshots in your email client/);
  assert.match(body, /- Screenshot 2026-08-14\.png/);
  assert.match(body, /- panel\.webp/);
  assert.doesNotMatch(url, /base64/i);
  assert.doesNotMatch(url, /image\/png/);
  assert.equal(new URL(url).searchParams.get("body"), body);
});

test("opening mail calls openExternal with the mailto URL and never posts anywhere", async () => {
  const opened: string[] = [];
  const fetchCalls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown) => {
    fetchCalls.push(input);
    return Promise.reject(new Error("network delivery is gone"));
  }) as typeof fetch;

  try {
    const result = await openFeedbackMail(SUBMISSION, async (url) => {
      opened.push(url);
    });

    assert.deepEqual(result, { delivered: true });
    assert.equal(opened.length, 1);
    assert.equal(isFeedbackMailtoUrl(opened[0] ?? ""), true);
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a mail client that will not open comes back as a reason that names the address", async () => {
  const result = await openFeedbackMail(SUBMISSION, () =>
    Promise.reject(new Error("no handler for mailto")),
  );

  assert.equal(result.delivered, false);
  assert.equal(result.reason, FEEDBACK_MAIL_REFUSAL.UNOPENED);
  assert.match(result.reason ?? "", /founders@stagereview\.app/);
});

test("a URL that is not this build's mailto is refused before openExternal", () => {
  assert.equal(isFeedbackMailtoUrl("https://tryluke.dev/api/feedback"), false);
  assert.equal(
    isFeedbackMailtoUrl("mailto:else@example.test?subject=Luke%20feedback&body=hi"),
    false,
  );
  assert.equal(isFeedbackMailtoUrl("mailto:founders@stagereview.app?subject=Other&body=hi"), false);
  assert.equal(isFeedbackMailtoUrl("not a url"), false);
});

test("IPC validation: a parsed submission is what opens mail, never a renderer URL", async () => {
  const opened: string[] = [];
  const parsed = feedbackSubmission({
    kind: FEEDBACK_KIND.FEEDBACK,
    message: "The panel opened under my second display's dock.",
    imageNames: [],
    url: "https://tryluke.dev/api/feedback",
  });
  assert.ok(parsed);

  const result = await openFeedbackMail(parsed, async (url) => {
    opened.push(url);
  });

  assert.equal(result.delivered, true);
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0] ?? "").pathname, FEEDBACK_MAIL.RECIPIENT);
  assert.equal(new URL(opened[0] ?? "").searchParams.get("subject"), "Luke feedback");
});
