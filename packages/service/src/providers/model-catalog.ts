import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_CATALOG_TTL,
  MODEL_PROVIDER,
  MODEL_SPEED,
  MODEL_SPEED_SUFFIX,
  type ModelChoice,
  type ModelProvider,
  type ModelSpeed,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import { FAST_ACCESS, type FastAccess } from "@repo/features/provider-key-wire";
import { Context, Data, Duration, Effect, Exit, Layer, Option, Ref, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

const REQUIRED_TAGS: readonly string[] = ["tool-use", "reasoning"];

const EFFORT_OPTION = "effort";

const CATALOG_ID_SEPARATOR = "/";

const TIER_BOUNDARY_TOKENS = 1_000;

const CATALOG_VERSION_POINT = ".";
const ANTHROPIC_VERSION_POINT = "-";

export const FAST_PROVIDERS: ReadonlySet<ModelProvider> = new Set([
  MODEL_PROVIDER.ANTHROPIC,
  MODEL_PROVIDER.OPENAI,
]);

const BATCH_SLUG_SUFFIX = "-batch";

const PROVIDER_SET: ReadonlySet<string> = new Set(Object.values(MODEL_PROVIDER));

export interface ModelPricing {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cachedInputUsd?: number;
  readonly cacheWriteUsd?: number;
}

export interface PricedTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens?: number;
}

export interface OfferedModel extends CatalogModel {
  readonly contextWindow?: number;
  readonly pricing?: ModelPricing;
}

export interface ProviderModel {
  readonly provider: ModelProvider;
  readonly modelId: string;
  readonly speed: ModelSpeed;
}

export class ModelCatalogUnavailable extends Data.TaggedError("ModelCatalogUnavailable")<{
  readonly cause: unknown;
}> {}

export const MODEL_CHOICE_REFUSAL = {
  UNKNOWN_MODEL: "unknown-model",
  UNKNOWN_EFFORT: "unknown-effort",
} as const;

export type ModelChoiceRefusal = (typeof MODEL_CHOICE_REFUSAL)[keyof typeof MODEL_CHOICE_REFUSAL];

export class ModelChoiceRefused extends Data.TaggedError("ModelChoiceRefused")<{
  readonly reason: ModelChoiceRefusal;
  readonly offered: readonly OfferedModel[];
}> {}

export class ModelCatalog extends Context.Service<
  ModelCatalog,
  {
    readonly read: Effect.Effect<readonly OfferedModel[], ModelCatalogUnavailable>;
  }
>()("ModelCatalog") {}

const ReasoningOptionSchema = Schema.Struct({
  type: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
});

const PriceSchema = Schema.optionalKey(Schema.NullOr(Schema.FiniteFromString));

const PricingSchema = Schema.Struct({
  input: PriceSchema,
  output: PriceSchema,
  input_cache_read: PriceSchema,
  input_cache_write: PriceSchema,
});

const PriceTierSchema = Schema.Struct({
  cost: Schema.FiniteFromString,
  min: Schema.optionalKey(Schema.Number),
});

const PriceTiersSchema = Schema.optionalKey(Schema.NullOr(Schema.Array(PriceTierSchema)));

const TierPriceSchema = Schema.FiniteFromString;

const ServiceTierPricingSchema = Schema.Struct({
  input: TierPriceSchema,
  output: TierPriceSchema,
  input_cache_read: Schema.optionalKey(TierPriceSchema),
  long_context: Schema.optionalKey(
    Schema.Struct({
      threshold: Schema.Number,
      input: TierPriceSchema,
      output: TierPriceSchema,
    }),
  ),
});

const UltrafastPricingSchema = Schema.Struct({
  service_tiers: Schema.Struct({ ultrafast: ServiceTierPricingSchema }),
});

const readUltrafast = Schema.decodeUnknownOption(UltrafastPricingSchema);

const TieredPricingSchema = Schema.Struct({
  input_tiers: PriceTiersSchema,
  output_tiers: PriceTiersSchema,
});

const readTiers = Schema.decodeUnknownOption(TieredPricingSchema);

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

function splitCatalogId(
  catalogId: string,
): { readonly provider: string; readonly name: string } | undefined {
  const separator = catalogId.indexOf(CATALOG_ID_SEPARATOR);
  if (separator <= 0 || separator === catalogId.length - 1) return undefined;
  return { provider: catalogId.slice(0, separator), name: catalogId.slice(separator + 1) };
}

function providerOf(name: string): ModelProvider | undefined {
  if (!PROVIDER_SET.has(name)) return undefined;
  return name as ModelProvider;
}

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

function tierCost(tiers: readonly PriceTier[], min: number): number | undefined {
  return tiers.find((tier) => (tier.min ?? 0) === min)?.cost;
}

function priceFactor(tiers: readonly PriceTier[], boundary: number): number | undefined {
  const standard = tierCost(tiers, 0);
  const long = tierCost(tiers, boundary);
  if (standard === undefined || long === undefined || standard <= 0) return undefined;
  return long / standard;
}

function contextWindowsOf(
  entry: CatalogEntry,
  contextWindow: number | undefined,
): ContextWindows | undefined {
  if (contextWindow === undefined) return undefined;
  const tiers = Option.getOrUndefined(readTiers(entry.pricing));
  const input = tiers?.input_tiers ?? [];
  const first = tierCost(input, 0);
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

function offeredModel(entry: CatalogEntry): OfferedModel | undefined {
  const named = providerModelOf(entry.id);
  if (named === undefined || entry.id.endsWith(BATCH_SLUG_SUFFIX)) return undefined;
  if (named.speed === MODEL_SPEED.FAST && !FAST_PROVIDERS.has(named.provider)) return undefined;
  if (named.speed === MODEL_SPEED.ULTRAFAST) return undefined;
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

function ultrafastWindows(
  tier: typeof ServiceTierPricingSchema.Type,
  contextWindow: number | undefined,
): ContextWindows | undefined {
  const long = tier.long_context;
  if (long === undefined || contextWindow === undefined) return undefined;
  const standardTokens = Math.floor(long.threshold / TIER_BOUNDARY_TOKENS) * TIER_BOUNDARY_TOKENS;
  if (standardTokens <= 0 || standardTokens >= contextWindow) return undefined;
  return {
    standardTokens,
    longTokens: contextWindow,
    ...(tier.input > 0 ? { longInputPriceFactor: long.input / tier.input } : undefined),
    ...(tier.output > 0 ? { longOutputPriceFactor: long.output / tier.output } : undefined),
  };
}

function ultrafastModelOf(entry: CatalogEntry, base: OfferedModel): OfferedModel | undefined {
  if (base.provider !== MODEL_PROVIDER.OPENAI || modelSpeedOf(base.id) !== MODEL_SPEED.STANDARD) {
    return undefined;
  }
  const tier = Option.getOrUndefined(readUltrafast(entry.pricing))?.service_tiers.ultrafast;
  if (tier === undefined) return undefined;
  const contextWindows = ultrafastWindows(tier, base.contextWindow);
  return {
    id: `${base.id}${MODEL_SPEED_SUFFIX[MODEL_SPEED.ULTRAFAST]}`,
    name: `${base.name} (Ultrafast)`,
    provider: base.provider,
    efforts: base.efforts,
    ...(contextWindows === undefined ? undefined : { contextWindows }),
    ...(base.contextWindow === undefined ? undefined : { contextWindow: base.contextWindow }),
    pricing: {
      inputUsd: tier.input,
      outputUsd: tier.output,
      ...(tier.input_cache_read === undefined
        ? undefined
        : { cachedInputUsd: tier.input_cache_read }),
    },
  };
}

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

function offeredModels(answer: typeof CatalogAnswerSchema.Type): readonly OfferedModel[] {
  const offered: OfferedModel[] = [];
  for (const entry of answer.data) {
    const model = offeredModel(entry);
    if (model === undefined) continue;
    offered.push(model);
    const ultrafast = ultrafastModelOf(entry, model);
    if (ultrafast !== undefined) offered.push(ultrafast);
  }
  return offered;
}

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

export const modelCatalogLayer: Layer.Layer<ModelCatalog, never, HttpClient.HttpClient> =
  Layer.effect(
    ModelCatalog,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const lastRead = yield* Ref.make<readonly OfferedModel[] | undefined>(undefined);
      const cached = yield* Effect.cachedWithTTL(fetchOfferedModels(client), (exit) =>
        Exit.isSuccess(exit) ? MODEL_CATALOG_TTL : Duration.zero,
      );
      const read = cached.pipe(
        Effect.tap((offered) => Ref.set(lastRead, offered)),
        Effect.catch((unavailable) =>
          Effect.flatMap(Ref.get(lastRead), (held) =>
            held === undefined ? Effect.fail(unavailable) : Effect.succeed(held),
          ),
        ),
      );
      return { read };
    }),
  );

export function modelCatalogOf(models: readonly OfferedModel[]): Layer.Layer<ModelCatalog> {
  return Layer.succeed(ModelCatalog, { read: Effect.succeed(models) });
}

export interface AccountFastOffer {
  readonly anthropic: FastAccess | undefined;
  readonly chatGptPlan: boolean;
}

export function offeredToAccount(
  offered: readonly OfferedModel[],
  fast: AccountFastOffer,
): readonly OfferedModel[] {
  const anthropic = fast.anthropic === FAST_ACCESS.NOT_ENABLED;
  if (!anthropic && !fast.chatGptPlan) return offered;
  const notEnabled = new Set<string>();
  const kept: OfferedModel[] = [];
  for (const model of offered) {
    const speed = modelSpeedOf(model.id);
    const openAiUltrafast =
      speed === MODEL_SPEED.ULTRAFAST && model.provider === MODEL_PROVIDER.OPENAI;
    if (openAiUltrafast && fast.chatGptPlan) continue;
    if (speed === MODEL_SPEED.FAST && anthropic && model.provider === MODEL_PROVIDER.ANTHROPIC) {
      notEnabled.add(standardModelIdOf(model.id));
    } else {
      kept.push(model);
    }
  }
  return kept.map((model) => ({
    ...model,
    ...(notEnabled.has(model.id) ? { fastNotEnabled: true } : undefined),
  }));
}

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

export function acceptedModelChoice(
  choice: ModelChoice,
  fast: AccountFastOffer,
): Effect.Effect<ModelChoice, ModelChoiceRefused | ModelCatalogUnavailable, ModelCatalog> {
  return Effect.gen(function* () {
    const catalog = yield* ModelCatalog;
    const offered = offeredToAccount(yield* catalog.read, fast);
    return yield* Effect.fromResult(validateModelChoice(offered, choice)).pipe(
      Effect.mapError((reason) => new ModelChoiceRefused({ reason, offered })),
    );
  });
}

export function providerModelOf(catalogId: string): ProviderModel | undefined {
  const split = splitCatalogId(catalogId);
  const provider = providerOf(split?.provider ?? "");
  if (split === undefined || provider === undefined) return undefined;
  const name = standardModelIdOf(split.name);
  const modelId =
    provider === MODEL_PROVIDER.ANTHROPIC
      ? name.replaceAll(CATALOG_VERSION_POINT, ANTHROPIC_VERSION_POINT)
      : name;
  return { provider, modelId, speed: modelSpeedOf(split.name) };
}
