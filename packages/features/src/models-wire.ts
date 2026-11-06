import { Duration, Schema as EffectSchema } from "effect";
import { AGENT_BOUNDS, contextWindowSchema } from "./agent-wire.js";
import {
  DEVICE_KIND,
  DEVICE_PLATFORM,
  DEVICE_SETUP_FAILURE_MAX_CHARS,
  deviceSetupSchema,
} from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const MODEL_PROVIDER = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
} as const;

export type ModelProvider = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER];

export const MODEL_CATALOG_TTL = Duration.hours(1);

export const AGENT_FALLBACK_CHOICE = {
  [MODEL_PROVIDER.ANTHROPIC]: { model: "anthropic/claude-opus-5.5", effort: "high" },
  [MODEL_PROVIDER.OPENAI]: { model: "openai/gpt-6.1-sol", effort: "high" },
} as const satisfies Record<ModelProvider, ModelChoice>;

export const AGENT_DEFAULT_CHOICE = AGENT_FALLBACK_CHOICE[MODEL_PROVIDER.ANTHROPIC];

export const MODEL_SPEED = {
  STANDARD: "standard",
  FAST: "fast",
  ULTRAFAST: "ultrafast",
} as const;

export type ModelSpeed = (typeof MODEL_SPEED)[keyof typeof MODEL_SPEED];

export const MODEL_SPEED_SUFFIX = {
  [MODEL_SPEED.FAST]: "-fast",
  [MODEL_SPEED.ULTRAFAST]: "-ultrafast",
} as const satisfies Record<Exclude<ModelSpeed, typeof MODEL_SPEED.STANDARD>, string>;

export function modelSpeedOf(catalogId: string): ModelSpeed {
  if (catalogId.endsWith(MODEL_SPEED_SUFFIX[MODEL_SPEED.ULTRAFAST])) return MODEL_SPEED.ULTRAFAST;
  if (catalogId.endsWith(MODEL_SPEED_SUFFIX[MODEL_SPEED.FAST])) return MODEL_SPEED.FAST;
  return MODEL_SPEED.STANDARD;
}

export function standardModelIdOf(catalogId: string): string {
  const speed = modelSpeedOf(catalogId);
  return speed === MODEL_SPEED.STANDARD
    ? catalogId
    : catalogId.slice(0, -MODEL_SPEED_SUFFIX[speed].length);
}

export const modelProviderSchema = EffectSchema.Literals(Object.values(MODEL_PROVIDER));

const choiceText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(AGENT_BOUNDS.MAX_CHOICE_CHARS),
);

const contextWindowsSchema = EffectSchema.Struct({
  standardTokens: countedNumber,
  longTokens: countedNumber,
  longInputPriceFactor: EffectSchema.optionalKey(countedNumber),
  longOutputPriceFactor: EffectSchema.optionalKey(countedNumber),
});

export type ContextWindows = typeof contextWindowsSchema.Type;

export const catalogModelSchema = EffectSchema.Struct({
  id: choiceText,
  name: EffectSchema.String,
  provider: EffectSchema.Literals(Object.values(MODEL_PROVIDER)),
  efforts: EffectSchema.Array(choiceText).check(EffectSchema.isMinLength(1)),
  contextWindows: EffectSchema.optionalKey(contextWindowsSchema),
  fastNotEnabled: EffectSchema.optionalKey(EffectSchema.Boolean),
  credentialMissing: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type CatalogModel = typeof catalogModelSchema.Type;

export const macOfferSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  name: EffectSchema.String,
  providers: EffectSchema.Array(modelProviderSchema),
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_KIND))),
  platform: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_PLATFORM))),
  seenAt: EffectSchema.optionalKey(countedNumber),
  setup: EffectSchema.optionalKey(deviceSetupSchema),
  setupFailure: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(DEVICE_SETUP_FAILURE_MAX_CHARS)),
  ),
  machineId: EffectSchema.optionalKey(EffectSchema.String),
  model: EffectSchema.optionalKey(EffectSchema.String),
});

export type MacOffer = typeof macOfferSchema.Type;

export const modelsAnswerSchema = EffectSchema.Struct({
  models: EffectSchema.Array(catalogModelSchema),
  macs: EffectSchema.optionalKey(EffectSchema.Array(macOfferSchema)),
});

export type ModelsAnswer = typeof modelsAnswerSchema.Type;

export const modelChoiceSchema = EffectSchema.Struct({
  model: choiceText,
  effort: choiceText,
  contextWindow: EffectSchema.optionalKey(contextWindowSchema),
});

export type ModelChoice = typeof modelChoiceSchema.Type;

export const agentDefaultWriteSchema = EffectSchema.Struct({
  agent: modelChoiceSchema,
});

export function agentFallbackChoice(
  models: readonly Pick<CatalogModel, "id" | "provider" | "credentialMissing">[],
): ModelChoice {
  const openai = AGENT_FALLBACK_CHOICE[MODEL_PROVIDER.OPENAI];
  const claudeUnpaid = models.some(
    (model) => model.provider === MODEL_PROVIDER.ANTHROPIC && model.credentialMissing === true,
  );
  const listed = models.find((model) => model.id === openai.model);
  return claudeUnpaid && listed !== undefined && listed.credentialMissing !== true
    ? openai
    : AGENT_DEFAULT_CHOICE;
}
