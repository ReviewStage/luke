import assert from "node:assert/strict";
import path from "node:path";
import { HttpServerResponse } from "effect/unstable/http";
import { test } from "vitest";
import { ADMIN_HTTP_STATUS, errorResponse } from "../server/admin/http.js";
import { ADMIN_REFUSAL, adminRefusalResponse } from "../server/admin/http-effect.js";
import {
  recordedAnswer,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden";

/**
 * The bytes an admin refusal answers with, recorded. Every one of them is
 * viewer-gated — even a refusal says how far a viewer got — so `no-store`
 * travels on each, and the goldens are what hold the group's answers to the
 * ones the promise-shaped gate gave.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/admin-refusal");

const REFUSALS = [
  { refusal: ADMIN_REFUSAL.METHOD_NOT_ALLOWED, status: ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED },
  { refusal: ADMIN_REFUSAL.UNAVAILABLE, status: ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE },
  { refusal: ADMIN_REFUSAL.NOT_SIGNED_IN, status: ADMIN_HTTP_STATUS.UNAUTHORIZED },
  { refusal: ADMIN_REFUSAL.NOT_AUTHORIZED, status: ADMIN_HTTP_STATUS.FORBIDDEN },
  { refusal: ADMIN_REFUSAL.NOT_FOUND, status: ADMIN_HTTP_STATUS.NOT_FOUND },
] as const;

test("a refusal answers the status and the bytes the promise-shaped gate answers", async () => {
  for (const entry of REFUSALS) {
    const converted = await recordedAnswer(
      HttpServerResponse.toWeb(adminRefusalResponse(entry.refusal)),
    );
    const promised = await recordedResponse(errorResponse(entry.status, entry.refusal.error));
    assert.deepEqual(converted, promised);
    await settleResponseGolden(GOLDEN_ROOT, entry.refusal.error, converted);
  }
});

test("the recorded set is exactly the refusals declared", async () => {
  const named = REFUSALS.map((entry) => entry.refusal.error).sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
