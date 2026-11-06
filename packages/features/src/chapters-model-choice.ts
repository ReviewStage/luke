import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";
import { MODEL_PROVIDER, type ModelProvider } from "./models-wire.js";

/**
 * chapters-model-choice.ts -- the Claude models chapters are told on, as the Chapters view names them and an account's preferences keep them.
 *
 * Every Generate runs on Haiku, which its button names. Earlier builds let a
 * member pick Sonnet or Opus, which the account's preferences still keep for
 * the builds that write it, and chapters those picks told still name their
 * model, so the set stays whole. Each runs on the member's own API key,
 * OpenAI's model of the same tier standing in where they saved only an
 * OpenAI key, and the set is Claude's alone, at Anthropic's own ids (the
 * ones an agent's title model and the catalog's provider ids use). A stored
 * value outside the set, one a later build dropped or a row never written,
 * reads as Haiku. OpenAI's model of each tier is named here too, so a
 * Generate can say which model it would run on before it runs
 * (`chaptersModelOn`) and the chapters it told can name it after.
 */

/** The models a member may tell chapters on, at Anthropic's own ids. */
export const CHAPTERS_MODEL = {
  HAIKU: "claude-haiku-5-5",
  SONNET: "claude-sonnet-5-5",
  OPUS: "claude-opus-5-5",
} as const;

export type ChaptersModelId = (typeof CHAPTERS_MODEL)[keyof typeof CHAPTERS_MODEL];

/** Every choice, in the order a control offers them: fastest first. */
export const CHAPTERS_MODEL_LIST: readonly ChaptersModelId[] = [
  CHAPTERS_MODEL.HAIKU,
  CHAPTERS_MODEL.SONNET,
  CHAPTERS_MODEL.OPUS,
];

/** The model a member who never chose tells chapters on. */
export const CHAPTERS_MODEL_DEFAULT: ChaptersModelId = CHAPTERS_MODEL.HAIKU;

/** What a choice reads as on a control and beside the chapters it told. */
export const CHAPTERS_MODEL_LABEL = {
  [CHAPTERS_MODEL.HAIKU]: "Haiku 5.5",
  [CHAPTERS_MODEL.SONNET]: "Sonnet 5.5",
  [CHAPTERS_MODEL.OPUS]: "Opus 5.5",
} as const satisfies Record<ChaptersModelId, string>;

/** OpenAI's model of each Claude choice's tier, which a member holding only an OpenAI key tells chapters on. */
const OPENAI_CHAPTERS_MODEL = {
  [CHAPTERS_MODEL.HAIKU]: "gpt-6-luna",
  [CHAPTERS_MODEL.SONNET]: "gpt-6.1-sol",
  [CHAPTERS_MODEL.OPUS]: "gpt-6-astra",
} as const satisfies Record<ChaptersModelId, string>;

/** What OpenAI's models read as beside the chapters they told and on the Generate that would run them. */
export const OPENAI_CHAPTERS_MODEL_LABEL = {
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.HAIKU]]: "GPT-6 Luna",
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.SONNET]]: "GPT-6.1 Sol",
  [OPENAI_CHAPTERS_MODEL[CHAPTERS_MODEL.OPUS]]: "GPT-6 Astra",
} as const;

/** The provider's own id of the model a choice's tier runs on, on a key of that provider. */
export function chaptersModelOn(provider: ModelProvider, modelId: ChaptersModelId): string {
  return provider === MODEL_PROVIDER.ANTHROPIC ? modelId : OPENAI_CHAPTERS_MODEL[modelId];
}

/** One of the choices, as the wire carries it. */
const chaptersModelSchema = Schema.Literals(CHAPTERS_MODEL_LIST);

const readsChaptersModel = Schema.is(chaptersModelSchema);

/** Whether a value is one of the choices, as one arriving from storage or the wire is read. */
export function isChaptersModel(value: UnparsedWireValue): value is ChaptersModelId {
  return readsChaptersModel(value);
}

/** The choice a stored value stands for: itself where it is one, Haiku otherwise. */
export function chaptersModelFrom(stored: UnparsedWireValue): ChaptersModelId {
  return isChaptersModel(stored) ? stored : CHAPTERS_MODEL_DEFAULT;
}
