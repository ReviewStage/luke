import assert from "node:assert/strict";
import test from "node:test";
import { withIssuedAccountTokens } from "../src/account-token-lifecycle";

const TOKENS = { accessToken: "issued-access", refreshToken: "issued-refresh" };

test("accepted account tokens stay active", async () => {
  const revoked: string[] = [];
  const result = await withIssuedAccountTokens({
    issue: async () => TOKENS,
    use: async (tokens) => tokens.accessToken,
    revoke: async (refreshToken) => {
      revoked.push(refreshToken);
    },
  });

  assert.equal(result, TOKENS.accessToken);
  assert.deepEqual(revoked, []);
});

test("a failed account completion revokes every issued refresh token", async () => {
  const revoked: string[] = [];
  await assert.rejects(
    withIssuedAccountTokens({
      issue: async () => TOKENS,
      use: async () => {
        throw new Error("identity failed");
      },
      revoke: async (refreshToken) => {
        revoked.push(refreshToken);
      },
    }),
    /identity failed/,
  );

  assert.deepEqual(revoked, [TOKENS.refreshToken]);
});

test("revocation failure preserves the sign-in failure", async () => {
  const revokeFailures: unknown[] = [];
  await assert.rejects(
    withIssuedAccountTokens({
      issue: async () => TOKENS,
      use: async () => {
        throw new Error("storage failed");
      },
      revoke: async () => {
        throw new Error("revocation failed");
      },
      onRevokeFailure: (error) => revokeFailures.push(error),
    }),
    /storage failed/,
  );

  assert.equal(revokeFailures.length, 1);
  assert.match(String(revokeFailures[0]), /revocation failed/);
});
