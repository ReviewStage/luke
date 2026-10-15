import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_PROVIDER,
} from "@luke/features/provider-key-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer, Logger, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { type ModelCatalog, modelCatalogOf } from "../providers/model-catalog.js";
import { modelsApp } from "./models-app.js";

/**
 * The models route, answered by the group the way a function answers it,
 * over a real dialect: the signed-in desktop reads the offered models as
 * the catalog holds them, but for Anthropic's fast versions where the key
 * its agents run on, its own or Luke's, belongs to an organization never
 * granted fast mode, and nobody else reads anything.
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

const OPUS_FAST: CatalogModel = { ...OPUS, id: "anthropic/claude-opus-5.5-fast" };

/** The catalog with Opus's fast version listed beside it. */
const FAST_CATALOG: readonly CatalogModel[] = [OPUS, OPUS_FAST, SOL];

/** An account holding an Anthropic key of its own, as a save left it, with the fast access its save found. */
const accountWithAnthropicKey = (userId: string, fastAccess: FastAccess | null) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const sealed = {
      keyVersion: 1,
      sealedDataKey: "sealed-data-key",
      sealedKey: `sealed-${userId}`,
    };
    yield* saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.ANTHROPIC,
      sealed,
      "sk-ant-…test",
      fastAccess,
      new Date(0),
    );
  });

/** The ids the account reads, and the base models it is told have fast mode withheld. */
const offeredTo = (catalog: Layer.Layer<ModelCatalog>, userId: string) =>
  Effect.map(answer(catalog, request(MODELS, { userId })), (answered) => {
    // SAFETY: the group answers the wire's models answer; the test reads the two fields it compares.
    const { models } = answered.body as {
      models: readonly { id: string; fastNotEnabled?: boolean }[];
    };
    return {
      ids: models.map((model) => model.id),
      notEnabled: models.filter((model) => model.fastNotEnabled === true).map((model) => model.id),
    };
  });

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
      Layer.succeed(Database, yield* Database),
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

  it.effect(
    "an account reads Anthropic's fast versions by the key its agents run on: withheld, its base model saying so, where Anthropic said that key's organization was never granted fast mode, its own or Luke's; offered where it ran one or none has answered",
    () =>
      Effect.gen(function* () {
        yield* accountWithAnthropicKey("user-own-not-enabled", FAST_ACCESS.NOT_ENABLED);
        yield* accountWithAnthropicKey("user-own-enabled", FAST_ACCESS.ENABLED);
        yield* accountWithAnthropicKey("user-own-unasked", null);
        const lukeEnabled = modelCatalogOf(FAST_CATALOG, FAST_ACCESS.ENABLED);
        const lukeNotEnabled = modelCatalogOf(FAST_CATALOG, FAST_ACCESS.NOT_ENABLED);
        const withheld = { ids: [OPUS.id, SOL.id], notEnabled: [OPUS.id] };
        const offered = { ids: [OPUS.id, OPUS_FAST.id, SOL.id], notEnabled: [] };

        assert.deepEqual(yield* offeredTo(lukeEnabled, "user-own-not-enabled"), withheld);
        assert.deepEqual(yield* offeredTo(lukeNotEnabled, "user-own-enabled"), offered);
        assert.deepEqual(yield* offeredTo(lukeNotEnabled, "user-own-unasked"), offered);
        assert.deepEqual(yield* offeredTo(lukeNotEnabled, "user-on-luke"), withheld);
        assert.deepEqual(yield* offeredTo(lukeEnabled, "user-on-luke"), offered);
      }),
  );
});
