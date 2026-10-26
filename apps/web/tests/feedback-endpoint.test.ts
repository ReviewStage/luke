import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { POST } from "../server/feedback.mjs";

/**
 * The public feedback endpoint, its mail service scripted at its HTTP
 * boundary: a note sent from an experiment's row is mailed under a subject
 * naming that experiment, and an experiment that is not a key's shape is
 * refused before anything is mailed.
 *
 * A synthetic note and inbox throughout.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The endpoint configured, its mail service answering every send and keeping what it was sent. */
function mailService() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FEEDBACK_TO", "founders@luke.test");
  const mailed: { subject?: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    mailed.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  });
  return { mailed };
}

function note(body: { readonly experiment: string }): Request {
  return new Request("https://luke.test/api/feedback", {
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
    ["Luke feedback on the browser experiment"],
  );
});

test("an experiment that is not a key's shape is refused, and nothing is mailed", async () => {
  const { mailed } = mailService();
  const answered = await POST(note({ experiment: "Browser\nBcc: someone@example.test" }));

  assert.equal(answered.status, 400);
  assert.deepEqual(mailed, []);
});
