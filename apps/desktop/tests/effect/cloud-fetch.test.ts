import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { CLOUD_FAILURE, CloudRequestError, HTTP_STATUS } from "../../src/cloud-session-adapter";
import {
  CloudFetchFailure,
  CloudFetchService,
  cloudFetch,
  fromCloudRequestError,
} from "../../src/effect/cloud-fetch";

test("cloudFetch returns a response when the service answers ok", async () => {
  const body = { ok: true };
  const layer = Layer.succeed(
    CloudFetchService,
    async () => new Response(JSON.stringify(body), { status: 200 }),
  );
  const response = await Effect.runPromise(
    cloudFetch("https://api.test/v1", {}).pipe(Effect.provide(layer)),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body);
});

test("cloudFetch maps unauthorized HTTP statuses to CloudFetchFailure", async () => {
  const layer = Layer.succeed(
    CloudFetchService,
    async () => new Response("", { status: HTTP_STATUS.UNAUTHORIZED }),
  );
  const exit = await Effect.runPromiseExit(
    cloudFetch("https://api.test/v1", {}).pipe(Effect.provide(layer)),
  );
  assert(Exit.isFailure(exit));
  const failure = Cause.failureOption(exit.cause);
  assert(failure._tag === "Some");
  const error = failure.value;
  assert(error instanceof CloudFetchFailure);
  assert.equal(error.failure, CLOUD_FAILURE.UNAUTHORIZED);
});

test("cloudFetch maps network failures to transient CloudFetchFailure", async () => {
  const layer = Layer.succeed(CloudFetchService, async () => {
    throw new TypeError("network down");
  });
  const exit = await Effect.runPromiseExit(
    cloudFetch("https://api.test/v1", {}).pipe(Effect.provide(layer)),
  );
  assert(Exit.isFailure(exit));
  const failure = Cause.failureOption(exit.cause);
  assert(failure._tag === "Some");
  const error = failure.value;
  assert(error instanceof CloudFetchFailure);
  assert.equal(error.failure, CLOUD_FAILURE.TRANSIENT);
});

test("fromCloudRequestError preserves CloudFailure semantics", () => {
  const mapped = fromCloudRequestError(
    new CloudRequestError(CLOUD_FAILURE.UNAUTHORIZED, "rejected key"),
  );
  assert.equal(mapped.failure, CLOUD_FAILURE.UNAUTHORIZED);
  assert.equal(mapped.message, "rejected key");
});
