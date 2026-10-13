import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { saveProviderKey } from "@sidecar/database/models/provider-key-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { HOSTED_API_ERROR } from "@sidecar/hosted";
import { type CatalogModel, FAST_WITHHELD, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { Effect, Layer, Logger, Option } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  ModelCatalog,
  ModelCatalogUnavailable,
  modelCatalogOf,
} from "../server/hosted/model-catalog";
import { modelsApp } from "../server/models-app";

/**
 * The models route, answered by the group the way a function answers it,
 * over a real dialect: the signed-in desktop reads the offered models as
 * the catalog holds them, but for the fast versions of a provider it runs
 * on its own key, nobody else reads anything, and a catalog the instance
 * cannot read is an outage the caller is told to retry.
 *
 * Synthetic accounts, bearers, and sealed keys throughout.
 */

const ORIGIN = "https://luke.test";
const MODELS = "/api/models";
const USER_ID = "user-1";

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

const SOL: CatalogModel = {
  id: "openai/gpt-6.1-sol",
  name: "GPT-6.1 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "medium", "high"],
};

const CATALOG: readonly CatalogModel[] = [OPUS, SOL];

const OUTAGE = Layer.succeed(ModelCatalog, {
  read: Effect.fail(new ModelCatalogUnavailable({ cause: new Error("gateway unreachable") })),
});

const OPUS_FAST: CatalogModel = {
  id: "anthropic/claude-opus-5.5-fast",
  name: "Claude Opus 5.5 (Fast)",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group over the catalog handed in and the test's database, answering one request, with every line it logs kept in `logged`. */
const answer = (catalog: Layer.Layer<ModelCatalog>, request: Request, logged: string[] = []) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const capture = Logger.make((options) => {
      logged.push(JSON.stringify(options.message), String(options.cause));
    });
    const services = Layer.mergeAll(
      catalog,
      Layer.succeed(SqlClient.SqlClient, client),
      Logger.layer([capture]),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      modelsApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(
              incoming.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
            ),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  init: { method?: string; signedIn?: boolean; userId?: string } = {},
): Request {
  return new Request(new URL(path, ORIGIN), {
    method: init.method ?? "GET",
    headers: init.signedIn === false ? {} : { authorization: `Bearer ${init.userId ?? USER_ID}` },
  });
}

/** The models as the wire carries them, each list a fresh array as JSON reads it back. */
const wire = (models: readonly CatalogModel[]) =>
  models.map((model) => ({ ...model, efforts: [...model.efforts] }));

it.layer(getTestDB())("the models route", (it) => {
  it.effect("the signed-in desktop reads the offered models, each with its efforts", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* answer(modelCatalogOf(CATALOG), request(MODELS)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { models: wire(CATALOG) },
      });
    }),
  );

  it.effect("an unsigned caller reads nothing", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* answer(modelCatalogOf(CATALOG), request(MODELS, { signedIn: false })),
        {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        },
      );
    }),
  );

  it.effect("the path answers GET alone", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* answer(modelCatalogOf(CATALOG), request(MODELS, { method: "POST" })),
        {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        },
      );
    }),
  );

  it.effect("a catalog the instance cannot read is an outage to retry", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* answer(OUTAGE, request(MODELS)), {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
    }),
  );

  it.effect(
    "a catalog the instance cannot read is logged by its kind, and nothing its error said",
    () =>
      Effect.gen(function* () {
        const secret = "sk-gateway-leaked-0123456789abcdef";
        const leaking = Layer.succeed(ModelCatalog, {
          read: Effect.fail(new ModelCatalogUnavailable({ cause: new TypeError(secret) })),
        });
        const logged: string[] = [];
        yield* answer(leaking, request(MODELS), logged);
        assert.ok(
          logged.some((line) => line.includes("TypeError")),
          logged.join("\n"),
        );
        for (const line of logged) assert.ok(!line.includes(secret), line);
      }),
  );

  it.effect("a path the group declares no route for is refused", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* answer(modelCatalogOf(CATALOG), request("/api/models/extra")), {
        status: HOSTED_HTTP_STATUS.NOT_FOUND,
        body: { error: HOSTED_API_ERROR.NOT_FOUND },
      });
    }),
  );

  it.effect(
    "an account that runs Anthropic on its own key reads no Anthropic fast version, its base model saying why, and another account reads it",
    () =>
      Effect.gen(function* () {
        const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
        for (const id of [owner, other]) {
          yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
        }
        const sealed = { keyVersion: 1, sealedDataKey: "c2VhbGVk", sealedKey: "a2V5" };
        yield* saveProviderKey(
          owner,
          MODEL_PROVIDER.ANTHROPIC,
          sealed,
          "sk-ant-…wxyz",
          new Date(0),
        );
        const catalog = modelCatalogOf([...CATALOG, OPUS_FAST]);
        assert.deepEqual(yield* answer(catalog, request(MODELS, { userId: owner })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            models: wire([{ ...OPUS, fastWithheld: FAST_WITHHELD.OWN_KEY }, SOL]),
          },
        });
        assert.deepEqual(yield* answer(catalog, request(MODELS, { userId: other })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { models: wire([...CATALOG, OPUS_FAST]) },
        });
      }),
  );
});
