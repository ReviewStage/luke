import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
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
import { type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import { hostedRouter } from "../orpc/router.js";
import { type ModelCatalog, modelCatalogOf } from "../providers/model-catalog.js";
import type { WebServices } from "../runtime.js";

/**
 * The models route, answered by the hosted oRPC router the way the web
 * route answers it, over a real dialect: the signed-in desktop reads the offered models as
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

/** The answer as it left the handler: its status, the two headers a caller reads, and its bytes. */
interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

/** The hosted router over the catalog handed in and the test's database, with a resolver that reads the test's own bearers. */
const fetchOver = (catalog: Layer.Layer<ModelCatalog>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<ModelCatalog | DatabaseServices>().pipe(
      Effect.provide(
        Layer.mergeAll(
          catalog,
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
        ),
      ),
    );
    const handle = hostedFetch(
      hostedRouter({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(
              incoming.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
            ),
          ),
      }),
    );
    // SAFETY: the models procedure yields the catalog and the database alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    return (request: Request) => Effect.promise(() => handle(request, webServices));
  });

/** One request's bytes, as the route answers it. */
const bytes = (catalog: Layer.Layer<ModelCatalog>, request: Request) =>
  Effect.gen(function* () {
    const response = yield* (yield* fetchOver(catalog))(request);
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });

/** One request answered, its body read as JSON. */
const answer = (catalog: Layer.Layer<ModelCatalog>, request: Request) =>
  Effect.map(bytes(catalog, request), (answered): Answer => {
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(answered.text) as WireBoundaryInput;
    return { status: answered.status, body };
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
    "the answers are byte for byte the old group's: the read under private, no-store, and each refusal bare",
    () =>
      Effect.gen(function* () {
        const catalog = modelCatalogOf([OPUS]);
        const json = "application/json";
        assert.deepEqual(yield* bytes(catalog, request(MODELS)), {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: json,
          cacheControl: "private, no-store",
          text: '{"models":[{"id":"anthropic/claude-opus-5.5","name":"Claude Opus 5.5","provider":"anthropic","efforts":["low","medium","high","xhigh","max"]}]}',
        });
        assert.deepEqual(yield* bytes(catalog, request(MODELS, { signedIn: false })), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          contentType: json,
          cacheControl: null,
          text: '{"error":"invalid-token"}',
        });
        for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
          assert.deepEqual(yield* bytes(catalog, request(MODELS, { method })), {
            status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
            contentType: json,
            cacheControl: null,
            text: '{"error":"method-not-allowed"}',
          });
        }
        assert.deepEqual(yield* bytes(catalog, request(MODELS, { method: "HEAD" })), {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          contentType: json,
          cacheControl: null,
          text: "",
        });
        assert.deepEqual(yield* bytes(catalog, request(`${MODELS}/other`)), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          contentType: json,
          cacheControl: null,
          text: '{"error":"not-found"}',
        });
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
