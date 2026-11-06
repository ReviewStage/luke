import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";
import { MODEL_PROVIDER, type ModelProvider } from "./models-wire.js";

export const CHAPTERS_MODEL = {
  HAIKU: "claude-haiku-5-5",
  SONNET: "claude-sonnet-5-5",
  OPUS: "claude-opus-5-5",
} as const;

export type ChaptersModelId = (typeof CHAPTERS_MODEL)[keyof typeof CHAPTERS_MODEL];

export const CHAPTERS_MODEL_LIST: readonly ChaptersModelId[] = [
  CHAPTERS_MODEL.HAIKU,
  CHAPTERS_MODEL.SONNET,
  CHAPTERS_MODEL.OPUS,
];

export const CHAPTERS_MODEL_DEFAULT: ChaptersModelId = CHAPTERS_MODEL.HAIKU;

export const CHAPTERS_MODEL_LABEL = {
  [CHAPTERS_MODEL.HAIKU]: "Haiku 5.5",
  [CHAPTERS_MODEL.SONNET]: "Sonnet 5.5",
  [CHAPTERS_MODEL.OPUS]: "Opus 5.5",
} as const satisfies Record<ChaptersModelId, string>;

const OPENAI_CHAPTERS_MODEL = {
  [CHAPTERS_MODEL.HAIKU]: "gpt-6-luna",
  [CHAPTERS_MODEL.SONNET]: "gpt-6.1-sol",
  [CHAPTERS_MODEL.OPUS]: "gpt-6-astra",
} as const satisfies Record<ChaptersModelId, string>;

export const OPENAI_CHAPTERS_MODEL_LABEL = {
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.HAIKU]]: "GPT-6 Luna",
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.SONNET]]: "GPT-6.1 Sol",
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.OPUS]]: "GPT-6 Astra",
} as const;

export function chaptersModelOn(provider: ModelProvider, modelId: ChaptersModelId): string {
  return provider === MODEL_PROVIDER.ANTHROPIC ? modelId : OPENAI_CHAPTERS_MODEL[modelId];
}

const chaptersModelSchema = Schema.Literals(CHAPTERS_MODEL_LIST);

const readsChaptersModel = Schema.is(chaptersModelSchema);

export function isChaptersModel(value: UnparsedWireValue): value is ChaptersModelId {
  return readsChaptersModel(value);
}

export function chaptersModelFrom(stored: UnparsedWireValue): ChaptersModelId {
  return isChaptersModel(stored) ? stored : CHAPTERS_MODEL_DEFAULT;
}
