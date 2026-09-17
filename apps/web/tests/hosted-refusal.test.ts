import assert from "node:assert/strict";
import path from "node:path";
import { Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { test } from "vitest";
import { errorResponse, HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedRefusalResponse,
  InvalidRequestRefusal,
  InvalidTokenRefusal,
  MethodNotAllowedRefusal,
  NotFoundRefusal,
  PromptTooLargeRefusal,
  QuotaExhaustedRefusal,
  RequestTooLargeRefusal,
  UnavailableRefusal,
  UnknownToolRefusal,
} from "../server/hosted/http-effect.js";
import {
  recordedGoldenNames,
  recordedRefusal,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The bytes a hosted refusal answers with, recorded. The desktop's hosted
 * clients read these against the wire contract, so a status or a body that
 * moved while the routes converted to `HttpApi` would be a contract break
 * nothing else would catch: the goldens are what the conversion is measured
 * against once the promise-shaped `errorResponse` beside them is gone.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/hosted-refusal");

const REFUSALS = [
  {
    refusal: HOSTED_REFUSAL.INVALID_TOKEN,
    schema: InvalidTokenRefusal,
    status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  },
  {
    refusal: HOSTED_REFUSAL.INVALID_REQUEST,
    schema: InvalidRequestRefusal,
    status: HOSTED_HTTP_STATUS.BAD_REQUEST,
  },
  {
    refusal: HOSTED_REFUSAL.METHOD_NOT_ALLOWED,
    schema: MethodNotAllowedRefusal,
    status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  },
  {
    refusal: HOSTED_REFUSAL.NOT_FOUND,
    schema: NotFoundRefusal,
    status: HOSTED_HTTP_STATUS.NOT_FOUND,
  },
  {
    refusal: HOSTED_REFUSAL.PROMPT_TOO_LARGE,
    schema: PromptTooLargeRefusal,
    status: HOSTED_HTTP_STATUS.BAD_REQUEST,
  },
  {
    refusal: HOSTED_REFUSAL.QUOTA_EXHAUSTED,
    schema: QuotaExhaustedRefusal,
    status: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  },
  {
    refusal: HOSTED_REFUSAL.UNKNOWN_TOOL,
    schema: UnknownToolRefusal,
    status: HOSTED_HTTP_STATUS.BAD_REQUEST,
  },
  {
    refusal: HOSTED_REFUSAL.REQUEST_TOO_LARGE,
    schema: RequestTooLargeRefusal,
    status: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
  },
  {
    refusal: HOSTED_REFUSAL.UNAVAILABLE,
    schema: UnavailableRefusal,
    status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  },
] as const;

test("a refusal answers the status and the bytes the promise-shaped route answers", async () => {
  for (const entry of REFUSALS) {
    const converted = await recordedRefusal(
      HttpServerResponse.toWeb(hostedRefusalResponse(entry.refusal)),
    );
    const promised = await recordedRefusal(errorResponse(entry.status, entry.refusal.error));
    assert.deepEqual(converted, promised);
    await settleResponseGolden(GOLDEN_ROOT, entry.refusal.error, converted);
  }
});

test("each refusal schema carries the status its group answers with", () => {
  for (const entry of REFUSALS) {
    assert.equal(Schema.resolveAnnotations(entry.schema)?.httpApiStatus, entry.status);
  }
});

test("the recorded set is exactly the refusals declared", async () => {
  const named = REFUSALS.map((entry) => entry.refusal.error).sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
