import assert from "node:assert/strict";
import { HOSTED_API_ERROR } from "@sidecar/hosted";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { test } from "vitest";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  ModelCatalog,
  ModelCatalogUnavailable,
  modelCatalogOf,
} from "../server/hosted/model-catalog";
import { modelsApp } from "../server/models-app";

/**
 * The models route, answered by the group the way a function answers it:
 * the signed-in desktop reads the offered models as the catalog holds
 * them, nobody else reads anything, and a catalog the instance cannot read
 * is an outage the caller is told to retry.
 */

const ORIGIN = "https://luke.test";
const MODELS = "/api/models";
const USER_ID = "user-1";
const VALID_AUTHORIZATION = "Bearer token-1";

const CATALOG: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
];

const OUTAGE = Layer.succeed(ModelCatalog, {
  read: Effect.fail(new ModelCatalogUnavailable({ cause: new Error("gateway unreachable") })),
});

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group over the catalog handed in, answering one request. */
async function answer(catalog: Layer.Layer<ModelCatalog>, request: Request): Promise<Answer> {
  const { handler, dispose } = HttpRouter.toWebHandler(
    modelsApp({
      resolveUserId: (incoming) =>
        Effect.succeed(
          incoming.headers.get("authorization") === VALID_AUTHORIZATION
            ? Option.some(USER_ID)
            : Option.none(),
        ),
    }).pipe(HttpRouter.provideRequest(catalog)),
    { disableLogger: true },
  );
  const response = await handler(request);
  // SAFETY: the group answers JSON; the test compares it as the wire value it is.
  const body = (await response.json()) as WireBoundaryInput;
  await dispose();
  return { status: response.status, body };
}

function request(path: string, init: { method?: string; signedIn?: boolean } = {}): Request {
  return new Request(new URL(path, ORIGIN), {
    method: init.method ?? "GET",
    headers: init.signedIn === false ? {} : { authorization: VALID_AUTHORIZATION },
  });
}

test("the signed-in desktop reads the offered models, each with its efforts", async () => {
  assert.deepEqual(await answer(modelCatalogOf(CATALOG), request(MODELS)), {
    status: HOSTED_HTTP_STATUS.OK,
    body: { models: CATALOG.map((model) => ({ ...model, efforts: [...model.efforts] })) },
  });
});

test("an unsigned caller reads nothing", async () => {
  assert.deepEqual(await answer(modelCatalogOf(CATALOG), request(MODELS, { signedIn: false })), {
    status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
    body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
  });
});

test("the path answers GET alone", async () => {
  assert.deepEqual(await answer(modelCatalogOf(CATALOG), request(MODELS, { method: "POST" })), {
    status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
    body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
  });
});

test("a catalog the instance cannot read is an outage to retry", async () => {
  assert.deepEqual(await answer(OUTAGE, request(MODELS)), {
    status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    body: { error: HOSTED_API_ERROR.UNAVAILABLE },
  });
});

test("a path the group declares no route for is refused", async () => {
  assert.deepEqual(await answer(modelCatalogOf(CATALOG), request("/api/models/extra")), {
    status: HOSTED_HTTP_STATUS.NOT_FOUND,
    body: { error: HOSTED_API_ERROR.NOT_FOUND },
  });
});
