import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { POST } from "../server/feedback.mjs";

/**
 * The public feedback endpoint, its mail service scripted at its HTTP
 * boundary: a note sent from an experiment's row is mailed under a subject
 * naming that experiment, an experiment that is not a key's shape is
 * refused before anything is mailed, and a delivered note is recorded as a
 * response to the feedback survey where the deployment holds a PostHog key.
 *
 * A synthetic note and inbox throughout.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const POSTHOG_HOST = "https://posthog.app.test";

/** The endpoint configured, its mail service and PostHog answering every send and keeping what each was sent. */
function mailService() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FEEDBACK_TO", "founders@app.test");
  const mailed: { subject?: unknown }[] = [];
  const recorded: { url: string; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).startsWith(POSTHOG_HOST)) {
      recorded.push({ url: String(url), body: String(init?.body) });
      return new Response("{}", { status: 200 });
    }
    mailed.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  });
  return { mailed, recorded };
}

function note(body: {
  readonly experiment?: string;
  readonly name?: string;
  readonly email?: string;
  readonly images?: readonly { name: string; mediaType: string; base64: string }[];
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

test("a delivered note is recorded as a feedback survey response, its screenshots left out", async () => {
  const { mailed, recorded } = mailService();
  vi.stubEnv("POSTHOG_PROJECT_API_KEY", "phc_test");
  vi.stubEnv("POSTHOG_HOST", POSTHOG_HOST);
  vi.stubEnv("VERCEL_ENV", "production");
  // The smallest PNG signature the endpoint accepts as a screenshot.
  const screenshot = { name: "board.png", mediaType: "image/png", base64: "iVBORw0KGgo=" };
  const answered = await POST(
    note({ name: "Ada Example", email: "ada@example.test", images: [screenshot] }),
  );

  assert.equal(answered.status, 200);
  assert.equal(mailed.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.url, "https://posthog.app.test/i/v0/e/");
  assert.ok(!recorded[0]?.body.includes(screenshot.base64));
  const response = JSON.parse(recorded[0]?.body ?? "{}");
  assert.equal(response.event, "survey sent");
  assert.equal(response.api_key, "phc_test");
  assert.match(response.distinct_id, /^feedback-/);
  assert.deepEqual(
    {
      survey: response.properties.$survey_id,
      answer: response.properties["$survey_response_27a12623-8bc1-494c-a0b3-58bc910437ac"],
      name: response.properties.feedback_name,
      email: response.properties.feedback_email,
      screenshots: response.properties.feedback_screenshot_count,
      environment: response.properties.environment,
      person: response.properties.$process_person_profile,
    },
    {
      survey: "01a1a39c-6e8f-0000-b2a9-1c94c0673240",
      answer: "The board missed a plan.",
      name: "Ada Example",
      email: "ada@example.test",
      screenshots: 1,
      environment: "production",
      person: false,
    },
  );
});
