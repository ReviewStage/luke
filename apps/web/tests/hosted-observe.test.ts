import assert from "node:assert/strict";
import test from "node:test";
import { observeAnswerFromWire } from "@sidecar/hosted";
import { encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { handleObserve, type VaultKeyRow } from "./hosted-runner";

const SECRET = "a".repeat(64);

function observeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/observe", {
    method: "GET",
    headers: { authorization: "Bearer token-1", ...headers },
  });
}

function observeOptions(
  overrides: Partial<Parameters<typeof handleObserve>[0]> = {},
): Parameters<typeof handleObserve>[0] {
  return {
    request: observeRequest(),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readVaultKeys: async (_userId: string): Promise<VaultKeyRow[]> => [],
    ...overrides,
  };
}

// --- Gate checks ---

test("the observe gate order is method, secret, token", async () => {
  const wrongMethod = await handleObserve(
    observeOptions({
      request: new Request("https://luke.test/api/observe", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleObserve(observeOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankSecret = await handleObserve(observeOptions({ encryptionSecret: "  " }));
  assert.equal(blankSecret.status, 503);

  const anonymous = await handleObserve(observeOptions({ resolveUserId: async () => undefined }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
});

// --- No keys → empty roster ---

test("with no vault keys stored the response is 200 with an empty sessions array", async () => {
  const response = await handleObserve(observeOptions());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.sessions));
  assert.equal(body.sessions.length, 0);
});

// --- Provider error is isolated ---

test("a provider that throws during observation does not fail the whole response", async () => {
  const ciphertext = encryptProviderKey("bad-key-triggers-auth-error", SECRET);
  // The adapter will call out to the provider with this key; the injected fetch
  // returns 401, which makes the adapter return an empty array (not throw).
  const response = await handleObserve(
    observeOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [{ providerId: "conductor", ciphertext }],
      fetch: async () => new Response(null, { status: 401 }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.sessions));
  assert.equal(body.sessions.length, 0);
});

// --- Wire contract ---

test("observeAnswerFromWire accepts a valid answer", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-1",
        title: "My PR",
        status: "working",
        workspace: "my-repo",
        branch: "main",
        recap: "Working on tests",
      },
    ],
  };
  const answer = observeAnswerFromWire(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  assert.equal(answer.sessions.length, 1);
  assert.equal(answer.sessions[0]?.providerId, "conductor");
  assert.equal(answer.sessions[0]?.title, "My PR");
  assert.equal(answer.sessions[0]?.status, "working");
  assert.equal(answer.sessions[0]?.workspace, "my-repo");
});

test("observeAnswerFromWire skips malformed session entries rather than failing", () => {
  const raw = {
    sessions: [
      { providerId: "conductor", sessionId: "good", title: "OK", status: "complete" },
      { providerId: "conductor" }, // missing required fields
      null,
    ],
  };
  const answer = observeAnswerFromWire(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  // Only the well-formed entry survives.
  assert.equal(answer.sessions.length, 1);
  assert.equal(answer.sessions[0]?.sessionId, "good");
});

test("observeAnswerFromWire rejects an unknown status value", () => {
  const raw = {
    sessions: [
      {
        providerId: "devin",
        sessionId: "sess-2",
        title: "Devin task",
        status: "running", // not a known SessionStatus
      },
    ],
  };
  const answer = observeAnswerFromWire(JSON.parse(JSON.stringify(raw)));
  // The malformed entry is skipped; the answer still exists with zero sessions.
  assert.ok(answer);
  assert.equal(answer.sessions.length, 0);
});

test("observeAnswerFromWire returns undefined for a non-object", () => {
  assert.equal(observeAnswerFromWire("not an object"), undefined);
  assert.equal(observeAnswerFromWire(null), undefined);
  assert.equal(observeAnswerFromWire(42), undefined);
});

test("observeAnswerFromWire returns undefined when sessions is not an array", () => {
  assert.equal(observeAnswerFromWire(JSON.parse(JSON.stringify({ sessions: "wrong" }))), undefined);
  assert.equal(observeAnswerFromWire(JSON.parse(JSON.stringify({}))), undefined);
});

// --- User id is passed through ---

test("readVaultKeys is called with the resolved user id", async () => {
  let calledWithUserId: string | undefined;

  await handleObserve(
    observeOptions({
      resolveUserId: async () => "user-xyz",
      readVaultKeys: async (userId) => {
        calledWithUserId = userId;
        return [];
      },
    }),
  );

  assert.equal(calledWithUserId, "user-xyz");
});

// --- Rate brake ---

test("the observe endpoint returns 429 after too many requests in the same window", async () => {
  // now() stays fixed so all calls land in the same window.
  const now = () => 1_000_000;
  // A userId unique to this test run avoids cross-test pollution of the module-level counter.
  const userId = `ratelimit-${Date.now()}-${process.pid}`;

  // MAX_REQUESTS_PER_WINDOW is 10; the 11th should be rate-limited.
  for (let i = 0; i < 10; i++) {
    const res = await handleObserve(observeOptions({ resolveUserId: async () => userId, now }));
    assert.equal(res.status, 200, `request ${i + 1} should succeed`);
  }

  const limited = await handleObserve(observeOptions({ resolveUserId: async () => userId, now }));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
});
