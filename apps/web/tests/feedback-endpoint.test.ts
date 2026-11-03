import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { POST } from "../server/feedback.mjs";

/**
 * The public feedback endpoint, its mail service scripted at its HTTP
 * boundary: a note sent from an experiment's row is mailed under a subject
 * naming that experiment, an experiment that is not a key's shape is
 * refused before anything is mailed, and a delivered note is posted to the
 * team's Slack as typed where a webhook is set.
 *
 * A synthetic note and inbox throughout.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const SLACK_WEBHOOK = "https://hooks.slack.test/services/feedback";

/** The endpoint configured, its mail service and Slack answering every send and keeping what each was sent. */
function mailService() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FEEDBACK_TO", "founders@app.test");
  const mailed: { subject?: unknown }[] = [];
  const posted: { text?: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const sent = JSON.parse(String(init?.body));
    if (String(url) === SLACK_WEBHOOK) {
      posted.push(sent);
      return new Response("ok", { status: 200 });
    }
    mailed.push(sent);
    return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  });
  return { mailed, posted };
}

function note(body: {
  readonly experiment?: string;
  readonly message?: string;
  readonly name?: string;
  readonly email?: string;
}): Request {
  return new Request("https://app.test/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.7" },
    body: JSON.stringify({
      kind: "feedback",
      message: "The board missed a plan.",
      images: [],
      ...body,
    }),
  });
}

test("a note about an experiment is mailed under a subject naming it", async () => {
  const { mailed } = mailService();
  const answered = await POST(note({ experiment: "browser" }));

  assert.equal(answered.status, 200);
  assert.deepEqual(
    mailed.map((mail) => mail.subject),
    ["Feedback on the browser experiment"],
  );
});

test("an experiment that is not a key's shape is refused, and nothing is mailed", async () => {
  const { mailed } = mailService();
  const answered = await POST(note({ experiment: "Browser\nBcc: someone@example.test" }));

  assert.equal(answered.status, 400);
  assert.deepEqual(mailed, []);
});

test("a delivered note is posted to Slack as typed, its markup escaped", async () => {
  const { mailed, posted } = mailService();
  vi.stubEnv("FEEDBACK_SLACK_WEBHOOK_URL", SLACK_WEBHOOK);
  const answered = await POST(
    note({
      message: "Plans <!channel> vanish\n& come back",
      name: "Ada Example",
      email: "ada@example.test",
    }),
  );

  assert.equal(answered.status, 200);
  assert.equal(mailed.length, 1);
  assert.deepEqual(posted, [
    {
      text: [
        "*Feedback* · From: Ada Example — ada@example.test",
        "> Plans &lt;!channel&gt; vanish",
        "> &amp; come back",
      ].join("\n"),
    },
  ]);
});
