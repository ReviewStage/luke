import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpApiSchema, HttpServerResponse } from "@effect/platform";
import { test } from "vitest";
import { errorResponse, HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  HOSTED_REFUSAL,
  hostedRefusalResponse,
  InvalidRequestRefusal,
  InvalidTokenRefusal,
  MethodNotAllowedRefusal,
  NotFoundRefusal,
  RequestTooLargeRefusal,
  UnavailableRefusal,
} from "../server/hosted/http-effect.js";

/**
 * The bytes a hosted refusal answers with, recorded. The desktop's hosted
 * clients read these against the wire contract, so a status or a body that
 * moved while the routes converted to `HttpApi` would be a contract break
 * nothing else would catch: the goldens are what the conversion is measured
 * against once the promise-shaped `errorResponse` beside them is gone.
 */

const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";
const GOLDEN_SUFFIX = ".json";
const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/hosted-refusal");

interface RecordedResponse {
  status: number;
  contentType: string | null;
  body: string;
}

async function recordedResponse(response: Response): Promise<RecordedResponse> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

async function settleResponseGolden(name: string, recorded: RecordedResponse): Promise<void> {
  const text = `${JSON.stringify(recorded, undefined, 2)}\n`;
  const file = path.join(GOLDEN_ROOT, `${name}${GOLDEN_SUFFIX}`);
  if (UPDATE_FIXTURES) {
    await fs.mkdir(GOLDEN_ROOT, { recursive: true });
    await fs.writeFile(file, text);
    return;
  }
  assert.equal(text, await fs.readFile(file, "utf8"));
}

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
    const converted = await recordedResponse(
      HttpServerResponse.toWeb(hostedRefusalResponse(entry.refusal)),
    );
    const promised = await recordedResponse(errorResponse(entry.status, entry.refusal.error));
    assert.deepEqual(converted, promised);
    await settleResponseGolden(entry.refusal.error, converted);
  }
});

test("each refusal schema carries the status its group answers with", () => {
  for (const entry of REFUSALS) {
    assert.equal(HttpApiSchema.getStatusError(entry.schema), entry.status);
  }
});

test("the recorded set is exactly the refusals declared", async () => {
  const named = REFUSALS.map((entry) => entry.refusal.error).sort();
  const held = (await fs.readdir(GOLDEN_ROOT))
    .filter((entry) => entry.endsWith(GOLDEN_SUFFIX))
    .map((entry) => entry.slice(0, -GOLDEN_SUFFIX.length))
    .sort();
  assert.deepEqual(held, named);
});
