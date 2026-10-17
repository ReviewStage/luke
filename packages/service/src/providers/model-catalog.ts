import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@luke/features/models-wire";
import { FAST_ACCESS, type FastAccess } from "@luke/features/provider-key-wire";
import { Context, Data, Duration, Effect, Exit, Layer, Option, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { HostedEnvironment } from "../environment.js";
import { checkFastAccess } from "./provider-key-check.js";

/**
 * model-catalog.ts -- the models a coding agent may run on, read from AI Gateway's public catalog.
 *
 * AI Gateway publishes its catalog at one unauthenticated URL. Luke keeps
 * the Anthropic and OpenAI models tagged for both tool use and reasoning,
 * and for each the efforts its `reasoning_options` list under the `effort`
 * entry; a model that lists no effort can satisfy no Start, so it is left
 * out rather than offered. A model offers two context windows where its
 * provider prices the tokens past a boundary inside its window apart, as
 * OpenAI does past 272K and Anthropic past 100K or 200K for some models:
 * the boundary is its standard window, which a choice opts into, and the
 * whole window is the long one, which every choice runs on unless it names
 * the other. A model priced the same across its whole window has that one
 * window, since a smaller one would buy nothing the provider names. The read is cached per instance for
 * `MODEL_CATALOG_TTL`, a failed read for no time at all, so an outage at the
 * catalog is retried on the next request rather than remembered.
 *
 * Model calls themselves go straight to each provider on Luke's own keys,
 * never through AI Gateway, so `providerModelOf` is the one translation
 * from a catalog id to the id the provider's own API takes. A fast slug is
 * AI Gateway's own name and no provider's: the provider is asked for the
 * base model with its fast option on. Nothing here
 * knows which account asked: the catalog is public and the same for every
 * caller, and so is the one thing kept beside it, whether Luke's own
 * Anthropic key may run fast mode (`provider-key-check.ts`), asked once
 * per instance for the same TTL. What an account is offered of the catalog
 * is `offeredToAccount`, by whether the key its steps run on may.
 */

const MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

/** How long one instance keeps a read catalog before asking again. */
const MODEL_CATALOG_TTL = Duration.hours(1);

/** Every tag a model must carry to be offered. */
const REQUIRED_TAGS: readonly string[] = ["tool-use", "reasoning"];

/** The `reasoning_options` entry whose `values` are the model's efforts. */
const EFFORT_OPTION = "effort";

const CATALOG_ID_SEPARATOR = "/";

/**
 * What a price tier's boundary is read to: the catalog spells one as the
 * first token past it (`200001`) or as the boundary itself (`272000`), so it
 * is read to the thousand at or below.
 */
const TIER_BOUNDARY_TOKENS = 1_000;

/** Anthropic spells a version's point as a dash in its own ids; the catalog keeps the point. */
const CATALOG_VERSION_POINT = ".";
const ANTHROPIC_VERSION_POINT = "-";

/**
 * The suffix AI Gateway gives a model's fast version (`anthropic/claude-opus-5.5-fast`
 * beside `anthropic/claude-opus-5.5`). It is the gateway's slug for the
 * base model asked to run fast, and the suffix is the one signal of it.
 */
const FAST_SLUG_SUFFIX = "-fast";

/**
 * The providers whose own API is confirmed to run what a fast slug stands
 * for: Anthropic's fast mode, the base model asked for `speed: "fast"`.
 * AI Gateway's docs never say what OpenAI's fast slugs are at OpenAI's own
 * API, so those are not offered rather than guessed at.
 */
export const FAST_PROVIDERS: ReadonlySet<ModelProvider> = new Set([MODEL_PROVIDER.ANTHROPIC]);

const PROVIDER_SET: ReadonlySet<string> = new Set(Object.values(MODEL_PROVIDER));

/**
 * What a model's tokens cost, in dollars per token as the catalog lists
 * them: the input the model read, the output it wrote, the input its
 * prefix cache answered, and the input written to that cache, the last two
 * of which the catalog prices for a model that caches and leaves unsaid for
 * one that does not.
 */
export interface ModelPricing {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cachedInputUsd?: number;
  readonly cacheWriteUsd?: number;
}

/** The counts a price is put on: a turn's, an agent's, as the brain keeps them, the cache's writes only where a provider said them. */
export interface PricedTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens?: number;
}

/**
 * One model as the service offers it: the wire's model (`@luke/features/models-wire`),
 * which `/api/models` answers and a Start is checked against, and beside it
 * what the catalog lists and the wire does not carry: the model's whole
 * context window, which a session on a model with one window is told, and
 * the prices its usage is costed at; each absent where the catalog says
 * nothing.
 */
export interface OfferedModel extends CatalogModel {
  readonly contextWindow?: number;
  readonly pricing?: ModelPricing;
}

/** A model as its provider's own API names it, and whether the catalog id asked for its fast version. */
export interface ProviderModel {
  readonly provider: ModelProvider;
  readonly modelId: string;
  readonly fast: boolean;
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

/** The catalog refused the choice, for the reason named, beside the models it was checked against, which a refusal lists as the choices there are. */
export class ModelChoiceRefused extends Data.TaggedError("ModelChoiceRefused")<{
  readonly reason: ModelChoiceRefusal;
  readonly offered: readonly OfferedModel[];
}> {}

/** The catalog the instance read, offered as a service so one read serves every route that checks against it. */
export class ModelCatalog extends Context.Service<
  ModelCatalog,
  {
    readonly read: Effect.Effect<readonly OfferedModel[], ModelCatalogUnavailable>;
    /** Whether Luke's own Anthropic key may run fast mode, as the instance last asked; nothing where it holds no key or the answer said neither. */
    readonly lukeFastAccess: Effect.Effect<FastAccess | undefined>;
  }
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

/** A price as the catalog spells it: dollars per token, as a decimal string. */
const PriceSchema = Schema.optionalKey(Schema.NullOr(Schema.FiniteFromString));

const PricingSchema = Schema.Struct({
  input: PriceSchema,
  output: PriceSchema,
  input_cache_read: PriceSchema,
  input_cache_write: PriceSchema,
});

/** One price tier: the price per token from `min` tokens on, as the catalog spells it; a tier with no `min` starts at none. */
const PriceTierSchema = Schema.Struct({
  cost: Schema.FiniteFromString,
  min: Schema.optionalKey(Schema.Number),
});

const PriceTiersSchema = Schema.optionalKey(Schema.NullOr(Schema.Array(PriceTierSchema)));

const TieredPricingSchema = Schema.Struct({
  input_tiers: PriceTiersSchema,
  output_tiers: PriceTiersSchema,
});

/** The entry's price tiers, read apart from its prices, so a tier spelled in a way this module does not read costs the model its long window and not its price. */
const readTiers = Schema.decodeUnknownOption(TieredPricingSchema);

/**
 * The entry's prices are read on their own, after the entry: a price the
 * catalog spells in a way this module does not read costs that model its
 * price and nothing else, where a field of the entry's own would refuse
 * the whole catalog.
 */
const readPricing = Schema.decodeUnknownOption(PricingSchema);

const CatalogEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  reasoning_options: Schema.optionalKey(Schema.NullOr(Schema.Array(ReasoningOptionSchema))),
  context_window: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  pricing: Schema.optionalKey(Schema.Unknown),
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

/** The entry's prices where it lists both an input and an output price as this module reads them; nothing where it lists either not, or not readably. */
function pricingOf(entry: CatalogEntry): ModelPricing | undefined {
  const pricing = Option.getOrUndefined(readPricing(entry.pricing));
  const inputUsd = pricing?.input ?? undefined;
  const outputUsd = pricing?.output ?? undefined;
  if (inputUsd === undefined || outputUsd === undefined) return undefined;
  const cachedInputUsd = pricing?.input_cache_read ?? undefined;
  const cacheWriteUsd = pricing?.input_cache_write ?? undefined;
  return {
    inputUsd,
    outputUsd,
    ...(cachedInputUsd === undefined ? undefined : { cachedInputUsd }),
    ...(cacheWriteUsd === undefined ? undefined : { cacheWriteUsd }),
  };
}

type PriceTier = typeof PriceTierSchema.Type;

/** The cost of the tier starting at `min`, starting at none where `min` is 0. */
function tierCost(tiers: readonly PriceTier[], min: number): number | undefined {
  return tiers.find((tier) => (tier.min ?? 0) === min)?.cost;
}

/** What the tier past the boundary costs as a multiple of the first tier; nothing where the catalog prices either not. */
function priceFactor(tiers: readonly PriceTier[], boundary: number): number | undefined {
  const standard = tierCost(tiers, 0);
  const long = tierCost(tiers, boundary);
  if (standard === undefined || long === undefined || standard <= 0) return undefined;
  return long / standard;
}

/**
 * The entry's two windows, where its input is priced apart past a boundary
 * inside its window: the boundary as its standard window and the whole
 * window as its long one, with what the tokens past the boundary cost
 * beside the first tier's; nothing for a model priced the same across its
 * whole window, a tier at the first tier's own price included, or one whose
 * window the catalog does not say.
 */
function contextWindowsOf(
  entry: CatalogEntry,
  contextWindow: number | undefined,
): ContextWindows | undefined {
  if (contextWindow === undefined) return undefined;
  const tiers = Option.getOrUndefined(readTiers(entry.pricing));
  const input = tiers?.input_tiers ?? [];
  const first = tierCost(input, 0);
  // A tier at the first tier's price is no boundary: nothing past it costs more.
  const boundaries = input
    .filter((tier) => tier.cost !== first)
    .map((tier) => tier.min ?? 0)
    .filter((min) => min > 0);
  if (boundaries.length === 0) return undefined;
  const boundary = Math.min(...boundaries);
  const standardTokens = Math.floor(boundary / TIER_BOUNDARY_TOKENS) * TIER_BOUNDARY_TOKENS;
  if (standardTokens <= 0 || standardTokens >= contextWindow) return undefined;
  const inputFactor = priceFactor(input, boundary);
  const outputFactor = priceFactor(tiers?.output_tiers ?? [], boundary);
  return {
    standardTokens,
    longTokens: contextWindow,
    ...(inputFactor === undefined ? undefined : { longInputPriceFactor: inputFactor }),
    ...(outputFactor === undefined ? undefined : { longOutputPriceFactor: outputFactor }),
  };
}

/** The entry as an offered model, or nothing for one Luke does not offer: a fast slug among them where its provider's fast option is not confirmed. */
function offeredModel(entry: CatalogEntry): OfferedModel | undefined {
  const named = providerModelOf(entry.id);
  if (named === undefined) return undefined;
  if (named.fast && !FAST_PROVIDERS.has(named.provider)) return undefined;
  const { provider } = named;
  const tags = entry.tags ?? [];
  if (!REQUIRED_TAGS.every((tag) => tags.includes(tag))) return undefined;
  const efforts =
    (entry.reasoning_options ?? []).find((option) => option.type === EFFORT_OPTION)?.values ?? [];
  if (efforts.length === 0) return undefined;
  const contextWindow = entry.context_window ?? undefined;
  const contextWindows = contextWindowsOf(entry, contextWindow);
  const pricing = pricingOf(entry);
  return {
    id: entry.id,
    name: entry.name,
    provider,
    efforts,
    ...(contextWindows === undefined ? undefined : { contextWindows }),
    ...(contextWindow === undefined ? undefined : { contextWindow }),
    ...(pricing === undefined ? undefined : { pricing }),
  };
}

/**
 * What the tokens cost at the prices: the input read from the prefix cache
 * at the cache's read price and the input written to it at its write price,
 * each at the input price for a model that lists none, the rest of the
 * input at the input price, and the output, reasoning included since the
 * provider counts it there, at the output price. The input counts both of
 * the cache's shares, so neither is priced twice.
 */
export function tokensCostUsd(pricing: ModelPricing, tokens: PricedTokens): number {
  const cached = Math.min(tokens.cachedInputTokens, tokens.inputTokens);
  const written = Math.min(tokens.cacheWriteTokens ?? 0, tokens.inputTokens - cached);
  return (
    (tokens.inputTokens - cached - written) * pricing.inputUsd +
    cached * (pricing.cachedInputUsd ?? pricing.inputUsd) +
    written * (pricing.cacheWriteUsd ?? pricing.inputUsd) +
    tokens.outputTokens * pricing.outputUsd
  );
}

/** The catalog's answer filtered to what Luke offers, in the catalog's own order. */
function offeredModels(answer: typeof CatalogAnswerSchema.Type): readonly OfferedModel[] {
  const offered: OfferedModel[] = [];
  for (const entry of answer.data) {
    const model = offeredModel(entry);
    if (model !== undefined) offered.push(model);
  }
  return offered;
}

/** One read of the catalog over the client, answered as the offered models or as unavailable. */
const fetchOfferedModels = /* @__PURE__ */ Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
): Effect.fn.Return<readonly OfferedModel[], ModelCatalogUnavailable> {
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
 * request asks again rather than answering the outage for an hour. Luke's
 * own key's fast access is asked on first use and kept for the same TTL,
 * an answer that said neither too, since the check spends on Luke's key.
 */
export const modelCatalogLayer: Layer.Layer<
  ModelCatalog,
  never,
  HttpClient.HttpClient | HostedEnvironment
> = Layer.effect(
  ModelCatalog,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const { anthropicKey } = yield* HostedEnvironment;
    const read = yield* Effect.cachedWithTTL(fetchOfferedModels(client), (exit) =>
      Exit.isSuccess(exit) ? MODEL_CATALOG_TTL : Duration.zero,
    );
    const lukeFastAccess = yield* Effect.cachedWithTTL(
      anthropicKey === undefined
        ? Effect.succeed(undefined)
        : checkFastAccess(anthropicKey).pipe(Effect.provideService(HttpClient.HttpClient, client)),
      MODEL_CATALOG_TTL,
    );
    return { read, lukeFastAccess };
  }),
);

/** A catalog of exactly these models, and Luke's key's fast access as given, for a test or a caller that already holds one. */
export function modelCatalogOf(
  models: readonly OfferedModel[],
  lukeFastAccess?: FastAccess,
): Layer.Layer<ModelCatalog> {
  return Layer.succeed(ModelCatalog, {
    read: Effect.succeed(models),
    lukeFastAccess: Effect.succeed(lukeFastAccess),
  });
}

// ------------------------------------------------------------- the checks

/**
 * The catalog as one account is offered it, by whether the Anthropic key
 * its steps run on may run fast mode: where Anthropic said its organization
 * may not, Anthropic's fast versions are withheld and each base model says
 * so; everything else as the catalog lists it. Note that a key no fast
 * request has answered is offered its fast versions, because a fast step
 * Anthropic refuses runs at standard speed anyway (`coder-host/model.ts`)
 * and the refusal is the answer the key is then offered by.
 */
export function offeredToAccount(
  offered: readonly OfferedModel[],
  anthropicFastAccess: FastAccess | undefined,
): readonly OfferedModel[] {
  if (anthropicFastAccess !== FAST_ACCESS.NOT_ENABLED) return offered;
  const withheld = new Set<string>();
  const kept: OfferedModel[] = [];
  for (const model of offered) {
    const fast = providerModelOf(model.id)?.fast ?? false;
    if (fast && model.provider === MODEL_PROVIDER.ANTHROPIC) {
      withheld.add(standardModelIdOf(model.id));
    } else {
      kept.push(model);
    }
  }
  return kept.map((model) => (withheld.has(model.id) ? { ...model, fastNotEnabled: true } : model));
}

/**
 * The choice as the catalog accepts it, or why it refuses: a model it does
 * not offer, or an effort that model does not list. The standard window is
 * kept only for a model that offers two; a model with one runs every choice
 * on its whole window, so it is accepted and dropped rather than refused,
 * as the long window, which a choice runs on by naming none, always is.
 */
export function validateModelChoice(
  catalog: readonly OfferedModel[],
  choice: ModelChoice,
): Result.Result<ModelChoice, ModelChoiceRefusal> {
  const model = catalog.find((offered) => offered.id === choice.model);
  if (model === undefined) return Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL);
  if (!model.efforts.includes(choice.effort))
    return Result.fail(MODEL_CHOICE_REFUSAL.UNKNOWN_EFFORT);
  const standard =
    choice.contextWindow === CONTEXT_WINDOW.STANDARD && model.contextWindows !== undefined;
  return Result.succeed({
    model: model.id,
    effort: choice.effort,
    ...(standard ? { contextWindow: CONTEXT_WINDOW.STANDARD } : undefined),
  });
}

/** The choice checked against the instance's catalog as the account is offered it (`offeredToAccount`): accepted, refused, or the catalog unavailable. */
export function acceptedModelChoice(
  choice: ModelChoice,
  anthropicFastAccess: FastAccess | undefined,
): Effect.Effect<ModelChoice, ModelChoiceRefused | ModelCatalogUnavailable, ModelCatalog> {
  return Effect.gen(function* () {
    const catalog = yield* ModelCatalog;
    const offered = offeredToAccount(yield* catalog.read, anthropicFastAccess);
    return yield* Effect.fromResult(validateModelChoice(offered, choice)).pipe(
      Effect.mapError((reason) => new ModelChoiceRefused({ reason, offered })),
    );
  });
}

/** The catalog id of the model a fast slug is the fast version of, which runs at standard speed; any other id as it is. */
export function standardModelIdOf(catalogId: string): string {
  return providerModelOf(catalogId)?.fast === true
    ? catalogId.slice(0, -FAST_SLUG_SUFFIX.length)
    : catalogId;
}

/**
 * The model as its provider's own API names it: Anthropic spells the
 * version's point as a dash (`anthropic/claude-opus-5.5` is
 * `claude-opus-5-5`), and OpenAI's ids are the catalog's after the prefix.
 * Note that a fast slug names the base model with `fast` on, because the
 * slug is the gateway's name rather than the provider's: Anthropic answers
 * `claude-opus-5-5-fast` with a refusal at the step's first call, and runs
 * fast mode as `claude-opus-5-5` asked for its fast speed. Nothing for an
 * id outside the two providers.
 */
export function providerModelOf(catalogId: string): ProviderModel | undefined {
  const split = splitCatalogId(catalogId);
  const provider = providerOf(split?.provider ?? "");
  if (split === undefined || provider === undefined) return undefined;
  const fast = split.name.endsWith(FAST_SLUG_SUFFIX);
  const name = fast ? split.name.slice(0, -FAST_SLUG_SUFFIX.length) : split.name;
  const modelId =
    provider === MODEL_PROVIDER.ANTHROPIC
      ? name.replaceAll(CATALOG_VERSION_POINT, ANTHROPIC_VERSION_POINT)
      : name;
  return { provider, modelId, fast };
}
