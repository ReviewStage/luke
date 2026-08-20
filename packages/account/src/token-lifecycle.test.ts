import assert from "node:assert/strict";
import test from "node:test";
import { singleFlight } from "@sidecar/oauth";
import { withIssuedAccountTokens } from "./token-lifecycle.js";

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

test("concurrent refresh asks share one in-flight run, so a rotated token is never spent twice", async () => {
  let runs = 0;
  let release: (() => void) | undefined;
  const refresh = singleFlight(
    () =>
      new Promise<void>((resolve) => {
        runs += 1;
        release = resolve;
      }),
  );

  const first = refresh();
  const second = refresh();
  assert.equal(runs, 1);

  release?.();
  await Promise.all([first, second]);

  // A finished flight is over: the next ask holds the newly rotated token and
  // may start a refresh of its own.
  const third = refresh();
  assert.equal(runs, 2);
  release?.();
  await third;
});

test("a failed flight rejects every waiter and still ends, so the next ask can try again", async () => {
  let runs = 0;
  const refresh = singleFlight(async () => {
    runs += 1;
    throw new Error("token endpoint unreachable");
  });

  const first = refresh();
  const second = refresh();
  await assert.rejects(first, /unreachable/);
  await assert.rejects(second, /unreachable/);
  assert.equal(runs, 1);

  await assert.rejects(refresh(), /unreachable/);
  assert.equal(runs, 2);
});
