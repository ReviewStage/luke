import assert from "node:assert/strict";
import test from "node:test";
import { Deferred, Effect } from "effect";
import { singleFlight, withIssuedAccountTokens } from "../src/account-token-lifecycle";

const TOKENS = { accessToken: "issued-access", refreshToken: "issued-refresh" };

test("accepted account tokens stay active", async () => {
  const revoked: string[] = [];
  const result = await Effect.runPromise(
    withIssuedAccountTokens({
      issue: () => Effect.succeed(TOKENS),
      use: (tokens) => Effect.succeed(tokens.accessToken),
      revoke: (refreshToken) =>
        Effect.sync(() => {
          revoked.push(refreshToken);
        }),
    }),
  );

  assert.equal(result, TOKENS.accessToken);
  assert.deepEqual(revoked, []);
});

test("a failed account completion revokes every issued refresh token", async () => {
  const revoked: string[] = [];
  await assert.rejects(
    Effect.runPromise(
      withIssuedAccountTokens({
        issue: () => Effect.succeed(TOKENS),
        use: () => Effect.fail(new Error("identity failed")),
        revoke: (refreshToken) =>
          Effect.sync(() => {
            revoked.push(refreshToken);
          }),
      }),
    ),
    /identity failed/,
  );

  assert.deepEqual(revoked, [TOKENS.refreshToken]);
});

test("revocation failure preserves the sign-in failure", async () => {
  const revokeFailures: unknown[] = [];
  await assert.rejects(
    Effect.runPromise(
      withIssuedAccountTokens({
        issue: () => Effect.succeed(TOKENS),
        use: () => Effect.fail(new Error("storage failed")),
        revoke: () => Effect.fail(new Error("revocation failed")),
        onRevokeFailure: (error) => revokeFailures.push(error),
      }),
    ),
    /storage failed/,
  );

  assert.equal(revokeFailures.length, 1);
  assert.match(String(revokeFailures[0]), /revocation failed/);
});

test("concurrent refresh asks share one in-flight run, so a rotated token is never spent twice", async () => {
  let runs = 0;
  let release: Deferred.Deferred<void> | undefined;
  const refresh = singleFlight(() =>
    Effect.gen(function* () {
      runs += 1;
      const gate = yield* Deferred.make<void, never>();
      release = gate;
      yield* Deferred.await(gate);
    }),
  );

  const first = Effect.runPromise(refresh());
  const second = Effect.runPromise(refresh());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);

  assert.ok(release);
  Effect.runSync(Deferred.succeed(release, undefined));
  await Promise.all([first, second]);

  const third = Effect.runPromise(refresh());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
  assert.ok(release);
  Effect.runSync(Deferred.succeed(release, undefined));
  await third;
});

test("a failed flight rejects every waiter and still ends, so the next ask can try again", async () => {
  let runs = 0;
  const refresh = singleFlight(() =>
    Effect.gen(function* () {
      runs += 1;
      return yield* Effect.fail(new Error("token endpoint unreachable"));
    }),
  );

  const first = Effect.runPromise(refresh());
  const second = Effect.runPromise(refresh());
  await assert.rejects(first, /unreachable/);
  await assert.rejects(second, /unreachable/);
  assert.equal(runs, 1);

  await assert.rejects(Effect.runPromise(refresh()), /unreachable/);
  assert.equal(runs, 2);
});
