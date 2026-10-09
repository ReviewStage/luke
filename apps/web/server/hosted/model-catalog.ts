import { Context, Data, Duration, Effect, Exit, Layer, Result, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * model-catalog.ts -- the models a coding agent may run on, read from AI Gateway's public catalog.
 *
 * AI Gateway publishes its catalog at one unauthenticated URL. Luke keeps
 * the Anthropic and OpenAI models tagged for both tool use and reasoning,
 * and for each the efforts its `reasoning_options` list under the `effort`
 * entry; a model that lists no effort can satisfy no Start, so it is left
 * out rather than offered. The read is cached per instance for
 * `MODEL_CATALOG_TTL`, a failed read for no time at all, so an outage at the
 * catalog is retried on the next request rather than remembered.
 *
 * Model calls themselves go straight to each provider on Luke's own keys,
 * never through AI Gateway, so `providerModelOf` is the one translation
 * from a catalog id to the id the provider's own API takes. Nothing here
 * knows which account asked: the catalog is public and the same for every
 * caller.
 */

export const MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

/** How long one instance keeps a read catalog before asking again. */
export const MODEL_CATALOG_TTL = Duration.hours(1);

/** The providers whose models Luke runs coding agents on, as the catalog prefixes their ids. */
export const MODEL_PROVIDER = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
} as const;

type ModelProvider = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER];

/** What a first-time account starts an agent on, until it chooses. */
export const CODING_AGENT_DEFAULT_CHOICE = {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
} as const;

/** Every tag a model must carry to be offered. */
const REQUIRED_TAGS: readonly string[] = ["tool-use", "reasoning"];

/** The `reasoning_options` entry whose `values` are the model's efforts. */
const EFFORT_OPTION = "effort";

const CATALOG_ID_SEPARATOR = "/";

/** Anthropic spells a version's point as a dash in its own ids; the catalog keeps the point. */
const CATALOG_VERSION_POINT = ".";
const ANTHROPIC_VERSION_POINT = "-";

const PROVIDER_SET: ReadonlySet<string> = new Set(Object.values(MODEL_PROVIDER));

/** One model as `/api/models` answers it and as a Start is checked against. */
export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly provider: ModelProvider;
  /** The efforts the model lists, in the catalog's order. */
  readonly efforts: readonly string[];
  /** The model's context window in tokens, as the catalog lists it, which a coding agent's session is told; absent where the catalog says nothing. */
  readonly contextWindow?: number;
}

/** A model and an effort, as a Start names them and the account's default stores them. */
export interface ModelChoice {
  readonly model: string;
  readonly effort: string;
}

/** A model as its provider's own API names it. */
export interface ProviderModel {
  readonly provider: ModelProvider;
  readonly modelId: string;
}

/** The catalog could not be read as the catalog: the request failed, or the answer is not its shape. */
export class ModelCatalogUnavailable extends Data.TaggedError("ModelCatalogUnavailable")<{
  readonly cause: unknown;
}> {}

/** Why a model choice is refused. */
export const MODEL_CHOICE_REFUSAL = {
  /** No offered model carries this id. */
  UNKNOWN_MODEL: "unknown-model",
  /** The model is offered, and does not list this effort. */
  UNKNOWN_EFFORT: "unknown-effort",
} as const;

export type ModelChoiceRefusal = (typeof MODEL_CHOICE_REFUSAL)[keyof typeof MODEL_CHOICE_REFUSAL];

/** The catalog refused the choice, for the reason named. */
export class ModelChoiceRefused extends Data.TaggedError("ModelChoiceRefused")<{
  readonly reason: ModelChoiceRefusal;
}> {}

/** The catalog the instance read, offered as a service so one read serves every route that checks against it. */
export class ModelCatalog extends Context.Service<
  ModelCatalog,
  { readonly read: Effect.Effect<readonly CatalogModel[], ModelCatalogUnavailable> }
>()("ModelCatalog") {}

// ------------------------------------------------------------- the boundary

/**
 * What this module reads of a catalog entry, and nothing else: an entry
 * carries far more, and a field this module does not read is not a field a
 * change to can refuse the whole catalog.
 */
const ReasoningOptionSchema = Schema.Struct({
  type: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
});

const CatalogEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  reasoning_options: Schema.optionalKey(Schema.NullOr(Schema.Array(ReasoningOptionSchema))),
  context_window: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const CatalogAnswerSchema = Schema.Struct({
  data: Schema.Array(CatalogEntrySchema),
});

type CatalogEntry = typeof CatalogEntrySchema.Type;

/** The provider and the provider's own name, split at the catalog id's one separator; nothing for an id with none. */
function splitCatalogId(
  catalogId: string,
): { readonly provider: string; readonly name: string } | undefined {
  const separator = catalogId.indexOf(CATALOG_ID_SEPARATOR);
  if (separator <= 0 || separator === catalogId.length - 1) return undefined;
  return { provider: catalogId.slice(0, separator), name: catalogId.slice(separator + 1) };
}

function providerOf(name: string): ModelProvider | undefined {
  if (!PROVIDER_SET.has(name)) return undefined;
  // SAFETY: membership in the set built from MODEL_PROVIDER's values is what the union names.
  return name as ModelProvider;
}

/** The entry as an offered model, or nothing for one Luke does not offer. */
function offeredModel(entry: CatalogEntry): CatalogModel | undefined {
  const provider = providerOf(splitCatalogId(entry.id)?.provider ?? "");
  if (provider === undefined) return undefined;
  const tags = entry.tags ?? [];
  if (!REQUIRED_TAGS.every((tag) => tags.includes(tag))) return undefined;
  const efforts =
    (entry.reasoning_options ?? []).find((option) => option.type === EFFORT_OPTION)?.values ?? [];
  if (efforts.length === 0) return undefined;
  const contextWindow = entry.context_window ?? undefined;
  return {
    id: entry.id,
    name: entry.name,
    provider,
    efforts,
    ...(contextWindow === undefined ? undefined : { contextWindow }),
  };
}

/** The catalog's answer filtered to what Luke offers, in the catalog's own order. */
function offeredModels(answer: typeof CatalogAnswerSchema.Type): readonly CatalogModel[] {
  const offered: CatalogModel[] = [];
  for (const entry of answer.data) {
    const model = offeredModel(entry);
    if (model !== undefined) offered.push(model);
  }
  return offered;
}

/** One read of the catalog over the client, answered as the offered models or as unavailable. */
const fetchOfferedModels = /* @__PURE__ */ Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
): Effect.fn.Return<readonly CatalogModel[], ModelCatalogUnavailable> {
  const request = HttpClientRequest.get(MODEL_CATALOG_URL).pipe(HttpClientRequest.acceptJson);
  const answer = yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(CatalogAnswerSchema)),
    Effect.scoped,
    Effect.mapError((cause) => new ModelCatalogUnavailable({ cause })),
  );
  return offeredModels(answer);
});

/**
 * The catalog as this instance's one cached read over the ambient client. A
 * success stands for the TTL; a failure stands for no time, so the next
 * request asks again rather than answering the outage for an hour.
 */
export const modelCatalogLayer: Layer.Layer<ModelCatalog, never, HttpClient.HttpClient> =
  Layer.effect(
    ModelCatalog,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const read = yield* Effect.cachedWithTTL(fetchOfferedModels(client), (exit) =>
        Exit.isSuccess(exit) ? MODEL_CATALOG_TTL : Duration.zero,
      );
      return { read };
    }),
  );

/** A catalog of exactly these models, for a test or a caller that already holds one. */
export function modelCatalogOf(models: readonly CatalogModel[]): Layer.Layer<ModelCatalog> {
  return Layer.succeed(ModelCatalog, { read: Effect.succeed(models) });
}

// ------------------------------------------------------------- the checks

/** The choice as the catalog accepts it, or why it refuses: a model it does not offer, or an effort that model does not list. */
export function validateModelChoice(
  catalog: readonly CatalogModel[],
  choice: ModelChoice,
): Result.Result<ModelChoice, ModelChoiceRefusal> {
  const model = catalog.find((offered) => offered.id === choice.model);
  if (model === undefined) return Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL);
  if (!model.efforts.includes(choice.effort))
    return Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_EFFORT);
  return Result.succeed({ model: model.id, effort: choice.effort });
}

/** The choice checked against the instance's catalog: accepted, refused, or the catalog unavailable. */
export function acceptedModelChoice(
  choice: ModelChoice,
): Effect.Effect<ModelChoice, ModelChoiceRefused | ModelCatalogUnavailable, ModelCatalog> {
  return Effect.gen(function* () {
    const catalog = yield* ModelCatalog;
    const offered = yield* catalog.read;
    return yield* Effect.fromResult(validateModelChoice(offered, choice)).pipe(
      Effect.mapError((reason) => new ModelChoiceRefused({ reason })),
    );
  });
}

/**
 * The model as its provider's own API names it: Anthropic spells the
 * version's point as a dash (`anthropic/claude-opus-5.5` is
 * `claude-opus-5-5`), and OpenAI's ids are the catalog's after the prefix.
 * Nothing for an id outside the two providers.
 */
export function providerModelOf(catalogId: string): ProviderModel | undefined {
  const split = splitCatalogId(catalogId);
  const provider = providerOf(split?.provider ?? "");
  if (split === undefined || provider === undefined) return undefined;
  if (provider === MODEL_PROVIDER.ANTHROPIC) {
    return {
      provider,
      modelId: split.name.replaceAll(CATALOG_VERSION_POINT, ANTHROPIC_VERSION_POINT),
    };
  }
  return { provider, modelId: split.name };
}
