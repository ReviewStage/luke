import assert from "node:assert/strict";
import { it } from "vitest";
import { sourceMapUploadToken } from "./source-maps.js";

it("only a production build holding the token uploads source maps", () => {
  assert.equal(
    sourceMapUploadToken({ SENTRY_AUTH_TOKEN: "test-token", VERCEL_ENV: "production" }),
    "test-token",
  );
  assert.equal(
    sourceMapUploadToken({ SENTRY_AUTH_TOKEN: "test-token", VERCEL_ENV: "preview" }),
    undefined,
  );
  assert.equal(sourceMapUploadToken({ SENTRY_AUTH_TOKEN: "test-token" }), undefined);
  assert.equal(sourceMapUploadToken({ VERCEL_ENV: "production" }), undefined);
  assert.equal(
    sourceMapUploadToken({ SENTRY_AUTH_TOKEN: "", VERCEL_ENV: "production" }),
    undefined,
  );
});
